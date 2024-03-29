use crate::constants::{
    CREATE_STREAM_FLAT_FEE, PERCENT_DENOMINATOR, TREASURY_TYPE_LOCKED, WITHDRAW_PERCENT_FEE, CREATE_TREASURY_FLAT_FEE, CREATE_TREASURY_INITIAL_BALANCE_FOR_FEES,
};
use crate::enums::*;
use crate::errors::ErrorCode;
use crate::events::*;
use crate::mean_emit;
use crate::stream::*;
use crate::template::*;
use crate::treasury::*;
use crate::categories::*;
use anchor_lang::prelude::*;
use anchor_spl::token::*;
use std::convert::TryFrom;

pub fn transfer_sol_amount<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    let pay_fee_ix = solana_program::system_instruction::transfer(from.key, to.key, amount);
    solana_program::program::invoke(
        &pay_fee_ix,
        &[from.clone(), to.clone(), system_program.clone()],
    )
    .map_err(Into::into)
}

pub fn treasury_transfer_sol_amount<'info>(
    treasury: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    let treasury_lamports = treasury.lamports();
    let treasury_min_rent_exempt = Rent::get()?.minimum_balance(treasury.data_len());
    let treasury_available_lamports = if treasury_lamports > treasury_min_rent_exempt {
        treasury_lamports
            .checked_sub(treasury_min_rent_exempt)
            .ok_or(ErrorCode::Overflow)?
    } else {
        0_u64
    };

    msg!("treasury_lamports: {0}", treasury_lamports);
    msg!("treasury_min_rent_exempt: {0}", treasury_min_rent_exempt);
    msg!(
        "treasury_available_lamports: {0}",
        treasury_available_lamports
    );

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
    amount: u64,
) -> Result<()> {
    let cpi_accounts = Transfer {
        from: from.clone(),
        to: to.clone(),
        authority: authority.clone(),
    };
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
        &treasury.bump.to_le_bytes(),
    ]];
    let cpi_accounts = Transfer {
        from: treasury_token.clone(),
        to: to_token.clone(),
        authority: treasury.to_account_info(),
    };
    let cpi_ctx =
        CpiContext::new_with_signer(token_program.clone(), cpi_accounts, treasury_signer_seed);
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
        if is_manual_pause {
            withdrawable_while_paused = stream.last_manual_stop_withdrawable_units_snap;
        } else {
            if stream.allocation_assigned_units >= stream.total_withdrawals_units {
                withdrawable_while_paused = stream
                    .allocation_assigned_units
                    .checked_sub(stream.total_withdrawals_units)
                    .ok_or(ErrorCode::Overflow)?;
            }
        }
    }
    let start_utc_seconds = stream.get_start_utc()?;
    let mut seconds_since_start = 0u64;

    if now_ts > start_utc_seconds {
        seconds_since_start = now_ts
            .checked_sub(start_utc_seconds)
            .ok_or(ErrorCode::Overflow)?;
    }

    let streamed_units_since_started = stream.primitive_get_streamed_units(seconds_since_start)?;
    let cliff_units = stream.primitive_get_cliff_units()?;
    let non_stop_earning_units = cliff_units
        .checked_add(streamed_units_since_started)
        .ok_or(ErrorCode::Overflow)?;

    let missed_units_while_paused =
        stream.primitive_get_streamed_units(stream.last_known_total_seconds_in_paused_status)?;

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
        name: String::from_utf8(stream.name.to_vec()).unwrap().trim().to_string(),
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
        last_manual_resume_remaining_allocation_units_snap: stream
            .last_manual_resume_remaining_allocation_units_snap,
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
        created_on_utc: stream.created_on_utc,
        category: stream.category,
        sub_category: stream.sub_category,
    };

    Ok(data)
}

pub fn construct_treasury_account<'info>(
    name: String,
    treasury_type: u8,
    auto_close: bool,
    sol_fee_payed_by_treasury: bool,
    category: Category,
    sub_category: SubCategory,
    treasury: &mut Account<'info, Treasury>,
    treasury_bump: u8,
    payer: &AccountInfo<'info>,
    treasurer: &AccountInfo<'info>,
    fee_treasury: &AccountInfo<'info>,
    associated_token: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    slot: u64,
) -> Result<()> {
        treasury.version = 2;
        treasury.bump = treasury_bump;
        treasury.slot = slot;
        treasury.treasurer_address = treasurer.key();
        treasury.associated_token_address = associated_token.key();
        treasury.name = string_to_bytes(name)?;
        treasury.labels = Vec::new(); // Do not change
        treasury.last_known_balance_units = 0;
        treasury.last_known_balance_slot = 0;
        treasury.last_known_balance_block_time = 0;
        treasury.allocation_reserved_units = 0; // deprecated
        treasury.allocation_assigned_units = 0;
        treasury.total_withdrawals_units = 0;
        treasury.total_streams = 0;
        treasury.created_on_utc = Clock::get()?.unix_timestamp as u64;
        treasury.treasury_type = treasury_type;
        treasury.auto_close = auto_close;
        treasury.initialized = true;
        treasury.sol_fee_payed_by_treasury = sol_fee_payed_by_treasury;
        treasury.category = category as u8;
        treasury.sub_category = sub_category as u8;

        // Fee
        transfer_sol_amount(
            &payer,
            &fee_treasury,
            &system_program,
            CREATE_TREASURY_FLAT_FEE,
        )?;

        if sol_fee_payed_by_treasury {
            transfer_sol_amount(
                &payer,
                &treasury.to_account_info(),
                &system_program,
                CREATE_TREASURY_INITIAL_BALANCE_FOR_FEES,
            )?;
        }

        mean_emit!(CreateTreasuryEvent {
            timestamp: treasury.created_on_utc,
            sol_fee_charged: CREATE_TREASURY_FLAT_FEE,
            token_fee_charged: 0,
            sol_deposited_for_fees: CREATE_TREASURY_INITIAL_BALANCE_FOR_FEES,
            treasury_is_sol_fee_payed_by_treasury: treasury.sol_fee_payed_by_treasury,
            treasury_type: treasury.treasury_type,
            treasury_is_auto_close: treasury.auto_close,
            treasury: treasury.key(),
        });

        Ok(())
}

pub fn construct_stream_template <'info>(
    start_utc: u64,
    rate_interval_in_seconds: u64,
    duration_number_of_units: u64,
    cliff_vest_percent: u64,
    fee_payed_by_treasurer: bool,
    template: &mut Account<'info, StreamTemplate>,
    template_bump: u8,
    template_version: u8,
) -> Result<()> {
    let clock = Clock::get()?;
    let now_ts = clock.unix_timestamp as u64;

    template.version = template_version;
    template.bump = template_bump;
    template.rate_interval_in_seconds = rate_interval_in_seconds;
    template.fee_payed_by_treasurer = fee_payed_by_treasurer;
    template.duration_number_of_units = duration_number_of_units;
    template.cliff_vest_percent = cliff_vest_percent;

    if start_utc < now_ts {
        template.start_utc_in_seconds = now_ts;
    } else {
        template.start_utc_in_seconds = start_utc;
    }
    Ok(())
}

pub fn construct_stream_account<'info>(
    name: String,
    start_utc: u64,
    rate_amount_units: u64,
    rate_interval_in_seconds: u64,
    allocation_assigned_units: u64,
    fee_payed_by_treasurer: bool,
    effective_cliff_units: u64,
    stream: &mut Account<'info, Stream>,
    treasury: &mut Account<'info, Treasury>,
    treasury_token: &mut Account<'info, TokenAccount>,
    treasurer: &AccountInfo<'info>,
    beneficiary: &AccountInfo<'info>,
    beneficiary_associated_token: &AccountInfo<'info>,
    fee_treasury_token: &AccountInfo<'info>,
    fee_treasury: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
) -> Result<()> {
    let clock = Clock::get()?;
    let now_ts = clock.unix_timestamp as u64;

    let mut treasurer_fee_amount = 0u64;
    let mut total_treasury_allocation_amount = allocation_assigned_units;

    if fee_payed_by_treasurer {
        // beneficiary fee payed by the treasurer
        treasurer_fee_amount = u64::try_from(
            (WITHDRAW_PERCENT_FEE as u128)
                .checked_mul(allocation_assigned_units as u128)
                .ok_or(ErrorCode::Overflow)?
                .checked_div(PERCENT_DENOMINATOR as u128)
                .ok_or(ErrorCode::Overflow)?,
        )
        .unwrap();

        total_treasury_allocation_amount = allocation_assigned_units
            .checked_add(treasurer_fee_amount)
            .ok_or(ErrorCode::Overflow)?;
    }

    if total_treasury_allocation_amount > treasury.last_known_unallocated_balance()? {
        return Err(ErrorCode::InsufficientTreasuryBalance.into());
    }

    if treasury.treasury_type == TREASURY_TYPE_LOCKED && allocation_assigned_units == 0 {
        return Err(ErrorCode::InvalidRequestedStreamAllocation.into());
    }

    // update stream (needs to go before updating the treasury)
    stream.version = 2;
    stream.name = string_to_bytes(name)?;
    stream.treasurer_address = treasurer.key();
    stream.rate_amount_units = rate_amount_units;
    stream.rate_interval_in_seconds = rate_interval_in_seconds;
    stream.beneficiary_address = beneficiary.key();
    stream.beneficiary_associated_token = beneficiary_associated_token.key();
    stream.treasury_address = treasury.key();
    stream.allocation_assigned_units = allocation_assigned_units;
    stream.allocation_reserved_units = 0; // deprecated
    stream.total_withdrawals_units = 0;
    stream.last_withdrawal_units = 0;
    stream.last_withdrawal_slot = 0;
    stream.last_withdrawal_block_time = 0;
    stream.last_manual_stop_withdrawable_units_snap = 0;
    stream.last_manual_stop_slot = 0;
    stream.last_manual_stop_block_time = 0;
    stream.last_manual_resume_remaining_allocation_units_snap = 0;
    stream.last_auto_stop_block_time = 0;
    stream.last_manual_resume_slot = 0;
    stream.last_manual_resume_block_time = 0;
    stream.last_known_total_seconds_in_paused_status = 0;
    stream.cliff_vest_amount_units = effective_cliff_units;
    stream.cliff_vest_percent = 0; // deprecated
    stream.start_utc_in_seconds = 0;
    stream.fee_payed_by_treasurer = fee_payed_by_treasurer;
    stream.initialized = true;
    stream.created_on_utc = now_ts;
    stream.category = treasury.category;
    stream.sub_category = treasury.sub_category;

    if start_utc < now_ts {
        stream.start_utc = now_ts;
        stream.start_utc_in_seconds = now_ts;
    } else {
        stream.start_utc = start_utc;
        stream.start_utc_in_seconds = start_utc;
    }

    // update treasury (needs to after before updating the stream)
    if stream.allocation_assigned_units > 0 {
        treasury.allocation_assigned_units = treasury
            .allocation_assigned_units
            .checked_add(stream.allocation_assigned_units)
            .ok_or(ErrorCode::Overflow)?;
    }

    treasury.total_streams = treasury
        .total_streams
        .checked_add(1u64)
        .ok_or(ErrorCode::Overflow)?;

    if treasurer_fee_amount > 0 {
        // beneficiary withdraw fee payed by the treasurer
        treasury_transfer(
            &treasury,
            &treasury_token.to_account_info(),
            &fee_treasury_token,
            &token_program,
            treasurer_fee_amount,
        )?;

        // update treasury
        treasury.last_known_balance_slot = clock.slot as u64;
        treasury.last_known_balance_block_time = now_ts;
        treasury.last_known_balance_units = treasury
            .last_known_balance_units
            .checked_sub(treasurer_fee_amount)
            .ok_or(ErrorCode::Overflow)?;
    }

    // set categories
    stream.category = treasury.category;
    if treasury.sol_fee_payed_by_treasury {
        treasury_transfer_sol_amount(
            &treasury.to_account_info(),
            &fee_treasury,
            CREATE_STREAM_FLAT_FEE,
        )?;
    } else {
        transfer_sol_amount(
            // Not changing yet to be paid by treasury because of the airdrop streams
            &payer,
            &fee_treasury,
            &system_program,
            CREATE_STREAM_FLAT_FEE,
        )?;
    }

    treasury_token.reload()?;
    assert!(
        treasury_token.amount >= treasury.last_known_balance_units,
        "treasury balance units invariant violated"
    );
    assert!(
        treasury.allocation_assigned_units >= stream.allocation_assigned_units,
        "treasury vs stream assigned units invariant violated"
    );

    mean_emit!(CreateStreamEvent {
        timestamp: now_ts,
        sol_fee_charged: CREATE_STREAM_FLAT_FEE,
        token_fee_charged: treasurer_fee_amount,
        stream_start_ts: stream.start_utc_in_seconds,
        stream_rate_amount: stream.rate_amount_units,
        stream_rate_interval: stream.rate_interval_in_seconds,
        stream_allocation: stream.allocation_assigned_units,
        stream_cliff: stream.cliff_vest_amount_units,
        stream_is_token_withdraw_fee_payed_by_treasury: fee_payed_by_treasurer,
        treasury_is_sol_fee_payed_by_treasury: treasury.sol_fee_payed_by_treasury,
        treasury_allocation_after: treasury.allocation_assigned_units,
        treasury_balance_after: treasury.last_known_balance_units,
        stream: stream.key(),
        treasury: treasury.key(),
    });

    Ok(())
}

#[macro_export]
macro_rules! mean_emit {
    ($e:expr) => {
        msg!("mean-log-msp2");
        emit!($e);
    };
}
