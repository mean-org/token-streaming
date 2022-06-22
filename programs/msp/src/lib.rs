use anchor_lang::prelude::*;
use anchor_spl::token::*;

pub mod errors;
pub mod enums;
pub mod constants;
pub mod stream;
pub mod treasury;
pub mod instructions;
pub mod utils;
pub mod extensions;
pub mod events;

use crate::enums::*;
use crate::utils::*;
use crate::instructions::*;
use crate::constants::*;
use crate::errors::ErrorCode;
use crate::extensions::*;

declare_id!("MSPCUMbLfy2MeT6geLMMzrUkv1Tx88XRApaVRdyxTuu");

#[program]
pub mod msp {

    use super::*;

    /// Create Treasury
    pub fn create_treasury(
        ctx: Context<CreateTreasuryAccounts>,
        _idl_file_version: u8,
        slot: u64,
        name: String,
        treasury_type: u8,
        auto_close: bool,
        sol_fee_payed_by_treasury: bool,
    ) -> Result<()> {

        // Initialize Treasury
        let treasury = &mut ctx.accounts.treasury;
        treasury.version = 2;
        treasury.bump = ctx.bumps["treasury"];
        treasury.slot = slot;
        treasury.treasurer_address = ctx.accounts.treasurer.key();
        treasury.associated_token_address = ctx.accounts.associated_token.key();
        treasury.name = string_to_bytes(name)?;
        treasury.labels = Vec::new();
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

        // Fee
        transfer_sol_amount(
            &ctx.accounts.payer.to_account_info(),
            &ctx.accounts.fee_treasury.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            CREATE_TREASURY_FLAT_FEE
        )?;

        if sol_fee_payed_by_treasury {
            transfer_sol_amount(
                &ctx.accounts.payer.to_account_info(),
                &ctx.accounts.treasury.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                CREATE_TREASURY_INITIAL_BALANCE_FOR_FEES
            )?;
        }

        return Ok(())

    }

    /// Create Stream
    pub fn create_stream(
        ctx: Context<CreateStreamAccounts>,
        _idl_file_version: u8,
        name: String,
        start_utc: u64,
        rate_amount_units: u64,
        rate_interval_in_seconds: u64,
        allocation_assigned_units: u64,
        // allocation_reserved_units: u64, //deprecated. TODO: Remove after updating sdk/ui
        cliff_vest_amount_units: u64,
        cliff_vest_percent: u64,
        fee_payed_by_treasurer: bool

    ) -> Result<()> {
        let clock = Clock::get()?;
        let now_ts = clock.unix_timestamp as u64;

        let treasury = &mut ctx.accounts.treasury;
        msg!("clock: {0}, tsy_bal: {1}, tsy_alloc: {2}, tsy_wdths: {3}, crt_alloc: {4}", 
            now_ts, treasury.last_known_balance_units, treasury.allocation_assigned_units, treasury.total_withdrawals_units, allocation_assigned_units);

        let mut treasurer_fee_amount = 0u64;
        let mut total_treasury_allocation_amount = allocation_assigned_units;

        if fee_payed_by_treasurer {
            // beneficiary fee payed by the treasurer
            treasurer_fee_amount = WITHDRAW_PERCENT_FEE
                .checked_mul(allocation_assigned_units).unwrap()
                .checked_div(PERCENT_DENOMINATOR).ok_or(ErrorCode::Overflow)?;

            total_treasury_allocation_amount = allocation_assigned_units
                .checked_add(treasurer_fee_amount).ok_or(ErrorCode::Overflow)?;
        }

        if total_treasury_allocation_amount > treasury.last_known_unallocated_balance()? {
            return Err(ErrorCode::InsufficientTreasuryBalance.into());
        }

        if treasury.treasury_type == TREASURY_TYPE_LOCKED &&
            allocation_assigned_units == 0
        {
            return Err(ErrorCode::InvalidRequestedStreamAllocation.into());
        }

        // calculate effective cliff units as an absolute amount. We will not store %
        let effective_cliff_units = if cliff_vest_percent > 0 {
            cliff_vest_percent
                .checked_mul(allocation_assigned_units)
                .unwrap()
                .checked_div(PERCENT_DENOMINATOR)
                .ok_or(ErrorCode::Overflow)?
        } else {
            cliff_vest_amount_units
        };

        // update stream (needs to go before updating the treasury)
        let stream = &mut ctx.accounts.stream;
        stream.version = 2;
        stream.name = string_to_bytes(name)?;
        stream.treasurer_address = ctx.accounts.treasurer.key();
        stream.rate_amount_units = rate_amount_units;
        stream.rate_interval_in_seconds = rate_interval_in_seconds;
        stream.beneficiary_address = ctx.accounts.beneficiary.key();
        stream.beneficiary_associated_token = ctx.accounts.associated_token.key();
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

        if start_utc < now_ts {
            stream.start_utc = now_ts;
            stream.start_utc_in_seconds = now_ts;
        } else {
            stream.start_utc = start_utc;
            stream.start_utc_in_seconds = start_utc;
        }

        // update treasury (needs to after before updating the stream)
        if stream.allocation_assigned_units > 0 {
            treasury.allocation_assigned_units = treasury.allocation_assigned_units
                .checked_add(stream.allocation_assigned_units).ok_or(ErrorCode::Overflow)?;
        }

        treasury.total_streams = treasury.total_streams.checked_add(1u64).ok_or(ErrorCode::Overflow)?;

        if treasurer_fee_amount > 0 {           
            // beneficiary withdraw fee payed by the treasurer
            msg!("tsy{0}tfa", treasurer_fee_amount);
            treasury_transfer(
                &treasury,
                &ctx.accounts.treasury_token.to_account_info(),
                &ctx.accounts.fee_treasury_token.to_account_info(),
                &ctx.accounts.token_program.to_account_info(),
                treasurer_fee_amount
            )?;

            // update treasury
            treasury.last_known_balance_slot = clock.slot as u64;
            treasury.last_known_balance_block_time = now_ts;
            treasury.last_known_balance_units = treasury.last_known_balance_units
                .checked_sub(treasurer_fee_amount).ok_or(ErrorCode::Overflow)?;
        }

        // sol fee
        if treasury.sol_fee_payed_by_treasury {
            msg!("tsy{0}sfa", CREATE_STREAM_FLAT_FEE);
            treasury_transfer_sol_amount(
                &treasury.to_account_info(),
                &ctx.accounts.fee_treasury.to_account_info(),
                CREATE_STREAM_FLAT_FEE
            )?;
        } else {
            msg!("itr{0}sfa", CREATE_STREAM_FLAT_FEE);
            transfer_sol_amount( // Not changing yet to be paid by treasury because of the airdrop streams
                &ctx.accounts.payer.to_account_info(),
                &ctx.accounts.fee_treasury.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                CREATE_STREAM_FLAT_FEE
            )?;
        }

        ctx.accounts.treasury_token.reload()?;
        assert!(ctx.accounts.treasury_token.amount >= treasury.last_known_balance_units, 
            "treasury balance units invariant violated");
        assert!(treasury.allocation_assigned_units >= stream.allocation_assigned_units, 
            "treasury vs stream assigned units invariant violated");

        Ok(())
    }

    /// Withdraw
    pub fn withdraw(
        ctx: Context<WithdrawAccounts>,
        _idl_file_version: u8,
        amount: u64
    ) -> Result<()> {
        let clock = Clock::get()?;
        let now_ts = clock.unix_timestamp as u64;

        let treasury = &mut ctx.accounts.treasury;
        let stream = &mut ctx.accounts.stream;
        msg!("clock: {0}, tsy_bal: {1}, tsy_alloc: {2}, tsy_wdths: {3}, stm_alloc: {4}, stm_wdths: {5}, wdth_a: {6}", 
            now_ts, treasury.last_known_balance_units, treasury.allocation_assigned_units, treasury.total_withdrawals_units, stream.allocation_assigned_units, stream.total_withdrawals_units, amount);
        
        let start_utc_seconds = stream.get_start_utc()?;
        if start_utc_seconds > now_ts {
            return Err(ErrorCode::StreamIsScheduled.into());
        }
                
        stream.save_effective_cliff();

        let withdrawable_amount = stream.get_beneficiary_withdrawable_amount(now_ts)?;

        if withdrawable_amount == 0 {
            return Err(ErrorCode::ZeroWithdrawalAmount.into());
        }

        let mut user_requested_amount = amount;

        if user_requested_amount > withdrawable_amount {
            user_requested_amount = withdrawable_amount;
        }

        let fee_amount = if stream.fee_payed_by_treasurer 
        { 0u64 }
        else {
            WITHDRAW_PERCENT_FEE
                .checked_mul(user_requested_amount).unwrap()
                .checked_div(PERCENT_DENOMINATOR).ok_or(ErrorCode::Overflow)?
        };

        let transfer_amount = if fee_amount == 0 { user_requested_amount }
        else {
            user_requested_amount
                .checked_sub(fee_amount).ok_or(ErrorCode::Overflow)?
        };
        
        // Transfer from treasury to beneficiary
        msg!("tsy{0}bfy", transfer_amount);
        treasury_transfer(
            &treasury,
            &ctx.accounts.treasury_token.to_account_info(),
            &ctx.accounts.beneficiary_token.to_account_info(),
            &ctx.accounts.token_program.to_account_info(),
            transfer_amount
        )?;

        // Transfer fee
        if fee_amount > 0 {
            msg!("tsy{0}tfa", fee_amount);
            treasury_transfer(
                &treasury,
                &ctx.accounts.treasury_token.to_account_info(),
                &ctx.accounts.fee_treasury_token.to_account_info(),
                &ctx.accounts.token_program.to_account_info(),
                fee_amount
            )?;
        }

        stream.last_withdrawal_slot = clock.slot as u64;
        stream.last_withdrawal_block_time = now_ts;
        stream.last_withdrawal_units = user_requested_amount;
        stream.total_withdrawals_units = stream.total_withdrawals_units
            .checked_add(user_requested_amount).ok_or(ErrorCode::Overflow)?;

        // if the stream was manually paused then deduct the user requested amount
        // from the `last_manual_stop_withdrawable_units_snap` to update the 
        // beneficiary withdrawable amount
        if stream.primitive_is_manually_paused() {
            stream.last_manual_stop_withdrawable_units_snap = stream.last_manual_stop_withdrawable_units_snap
                .checked_sub(user_requested_amount)
                .ok_or(ErrorCode::Overflow)?;
        }
    
        // update the start UTC to seconds if it's necesary
        stream.update_start_utc()?;

        // Update treasury data
        assert!(
            treasury.allocation_assigned_units >= user_requested_amount,
            "treasury allocation_assigned vs withdraw amount invariant violated"
        );
        treasury.allocation_assigned_units = treasury.allocation_assigned_units
            .checked_sub(user_requested_amount).ok_or(ErrorCode::Overflow)?;

        treasury.last_known_balance_slot = clock.slot as u64;
        treasury.last_known_balance_block_time = now_ts;
        treasury.last_known_balance_units = treasury.last_known_balance_units
            .checked_sub(user_requested_amount).ok_or(ErrorCode::Overflow)?;
        treasury.total_withdrawals_units = treasury.total_withdrawals_units
            .checked_add(user_requested_amount).ok_or(ErrorCode::Overflow)?;

        // invariants
        ctx.accounts.treasury_token.reload()?;
        assert!(ctx.accounts.treasury_token.amount >= treasury.last_known_balance_units, 
            "treasury balance units invariant violated");

        Ok(())
    }

    /// Pause Stream
    pub fn pause_stream(
        ctx: Context<PauseOrResumeStreamAccounts>,
        _idl_file_version: u8,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let now_ts = clock.unix_timestamp as u64;
        msg!("clock: {0}", now_ts);

        let stream = &mut ctx.accounts.stream;
                
        stream.save_effective_cliff();

        let withdrawable_amount = stream.get_beneficiary_withdrawable_amount(now_ts)?;
        let stream_status = stream.get_status(now_ts)?;

        if stream_status == StreamStatus::Paused || stream_status == StreamStatus::Scheduled {
            return Err(ErrorCode::StreamAlreadyPaused.into());
        }

        // Update stream data (Pause the stream)
        stream.last_manual_stop_withdrawable_units_snap = withdrawable_amount;
        stream.last_manual_stop_slot = clock.slot as u64;
        stream.last_manual_stop_block_time = now_ts;
        // update the start UTC to seconds if it's necesary
        stream.update_start_utc()?;  

        Ok(())
    }

    /// Resume Stream
    pub fn resume_stream(
        ctx: Context<PauseOrResumeStreamAccounts>,
        _idl_file_version: u8,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let now_ts = clock.unix_timestamp as u64;
        msg!("clock: {0}", now_ts);

        let stream = &mut ctx.accounts.stream;
                
        stream.save_effective_cliff();

        let stream_status = stream.get_status(now_ts)?;
        if stream_status == StreamStatus::Running || stream_status == StreamStatus::Scheduled {
            return Err(ErrorCode::StreamAlreadyRunning.into());
        }

        // at this point, the stream can only be PAUSED

        let remaining_allocation = stream.get_remaining_allocation()?;
        if remaining_allocation == 0 {
            return Err(ErrorCode::StreamZeroRemainingAllocation.into());
        }

        let last_known_stop_block_time = stream.primitive_get_last_known_stop_block_time();
        
        // the reasoning here is, if the stream was manual-PAUSED, then last_known_stop_block_time
        // must be after stream.last_manual_resume_block_time. Otherwise it was auto-PAUSED.

        // MP2 - MR2
        if last_known_stop_block_time <= stream.last_manual_resume_block_time {
            // This means the last running leg of the money stream was auto-paused because it ran out of money. 
            // We need to find out the moment it ran out of money

            // resuming auto-paused stream is not allowed. the way of resuming
            // in this case is using allocate
            return Err(ErrorCode::CannotResumeAutoPausedStream.into());
        }

        // at this point the stream can only be manual-PAUSED

        // S3 = MR3 - AP1
        let seconds_paused_since_last_stop = now_ts
            .checked_sub(last_known_stop_block_time).ok_or(ErrorCode::Overflow)?;

        // SecondsPaused += S3
        stream.last_known_total_seconds_in_paused_status = stream.last_known_total_seconds_in_paused_status
            .checked_add(seconds_paused_since_last_stop).ok_or(ErrorCode::Overflow)?; 
        
        // Update stream data (Resume the stream)
        stream.last_manual_resume_remaining_allocation_units_snap = remaining_allocation;
        stream.last_manual_resume_slot = clock.slot as u64;
        stream.last_manual_resume_block_time = now_ts;
        // update the start UTC to seconds if it's necesary
        stream.update_start_utc()?;

        Ok(())
    }

    /// Refresh Treasury Balance
    pub fn refresh_treasury_data(
        ctx: Context<RefreshTreasuryDataAccounts>,
        _idl_file_version: u8,
    ) -> Result<()> {
        let clock = Clock::get()?;
        msg!("clock: {0}", clock.unix_timestamp);

        let treasury = &mut ctx.accounts.treasury;

        treasury.last_known_balance_slot = clock.slot as u64;
        treasury.last_known_balance_block_time = clock.unix_timestamp as u64;
        treasury.last_known_balance_units = ctx.accounts.treasury_token.amount;
            
        if treasury.associated_token_address.eq(&Pubkey::default()) {
            treasury.associated_token_address = ctx.accounts.associated_token.key();
        }

        Ok(())
    }

    /// Transfer Stream
    pub fn transfer_stream(
        ctx: Context<TransferStreamAccounts>,
        _idl_file_version: u8,
        new_beneficiary: Pubkey,
    ) -> Result<()> {

        let stream = &mut ctx.accounts.stream;
                
        stream.save_effective_cliff();

        stream.beneficiary_address = new_beneficiary;
        // update the start UTC to seconds if it's necesary
        stream.update_start_utc()?;
        // Fee
        transfer_sol_amount(
            &ctx.accounts.beneficiary.to_account_info(),
            &ctx.accounts.fee_treasury.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            TRANSFER_STREAM_FLAT_FEE
        )
    }

    /// Get Stream
    pub fn get_stream(
        ctx: Context<GetStreamAccounts>,
        _idl_file_version: u8,
    ) -> Result<()> {

        emit!(
            get_stream_data_event(&ctx.accounts.stream)?
        );

        Ok(())
    }

    // SPLITTING INSTRUCTIONS
    
    /// Adds funds the treasury
    pub fn add_funds<'info>(
        ctx: Context<AddFundsAccounts>,
        _idl_file_version: u8,
        amount: u64,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let now_ts = clock.unix_timestamp as u64;
        let now_slot = clock.slot as u64;
        
        let treasury = &mut ctx.accounts.treasury;
        msg!("clock: {0}, tsy_bal: {1}, tsy_alloc: {2}, tsy_wdths: {3}, add_a: {4}", 
            now_ts, treasury.last_known_balance_units, treasury.allocation_assigned_units, treasury.total_withdrawals_units, amount);

        // sol fee
        if ctx.accounts.contributor.key().eq(&treasury.treasurer_address) && // TODO:
            treasury.sol_fee_payed_by_treasury {
            msg!("tsy{0}sfa", ADD_FUNDS_FLAT_FEE);
            // this call needs to be after any cpi in this ix to avoid Solana's weird CPI imbalance check hack
            // REF: https://discord.com/channels/889577356681945098/889584618372734977/915190505002921994
            treasury_transfer_sol_amount(
                &treasury.to_account_info(),
                &ctx.accounts.fee_treasury.to_account_info(),
                ADD_FUNDS_FLAT_FEE
            )?;
        } else {
            msg!("pyr{0}sfa", ADD_FUNDS_FLAT_FEE);
            transfer_sol_amount(
                &ctx.accounts.payer.to_account_info(),
                &ctx.accounts.fee_treasury.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                ADD_FUNDS_FLAT_FEE
            )?;
        }

        // Transfer tokens from contributor to treasury associated token account
        msg!("ctb{0}tsy", amount);
        transfer_token_amount(
            &ctx.accounts.contributor_token.to_account_info(),
            &ctx.accounts.treasury_token.to_account_info(),
            &ctx.accounts.contributor.to_account_info(),
            &ctx.accounts.token_program.to_account_info(),
            amount
        )?;

        // update treasury
        treasury.associated_token_address = ctx.accounts.associated_token.to_account_info().key();
        treasury.last_known_balance_slot = now_slot;
        treasury.last_known_balance_block_time = now_ts;
        treasury.last_known_balance_units = treasury.last_known_balance_units
            .checked_add(amount).ok_or(ErrorCode::Overflow)?;

        ctx.accounts.treasury_token.reload()?;
        assert!(ctx.accounts.treasury_token.amount >= treasury.last_known_balance_units, 
            "treasury balance units invariant violated");

        Ok(())
    }

    /// Allocate units to a stream
    pub fn allocate<'info>(
        ctx: Context<AllocateAccounts>,
        _idl_file_version: u8,
        amount: u64,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let now_ts = clock.unix_timestamp as u64;
        let now_slot = clock.slot as u64;
        
        let treasury = &mut ctx.accounts.treasury;
        msg!("clock: {0}, tsy_bal: {1}, tsy_alloc: {2}, tsy_wdths: {3}, alloc_a: {4}", 
            now_ts, treasury.last_known_balance_units, treasury.allocation_assigned_units, treasury.total_withdrawals_units, amount);
            
        let stream = &mut ctx.accounts.stream;
                
        stream.save_effective_cliff();
        
        let fee_amount = if stream.fee_payed_by_treasurer {
           WITHDRAW_PERCENT_FEE
                .checked_mul(amount).unwrap()
                .checked_div(PERCENT_DENOMINATOR).ok_or(ErrorCode::Overflow)?
        } else {
            0_u64
        };

        let funding_amount = amount
            .checked_add(fee_amount).ok_or(ErrorCode::Overflow)?;

        // Added in case we decide not to throw error on inssuficient treasury balance
        // if funding_amount > treasury.last_known_unallocated_balance()? {
        //     let stream_max_allocation = treasury.last_known_unallocated_balance()?
        //         .checked_mul(PERCENT_DENOMINATOR).unwrap()
        //         .checked_div(
        //             WITHDRAW_PERCENT_FEE.checked_add(PERCENT_DENOMINATOR).unwrap()
        //         ).unwrap();
        //     fee_amount = stream_max_allocation
        //         .checked_mul(WITHDRAW_PERCENT_FEE).unwrap()
        //         .checked_div(PERCENT_DENOMINATOR).unwrap();

        //     funding_amount = treasury.last_known_unallocated_balance()?
        //         .checked_sub(fee_amount).unwrap();
        // }

        if funding_amount > treasury.last_known_unallocated_balance()? {
            return Err(ErrorCode::InsufficientTreasuryBalance.into());
        }

        if fee_amount > 0 {
            // Transfer fee from Treasury
            msg!("tsy{0}tfa", fee_amount);
            treasury_transfer(
                treasury,
                &ctx.accounts.treasury_token.to_account_info(),
                &ctx.accounts.fee_treasury_token.to_account_info(),
                &ctx.accounts.token_program.to_account_info(),
                fee_amount
            )?;
        }

        // update stream
        let status = stream.get_status(now_ts)?;
        let is_manual_pause = stream.primitive_is_manually_paused();

        if status == StreamStatus::Paused && !is_manual_pause {
            let est_depletion_time = stream.get_est_depletion_blocktime()?;
            let remaining_allocation = stream.get_remaining_allocation()?;

            // record the moment the stream stopped for running out of money
            stream.last_auto_stop_block_time = est_depletion_time;

            let seconds_paused_since_last_auto_stop = now_ts
                .checked_sub(stream.last_auto_stop_block_time).ok_or(ErrorCode::Overflow)?;

            // SecondsPaused += S3
            stream.last_known_total_seconds_in_paused_status = 
                stream.last_known_total_seconds_in_paused_status
                    .checked_add(seconds_paused_since_last_auto_stop)
                    .ok_or(ErrorCode::Overflow)?;
            
            // Update stream data (Resume the stream)
            stream.last_manual_resume_remaining_allocation_units_snap = remaining_allocation;
            stream.last_manual_resume_slot = now_slot;
            stream.last_manual_resume_block_time = now_ts;

            #[cfg(feature="test")]
            msg!("allocate status: auto-paused, est_depletion_time: {0}, remaining_allocation: {1}, last_auto_stop_block_time: {2}, seconds_paused_since_last_auto_stop: {3}, last_known_total_seconds_in_paused_status: {4}", 
                est_depletion_time, remaining_allocation, stream.last_auto_stop_block_time, seconds_paused_since_last_auto_stop, stream.last_known_total_seconds_in_paused_status);
        }

        stream.allocation_assigned_units = stream.allocation_assigned_units
            .checked_add(amount).ok_or(ErrorCode::Overflow)?;
        
        // update the start UTC to seconds if it's necesary
        stream.update_start_utc()?;

        // update treasury
        treasury.allocation_assigned_units = treasury.allocation_assigned_units
            .checked_add(amount).ok_or(ErrorCode::Overflow)?;
    
        treasury.last_known_balance_slot = now_slot;
        treasury.last_known_balance_block_time = now_ts;
        treasury.last_known_balance_units = treasury.last_known_balance_units
            .checked_sub(fee_amount).ok_or(ErrorCode::Overflow)?;

        ctx.accounts.treasury_token.reload()?;
        assert!(ctx.accounts.treasury_token.amount >= treasury.last_known_balance_units, 
            "treasury balance units invariant violated");

        Ok(())
    }

    /// Close Stream
    pub fn close_stream(
        ctx: Context<CloseStreamAccounts>,
        _idl_file_version: u8,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let now_ts = clock.unix_timestamp as u64;
        let now_slot = clock.slot as u64;

        let treasury = &mut ctx.accounts.treasury;
        let stream = &mut ctx.accounts.stream;
        msg!("clock: {0}, tsy_bal: {1}, tsy_alloc: {2}, tsy_wdths: {3}, stm_alloc: {4}, stm_wdths: {5}", 
            now_ts, treasury.last_known_balance_units, treasury.allocation_assigned_units, treasury.total_withdrawals_units, stream.allocation_assigned_units, stream.total_withdrawals_units);
        
        if treasury.last_known_balance_units != ctx.accounts.treasury_token.amount {
            msg!("tsy_bal upd: {0}", ctx.accounts.treasury_token.amount);
        }
        treasury.last_known_balance_units = ctx.accounts.treasury_token.amount;
                
        stream.save_effective_cliff();

        let beneficiary_closing_amount = stream.get_beneficiary_withdrawable_amount(now_ts)?;
        #[cfg(feature = "test")]
        msg!("beneficiary_closing_amount: {0}", beneficiary_closing_amount);

        let closing_amount_kept_in_treasury = stream.allocation_assigned_units
            .checked_sub(stream.total_withdrawals_units)
            .unwrap()
            .checked_sub(beneficiary_closing_amount)
            .ok_or(ErrorCode::Overflow)?;
        #[cfg(feature = "test")]
        msg!("closing_amount_kept_in_treasury: {0}", closing_amount_kept_in_treasury);

        let mut fee_amount = 0u64;
        let mut beneficiary_closing_amount_after_deducting_fees = beneficiary_closing_amount;

        if !stream.fee_payed_by_treasurer && beneficiary_closing_amount > 0 {
            fee_amount = CLOSE_STREAM_PERCENT_FEE
                .checked_mul(beneficiary_closing_amount).unwrap()
                .checked_div(PERCENT_DENOMINATOR).ok_or(ErrorCode::Overflow)?;

            beneficiary_closing_amount_after_deducting_fees = beneficiary_closing_amount
                .checked_sub(fee_amount)
                .ok_or(ErrorCode::Overflow)?;
        }

        // Transfer withdrawable amount to beneficiary and deduct fee
        if beneficiary_closing_amount > 0 {
            // Transfer withdrawable amount
            msg!("try{0}bfy", beneficiary_closing_amount_after_deducting_fees);
            treasury_transfer(
                &treasury,
                &ctx.accounts.treasury_token.to_account_info(),
                &ctx.accounts.beneficiary_token.to_account_info(),
                &ctx.accounts.token_program.to_account_info(),
                beneficiary_closing_amount_after_deducting_fees
            )?;

            if fee_amount > 0 {
                // Fee 
                msg!("try{0}tfa", fee_amount);
                treasury_transfer(
                    &treasury,
                    &ctx.accounts.treasury_token.to_account_info(),
                    &ctx.accounts.fee_treasury_token.to_account_info(),
                    &ctx.accounts.token_program.to_account_info(),
                    fee_amount
                )?;
            }
        }

        // Update treasury data
        let deallocated_units = beneficiary_closing_amount
            .checked_add(closing_amount_kept_in_treasury)
            .ok_or(ErrorCode::Overflow)?;
        close_stream_update_treasury(
            treasury, 
            beneficiary_closing_amount, 
            deallocated_units,
            now_ts, 
            now_slot
        )?;

        // sol fee
        // #[cfg(feature = "test")]
        if treasury.sol_fee_payed_by_treasury {
            msg!("tsy{0}sfa", CLOSE_STREAM_FLAT_FEE);
            treasury_transfer_sol_amount(
                &treasury.to_account_info(),
                &ctx.accounts.fee_treasury.to_account_info(),
                CLOSE_STREAM_FLAT_FEE
            )?;
        } else {
            msg!("pyr{0}sfa", CLOSE_STREAM_FLAT_FEE);
            transfer_sol_amount(
                &ctx.accounts.payer.to_account_info(),
                &ctx.accounts.fee_treasury.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                CLOSE_STREAM_FLAT_FEE
            )?;
        }

        #[cfg(feature = "test")]
        msg!("stream.total_withdrawals_units: {0}", stream.total_withdrawals_units);
        #[cfg(feature = "test")]
        msg!("beneficiary_closing_amount_after_deducting_fees: {0}", beneficiary_closing_amount_after_deducting_fees);
        #[cfg(feature = "test")]
        msg!("closing_amount_kept_in_treasury: {0}", closing_amount_kept_in_treasury);
        #[cfg(feature = "test")]
        msg!("fee_amount: {0}", fee_amount);
        assert!(
            stream.total_withdrawals_units
                .checked_add(beneficiary_closing_amount_after_deducting_fees)
                .unwrap()
                .checked_add(closing_amount_kept_in_treasury)
                .unwrap()
                .checked_add(fee_amount)
                .ok_or(ErrorCode::Overflow)?
            == stream.allocation_assigned_units,
            "stream closing total_withdrawals vs allocation_assigned invariant violated"
        );

        Ok(())
    }

    /// Close Treasury
    pub fn close_treasury(
        ctx: Context<CloseTreasuryAccounts>,
        _idl_file_version: u8,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let now_ts = clock.unix_timestamp as u64;

        let treasury = &mut ctx.accounts.treasury;
        msg!("clock: {0}, tsy_bal: {1}, tsy_alloc: {2}, tsy_wdths: {3}",
            now_ts, treasury.last_known_balance_units, treasury.allocation_assigned_units, treasury.total_withdrawals_units);

        // if treasury.total_streams > 0 {
        //     return Err(ErrorCode::TreasuryContainsStreams.into());
        // }
        // let treasury_signer_seed: &[&[&[_]]] = &[&[
        //     treasury.treasurer_address.as_ref(),
        //     &treasury.slot.to_le_bytes(),
        //     &treasury.bump.to_le_bytes()
        // ]];

        if ctx.accounts.treasury_token.amount > 0 {

            // Approach 1. using Anchor spl wrapper
            treasury_transfer(
                &treasury,
                &ctx.accounts.treasury_token.to_account_info(),
                &ctx.accounts.destination_token_account.to_account_info(),
                &ctx.accounts.token_program.to_account_info(),
                ctx.accounts.treasury_token.amount
            )?;

            // // Approach 2. using directly the spl token program
            // // We had to go this way to avoid Solanas weird pre-cpi imbalance check
            // let mut transfer_account_ix = spl_token::instruction::transfer(
            //     &ctx.accounts.token_program.key(),
            //     &ctx.accounts.treasury_token.key(),
            //     &ctx.accounts.destination_token_account.key(),
            //     &treasury.key(),
            //     &[],
            //     ctx.accounts.treasury_token.amount,
            // )?;
            // transfer_account_ix
            //     .accounts
            //     .push(anchor_lang::solana_program::instruction::AccountMeta {
            //         pubkey: ctx.accounts.fee_treasury.key(),
            //         is_signer: false,
            //         is_writable: false,
            //     });
    
            // anchor_lang::solana_program::program::invoke_signed(
            //     &transfer_account_ix,
            //     &[
            //         ctx.accounts.treasury_token.to_account_info(),
            //         ctx.accounts.destination_token_account.to_account_info(),
            //         treasury.to_account_info(),
            //         ctx.accounts.fee_treasury.to_account_info(),
            //     ],
            //     treasury_signer_seed
            // )?;
        }

        // CLOSE THE TREASURY TOKEN ACCOUNT
        // Treasury seeds
        let treasury_signer_seed: &[&[_]] = &[&[
            treasury.treasurer_address.as_ref(),
            &treasury.slot.to_le_bytes(),
            &treasury.bump.to_le_bytes()
        ]];
        // Approach 1. using Anchor spl wrapper
        // Close treasury token account
        let close_cpi_accounts = CloseAccount {
            account: ctx.accounts.treasury_token.to_account_info(),
            destination: ctx.accounts.destination_authority.to_account_info(), 
            authority: treasury.to_account_info().clone()
        };

        let close_cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(), 
            close_cpi_accounts, 
            treasury_signer_seed
        );

        close_account(close_cpi_ctx)?;

        // // Approach 2. using directly the spl token program
        // // We had to go this way to avoid Solanas weird pre-cpi imbalance check
        // let mut close_account_ix = spl_token::instruction::close_account(
        //     &ctx.accounts.token_program.key(),
        //     &ctx.accounts.treasury_token.key(),
        //     ctx.accounts.destination_authority.key,
        //     &treasury.key(),
        //     &[],
        // )?;
        // // adding the missing account here as a crazy hack to avoid 
        // // issues with Solanas weird pre-cpi imbalance check
        // close_account_ix
        //     .accounts
        //     .push(anchor_lang::solana_program::instruction::AccountMeta {
        //         pubkey: ctx.accounts.fee_treasury.key(),
        //         is_signer: false,
        //         is_writable: false,
        //     });

        // anchor_lang::solana_program::program::invoke_signed(
        //     &close_account_ix,
        //     &[
        //         ctx.accounts.treasury_token.to_account_info(),
        //         ctx.accounts.destination_authority.to_account_info(),
        //         treasury.to_account_info(),
        //         ctx.accounts.fee_treasury.to_account_info(),
        //     ],
        //     treasury_signer_seed
        // )?;

        // sol fee
        // this is done at the end to avoid pre-CPI imbalance check error
        if treasury.sol_fee_payed_by_treasury {
            msg!("tsy{0}sfa", CLOSE_TREASURY_FLAT_FEE);
            treasury_transfer_sol_amount(
                &treasury.to_account_info(),
                &ctx.accounts.fee_treasury.to_account_info(),
                CLOSE_TREASURY_FLAT_FEE
            )?;
        } else {
            msg!("itr{0}sfa", CLOSE_TREASURY_FLAT_FEE);
            transfer_sol_amount(
                &ctx.accounts.payer.to_account_info(),
                &ctx.accounts.fee_treasury.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                CLOSE_TREASURY_FLAT_FEE
            )?;
        }

        Ok(())
    }

    // /// UPDATE TREASURY DATA
    // pub fn update_treasury_data(
    //     ctx: Context<UpdateTreasuryDataAccounts>,
    //     new_allocated_amount: u64,
    //     new_withdrawals_amount: u64,
    //     new_number_of_streams: u64,

    // ) -> Result<()> {

    //     let clock = Clock::get()?;
    //     msg!("clock: {0}, new_allocated_amount: {1}, new_withdrawals_amount: {2}", clock.unix_timestamp, new_allocated_amount, new_withdrawals_amount);
    //     let treasury = &mut ctx.accounts.treasury;

    //     // Update `last_known_balance_units` in case 
    //     // funds were added externally during the process
    //     treasury.last_known_balance_slot = clock.slot as u64;
    //     treasury.last_known_balance_block_time = clock.unix_timestamp as u64;
    //     treasury.last_known_balance_units = ctx.accounts.treasury_token.amount;
            
    //     if treasury.associated_token_address.eq(&Pubkey::default()) {
    //         treasury.associated_token_address = ctx.accounts.associated_token.key();
    //     }

    //     // Update treasury data
    //     treasury.allocation_assigned_units = new_allocated_amount;
    //     treasury.total_withdrawals_units = new_withdrawals_amount;
    //     treasury.total_streams = new_number_of_streams;
    //     #[cfg(feature = "test")]
    //     msg!("alloc: {0}, withdr: {1}, n_streams: {2}", 
    //         treasury.allocation_assigned_units, treasury.total_withdrawals_units, treasury.total_streams);

    //     // Validate the values
    //     assert!(
    //         treasury.last_known_balance_units >= treasury.allocation_assigned_units,
    //         "treasury balance vs allocated invariant violated"
    //     );

    //     Ok(())
    // }

    /// Withdraw undallocated funds from treasury
    pub fn treasury_withdraw(
        ctx: Context<TreasuryWithdrawAccounts>,
        _idl_file_version: u8,
        amount: u64,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let now_ts = clock.unix_timestamp as u64;

        let treasury = &mut ctx.accounts.treasury;
        msg!("clock: {0}, tsy_bal: {1}, tsy_alloc: {2}, tsy_withds: {3}, withd_a: {4}", 
            now_ts, treasury.last_known_balance_units, treasury.allocation_assigned_units, treasury.total_withdrawals_units, amount);

        let fee_amount = TREASURY_WITHDRAW_PERCENT_FEE
            .checked_mul(amount).unwrap()
            .checked_div(PERCENT_DENOMINATOR).ok_or(ErrorCode::Overflow)?;

        let destination_amount = amount
            .checked_sub(fee_amount).ok_or(ErrorCode::Overflow)?;

        // transfer token % fee to fee account
        if fee_amount > 0 {
            msg!("tsy{0}tfa", fee_amount);
            treasury_transfer(
                &treasury,
                &ctx.accounts.treasury_token.to_account_info(),
                &ctx.accounts.fee_treasury_token.to_account_info(),
                &ctx.accounts.token_program.to_account_info(),
                fee_amount
            )?;
        }

        // TODO: SOL flat fee

        // transfer funds to destination
        msg!("tsy{0}dst", destination_amount);
        treasury_transfer(
            &treasury,
            &ctx.accounts.treasury_token.to_account_info(),
            &ctx.accounts.destination_token_account.to_account_info(),
            &ctx.accounts.token_program.to_account_info(),
            destination_amount
        )?;

        // update treasury
        treasury.last_known_balance_slot = clock.slot as u64;
        treasury.last_known_balance_block_time = now_ts;
        treasury.last_known_balance_units = treasury.last_known_balance_units
            .checked_sub(amount).ok_or(ErrorCode::Overflow)?;

        Ok(())
    }
}
