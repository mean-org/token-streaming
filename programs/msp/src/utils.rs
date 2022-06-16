use anchor_lang::prelude::*;
use anchor_spl::token::*;
use crate::treasury::*;
use crate::errors::ErrorCode;
use crate::events::*;
use crate::stream::*;
use crate::enums::*;

pub fn transfer_sol_amount<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    amount: u64

) -> Result<()> {

    let pay_fee_ix = solana_program::system_instruction::transfer(from.key, to.key, amount);
    solana_program::program::invoke(&pay_fee_ix, &[from.clone(), to.clone(), system_program.clone()]).map_err(Into::into)
}

pub fn treasury_transfer_sol_amount<'info>(
    treasury: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    amount: u64

) -> Result<()> {

    let treasury_lamports =  treasury.lamports();
    let treasury_min_rent_exempt = Rent::get()?.minimum_balance(treasury.data_len());
    let treasury_available_lamports = if treasury_lamports > treasury_min_rent_exempt
        {   
            treasury_lamports
                .checked_sub(treasury_min_rent_exempt)
                .ok_or(ErrorCode::Overflow)?
        } else {
            0_u64
    };

    msg!("treasury_lamports: {0}", treasury_lamports);
    msg!("treasury_min_rent_exempt: {0}", treasury_min_rent_exempt);
    msg!("treasury_available_lamports: {0}", treasury_available_lamports);

    if amount > treasury_available_lamports {
        return Err(ErrorCode::InsufficientLamports.into());
    }
    **treasury.try_borrow_mut_lamports()? = treasury
        .lamports()
        .checked_sub(amount)
        .ok_or(ProgramError::InvalidArgument)?;

    **to.try_borrow_mut_lamports()? = to
        .lamports()
        .checked_add(amount)
        .ok_or(ProgramError::InvalidArgument)?;

        Ok(())
}

pub fn transfer_token_amount<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    amount: u64

) -> Result<()> {

    let cpi_accounts = Transfer { from: from.clone(), to: to.clone(), authority: authority.clone() };
    let cpi_ctx = CpiContext::new(token_program.clone(), cpi_accounts);
    transfer(cpi_ctx, amount)
}

pub fn treasury_transfer<'info>(
    treasury: &Account<'info, Treasury>,
    treasury_token: &AccountInfo<'info>,
    to_token: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    amount: u64,

) -> Result<()> {

    let treasury_signer_seed: &[&[&[_]]] = &[&[
        treasury.treasurer_address.as_ref(),
        &treasury.slot.to_le_bytes(),
        &treasury.bump.to_le_bytes()
    ]];
    let cpi_accounts = Transfer { 
        from: treasury_token.clone(), 
        to: to_token.clone(), 
        authority: treasury.to_account_info() 
    };
    let cpi_ctx = CpiContext::new_with_signer(token_program.clone(), cpi_accounts, treasury_signer_seed);
    transfer(cpi_ctx, amount)
}

pub fn string_to_bytes<'info>(string: String) -> Result<[u8; 32]> {

    let string_bytes = string.as_bytes();

    if string_bytes.len() > 32 {
        return Err(ErrorCode::StringTooLong.into());
    }

    let mut string_data = [b' '; 32];
    string_data[..string_bytes.len()].copy_from_slice(string_bytes);

    Ok(string_data)
}

pub fn get_stream_data_event<'info>(stream: &Stream) -> Result<StreamEvent> {
    let now_ts = Clock::get()?.unix_timestamp as u64;
    msg!("clock: {0}", now_ts);

    let status_name;
    let status = stream.get_status(now_ts)?;

    if StreamStatus::Scheduled == status {
        status_name = "Scheduled";
    } else if StreamStatus::Running == status {
        status_name = "Running";
    } else {
        status_name = "Paused";
    }

    let is_manual_pause = stream.primitive_is_manually_paused();
    let mut withdrawable_while_paused = 0u64;

    if StreamStatus::Paused == status {
        let is_manual_pause = stream.primitive_is_manually_paused();
        if is_manual_pause {
            withdrawable_while_paused = stream.last_manual_stop_withdrawable_units_snap;
        } else {
            if stream.allocation_assigned_units >= stream.total_withdrawals_units {
                withdrawable_while_paused = stream.allocation_assigned_units
                    .checked_sub(stream.total_withdrawals_units)
                    .ok_or(ErrorCode::Overflow)?;
            }
        }
    }
    let start_utc_seconds = stream.get_start_utc()?;
    let mut seconds_since_start = 0u64;

    if now_ts > start_utc_seconds {
        seconds_since_start = now_ts.checked_sub(start_utc_seconds).ok_or(ErrorCode::Overflow)?;
    }

    let streamed_units_since_started = stream.primitive_get_streamed_units(seconds_since_start)?;
    let cliff_units = stream.primitive_get_cliff_units()?;
    let non_stop_earning_units = cliff_units
        .checked_add(streamed_units_since_started)
        .ok_or(ErrorCode::Overflow)?;

    let missed_units_while_paused = stream.primitive_get_streamed_units(
        stream.last_known_total_seconds_in_paused_status
    )?;

    let mut entitled_earnings_units = 0u64;

    if non_stop_earning_units >= missed_units_while_paused {
        entitled_earnings_units = non_stop_earning_units
            .checked_sub(missed_units_while_paused)
            .ok_or(ErrorCode::Overflow)?;
    }

    let mut withdrawable_units_while_running = 0u64;

    if entitled_earnings_units >= stream.total_withdrawals_units {
        withdrawable_units_while_running = entitled_earnings_units
            .checked_sub(stream.total_withdrawals_units)
            .ok_or(ErrorCode::Overflow)?;
    }


    let unused_allocation = stream.get_remaining_allocation()?;
    // let withdrawable = cmp::min(unused_allocation, withdrawable_units_while_running);
    // let rate_amount = stream.rate_amount_units as f64 / stream.rate_interval_in_seconds as f64;

    #[allow(deprecated)]
    let data = StreamEvent {
        // state data
        version: stream.version,
        initialized: stream.initialized,
        // name: stream.name.as_ref().trim_ascii_whitespace(),
        name: stream.name,
        treasurer_address: stream.treasurer_address,
        rate_amount_units: stream.rate_amount_units,
        rate_interval_in_seconds: stream.rate_interval_in_seconds,
        start_utc: start_utc_seconds,
        cliff_vest_amount_units: stream.cliff_vest_amount_units,
        cliff_vest_percent: stream.cliff_vest_percent,
        beneficiary_address: stream.beneficiary_address,
        beneficiary_associated_token: stream.beneficiary_associated_token,
        treasury_address: stream.treasury_address,    
        allocation_assigned_units: stream.allocation_assigned_units,
        allocation_reserved_units: 0, // deprecated
        total_withdrawals_units: stream.total_withdrawals_units,
        last_withdrawal_units: stream.last_withdrawal_units,
        last_withdrawal_slot: stream.last_withdrawal_slot,
        last_withdrawal_block_time: stream.last_withdrawal_block_time,
        last_manual_stop_withdrawable_units_snap: stream.last_manual_stop_withdrawable_units_snap, 
        last_manual_stop_slot: stream.last_manual_stop_slot,
        last_manual_stop_block_time: stream.last_manual_stop_block_time,
        last_manual_resume_remaining_allocation_units_snap: stream.last_manual_resume_remaining_allocation_units_snap,
        last_manual_resume_slot: stream.last_manual_resume_slot,
        last_manual_resume_block_time: stream.last_manual_resume_block_time,
        last_known_total_seconds_in_paused_status: stream.last_known_total_seconds_in_paused_status,
        last_auto_stop_block_time: stream.last_auto_stop_block_time,
        fee_payed_by_treasurer: stream.fee_payed_by_treasurer,
        // calculated data
        status: (String::from(status_name)),
        is_manual_pause: is_manual_pause,
        cliff_units: cliff_units,
        current_block_time: now_ts,
        seconds_since_start: seconds_since_start,
        // streamed_units_per_second: rate_amount,
        est_depletion_time: stream.get_est_depletion_blocktime()?,
        funds_left_in_stream: stream.get_funds_left_in_account(now_ts)?,
        funds_sent_to_beneficiary: stream.get_funds_sent_to_beneficiary(now_ts)?,
        withdrawable_units_while_paused: withdrawable_while_paused,
        non_stop_earning_units: non_stop_earning_units,
        missed_units_while_paused: missed_units_while_paused,
        entitled_earnings_units: entitled_earnings_units,
        withdrawable_units_while_running: withdrawable_units_while_running,
        beneficiary_remaining_allocation: unused_allocation,
        beneficiary_withdrawable_amount: stream.get_beneficiary_withdrawable_amount(now_ts)?,
        last_known_stop_block_time: stream.primitive_get_last_known_stop_block_time(),
        created_on_utc: stream.created_on_utc
    };

    Ok(data)
}
