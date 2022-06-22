use anchor_lang::prelude::*;
use std::cmp;
use crate::constants::*;
use crate::errors::ErrorCode;
use crate::enums::*;

#[account]
pub struct Stream {
    pub version: u8, // offset: 8
    pub initialized: bool,
    pub name: [u8; 32],
    pub treasurer_address: Pubkey, // offset: 42
    pub rate_amount_units: u64,
    pub rate_interval_in_seconds: u64,
    /// The start timestamp in seconds
    pub start_utc: u64,
    /// The amount availaible to withdraw inmidiately (without streaming) 
    /// once the money stream starts.
    /// If both 'cliff_vest_amount_units' and 'cliff_vest_percent' are provided, the former will be used.
    pub cliff_vest_amount_units: u64,
    /// The percent of the allocation assigned that is availaible to withdraw 
    /// inmidiately (without streaming) once the money stream starts.
    /// If both 'cliff_vest_amount_units' and 'cliff_vest_percent' are provided, the second (this field) will be used.
    pub cliff_vest_percent: u64, // deprecated
    pub beneficiary_address: Pubkey, // offset: 114
    pub beneficiary_associated_token: Pubkey, // offset: 146
    pub treasury_address: Pubkey, // offset: 178
    /// Amount of tokens allocated to the stream on creation or top up. If the
    /// treasurer decides to close the stream, the vested amount will be sent
    /// to the benefifiary and the unvested amount will be sent to the 
    /// treasurer
    /// 
    /// The allocation assigned will be affected by the following instructions:
    /// `addFunds`
    pub allocation_assigned_units: u64,
    /// Amount of tokens reserved to the stream. If the treasurer decides to
    /// close the stream, the total amount (vested and unvested) WILL be sent
    /// to the beneficiary
    ///
    /// [deprecated] The allocation reserved will be affected by the following instructions:
    /// `addFunds`
    // #[deprecated]
    pub allocation_reserved_units: u64,
    /// Withdrawal tracking
    /// The total amount that has been withdrawn by the beneficiary
    pub total_withdrawals_units: u64,
    /// The last amount withdrew by the beneficiary
    pub last_withdrawal_units: u64,
    /// The slot number when the last withdrawal was executed
    pub last_withdrawal_slot: u64,
    /// The blocktime value when the last withdrawal was executed
    pub last_withdrawal_block_time: u64,    
    /// How can a stream STOP? -> There are 2 ways: 
    /// 1) by a Manual Action (recordable when it happens) or 
    /// 2) by Running Out Of Funds (not recordable when it happens, needs to be calculated)
    pub last_manual_stop_withdrawable_units_snap: u64, 
    pub last_manual_stop_slot: u64,
    pub last_manual_stop_block_time: u64, // offset: 274
    /// The remaining allocation units at the moment of the last manual resume
    /// must be set when calling the Resume Stream
    pub last_manual_resume_remaining_allocation_units_snap: u64,
    pub last_manual_resume_slot: u64,
    pub last_manual_resume_block_time: u64, // offset: 298
    /// The total seconds that have been paused since the start_utc 
    /// increment when resume is called manually
    pub last_known_total_seconds_in_paused_status: u64,
    /// The last blocktime when the stream was stopped 
    /// either manually or automaticaly (run out of funds)
    pub last_auto_stop_block_time: u64,
    pub fee_payed_by_treasurer: bool,
    /// The start timestamp blocktime
    pub start_utc_in_seconds: u64,
    /// Unix timestamp (in seconds) when the stream was created
    pub created_on_utc: u64
    // total bytes: 339
}

impl Stream {

    /// Calculates the cliff amount
    pub fn primitive_get_cliff_units<'info>(&self) -> Result<u64> {
        // calculate effective cliff units as an absolute amount. We will not store %
        let cliff_units = if self.cliff_vest_percent > 0 {
            self.cliff_vest_percent
                .checked_mul(self.allocation_assigned_units)
                .unwrap()
                .checked_div(PERCENT_DENOMINATOR)
                .ok_or(ErrorCode::Overflow)?
        } else {
            self.cliff_vest_amount_units
        };

        Ok(cliff_units)
    }

    /// calculate effective cliff units as an absolute amount and store it in 
    /// the stream since we will not store the cliff %
    pub fn save_effective_cliff<'info>(&mut self) {
        let cliff_units = if self.cliff_vest_percent > 0 {
            self.cliff_vest_percent
                .checked_mul(self.allocation_assigned_units)
                .unwrap()
                .checked_div(PERCENT_DENOMINATOR)
                .unwrap()
        } else {
            self.cliff_vest_amount_units
        };
        self.cliff_vest_amount_units = cliff_units;
        self.cliff_vest_percent = 0;
    }

    /// Check is the stream was manually paused
    pub fn primitive_is_manually_paused<'info>(&self) -> bool {
        if self.last_manual_stop_block_time == 0 { // @err: probably not needed
            return false;
        }
        return self.last_manual_stop_block_time > self.last_manual_resume_block_time;
    }

    /// Gets the last known blocktime where the stream was paused (auto or manual)
    pub fn primitive_get_last_known_stop_block_time<'info>(&self) -> u64 {
        return cmp::max(self.last_auto_stop_block_time, self.last_manual_stop_block_time);
    }

    /// Calculates the amount of units streamed units during the given seconds
    /// 
    /// This takes into account if there are enough remaining allocated 
    /// units to fully stream for this number of seconds. 
    /// Also, the returned value does not include cliff.
    pub fn primitive_get_streamed_units<'info>(&self, seconds: u64) -> Result<u64> {
        if self.rate_interval_in_seconds == 0 {
            return Ok(0_u64);
        }

        let cliff_units = self.primitive_get_cliff_units()?;
        let streamable_units = self.allocation_assigned_units
            .checked_sub(cliff_units)
            .ok_or(ErrorCode::Overflow)?;
        let streaming_seconds = streamable_units
            .checked_mul(self.rate_interval_in_seconds)
            .ok_or(ErrorCode::Overflow)?
            .checked_div(self.rate_amount_units)
            .ok_or(ErrorCode::Overflow)?;

        if seconds >= streaming_seconds {
            return Ok(streamable_units);
        }

        let streamable_units_in_given_seconds = self.rate_amount_units
            .checked_mul(seconds).unwrap()
            .checked_div(self.rate_interval_in_seconds)
            .ok_or(ErrorCode::Overflow)?;
        
        Ok(streamable_units_in_given_seconds)
    }

    /// Gets the stream status in the current blocktime
    pub fn get_status<'info>(&self, timestamp: u64) -> Result<StreamStatus> {
        let start_utc_seconds = self.get_start_utc()?;

        // scheduled
        if start_utc_seconds > timestamp {
            return Ok(StreamStatus::Scheduled);
        }
          
        // manually paused
        let is_manual_pause = self.primitive_is_manually_paused();
        if is_manual_pause {
            return Ok(StreamStatus::Paused);
        }

        // running or automatically paused (ran out of funds)
        let cliff_units = self.primitive_get_cliff_units()?;
        let seconds_since_start = timestamp.checked_sub(start_utc_seconds).ok_or(ErrorCode::Overflow)?;

        let not_stop_streamed_units_since_started = self.primitive_get_streamed_units(seconds_since_start)?;
        let non_stop_earning_units = cliff_units
            .checked_add(not_stop_streamed_units_since_started)
            .ok_or(ErrorCode::Overflow)?;

        let actual_streamed_seconds = seconds_since_start
            .checked_sub(self.last_known_total_seconds_in_paused_status) // TODO: check
            .ok_or(ErrorCode::Overflow)?;
        let actual_streamed_units = self.primitive_get_streamed_units(actual_streamed_seconds)?;
        let actual_earned_units = cliff_units
            .checked_add(actual_streamed_units)
            .ok_or(ErrorCode::Overflow)?;

        assert!(
            non_stop_earning_units >= actual_earned_units, 
            "non_stop vs actual earned units invariant violated"
        );

        // running
        if self.allocation_assigned_units > actual_earned_units {
            return Ok(StreamStatus::Running);
        }

        // automatically paused (ran out of funds)
        Ok(StreamStatus::Paused)
    }

    /// Calculates the stream estimated depletion blocktime. The calculation 
    /// has into account the periods of time in which the stream was in 
    /// paused status.
    pub fn get_est_depletion_blocktime(&self) -> Result<u64> {   

        let clock = Clock::get()?;
        msg!("clock: {0}", clock.unix_timestamp);
        if self.rate_interval_in_seconds == 0 {
            return Ok(clock.unix_timestamp as u64); // now
        }
        let cliff_units = self.primitive_get_cliff_units()?;

        let streamable_units = self.allocation_assigned_units
            .checked_sub(cliff_units)
            .ok_or(ErrorCode::Overflow)?;

        let streaming_seconds = streamable_units
            .checked_mul(self.rate_interval_in_seconds)
            .ok_or(ErrorCode::Overflow)?
            .checked_div(self.rate_amount_units)
            .ok_or(ErrorCode::Overflow)?;

        let duration_span_seconds = streaming_seconds
            .checked_add(self.last_known_total_seconds_in_paused_status)
            .ok_or(ErrorCode::Overflow)?;

        let start_utc_seconds = self.get_start_utc()?;
        let est_depletion_time = start_utc_seconds.checked_add(duration_span_seconds).ok_or(ErrorCode::Overflow)?;
        Ok(est_depletion_time)
    }

    /// Gets the total funds sent to beneficiary (withdrawable + withdrawn)
    pub fn get_funds_sent_to_beneficiary(&self, timestamp: u64) -> Result<u64> {
        let withdrawable = self.get_beneficiary_withdrawable_amount(timestamp)?;
        let funds_sent = self.total_withdrawals_units
            .checked_add(withdrawable)
            .ok_or(ErrorCode::Overflow)?;            
        Ok(funds_sent)
    }

    /// Gets the funds that have not been withdrew
    pub fn get_funds_left_in_account(&self, timestamp: u64) -> Result<u64> { // TODO: Remove if possible

        let withdrawable = self.get_beneficiary_withdrawable_amount(timestamp)?;
        let funds_left_in_account = self.allocation_assigned_units
            .checked_sub(self.total_withdrawals_units).unwrap()
            .checked_sub(withdrawable).ok_or(ErrorCode::Overflow)?;

        Ok(funds_left_in_account)
    }

    /// Gets the remaining allocation in the stream
    pub fn get_remaining_allocation(&self) -> Result<u64> {
        let remaining_allocation = self.allocation_assigned_units
            .checked_sub(self.total_withdrawals_units)
            .ok_or(ErrorCode::Overflow)?;
        Ok(remaining_allocation)
    }

    /// Gets the beneficiary withdrawable amount in the given blocktime
    pub fn get_beneficiary_withdrawable_amount<'info>(&self, timestamp: u64) -> Result<u64> {
        #[cfg(feature = "test")]
        msg!("");
        #[cfg(feature = "test")]
        msg!("get_beneficiary_withdrawable_amount() started! ******");

        let remaining_allocation = self.get_remaining_allocation()?;

        if remaining_allocation == 0 {
            return Ok(0);
        }

        let status = self.get_status(timestamp)?;

        // Check if SCHEDULED
        if status == StreamStatus::Scheduled{
            #[cfg(feature = "test")]
            msg!("status: Scheduled");
            return Ok(0);
        }

        // Check if PAUSED
        if status == StreamStatus::Paused {
            #[cfg(feature = "test")]
            msg!("status: Paused");
            let is_manual_pause = self.primitive_is_manually_paused();
            let withdrawable_while_paused = match is_manual_pause {
                true => self.last_manual_stop_withdrawable_units_snap,
                _ => self.allocation_assigned_units
                        .checked_sub(self.total_withdrawals_units)
                        .ok_or(ErrorCode::Overflow)?
            };
            return Ok(withdrawable_while_paused);
        }
        
        // Check if RUNNING
        if self.rate_interval_in_seconds == 0 || self.rate_amount_units == 0 {
            return Err(ErrorCode::InvalidArgument.into());
        }

        let cliff_units = self.primitive_get_cliff_units()?;
        let start_utc_seconds = self.get_start_utc()?;
        let seconds_since_start = timestamp.checked_sub(start_utc_seconds).ok_or(ErrorCode::Overflow)?;

        let actual_streamed_seconds = seconds_since_start
            .checked_sub(self.last_known_total_seconds_in_paused_status) // TODO: check
            .ok_or(ErrorCode::Overflow)?;
        let actual_streamed_units = self.primitive_get_streamed_units(actual_streamed_seconds)?;
        let mut actual_earned_units = cliff_units
            .checked_add(actual_streamed_units)
            .ok_or(ErrorCode::Overflow)?;

        #[cfg(feature="test")]
        msg!("seconds_since_start: {0}, cliff_units: {1}, start_utc_seconds: {2}, actual_streamed_seconds: {3}, actual_earned_units: {4}, total_withdrawals_units: {5}", 
        seconds_since_start, cliff_units, start_utc_seconds, actual_streamed_seconds, actual_earned_units, self.total_withdrawals_units);

        // assert!(
        //     actual_earned_units >= self.total_withdrawals_units,
        //     "entitled_earning vs total_withdrawals invariant violated"
        // );
        // TODO: this is a work around the issue of not having a better way for calculating earned units after auto-PAUSED streams
        actual_earned_units = cmp::max(actual_earned_units, self.total_withdrawals_units);

        #[cfg(feature = "test")]
        msg!("stream.total_withdrawals_units: {0}", self.total_withdrawals_units);
        let withdrawable_units_while_running = actual_earned_units
            .checked_sub(self.total_withdrawals_units)
            .ok_or(ErrorCode::Overflow)?;
        #[cfg(feature = "test")]
        msg!("withdrawable_units_while_running: {0}", withdrawable_units_while_running);

        let withdrawable = cmp::min(remaining_allocation, withdrawable_units_while_running); // TODO: these two shuold be equal by now
        #[cfg(feature = "test")]
        msg!("withdrawable: {0}", withdrawable);

        #[cfg(feature = "test")]
        msg!("get_beneficiary_withdrawable_amount() finished! ******");
        #[cfg(feature = "test")]
        msg!("");

        Ok(withdrawable)
    }
    
    /// Gets the start utc seconds amount
    pub fn get_start_utc(&self) -> Result<u64> {
        if self.start_utc_in_seconds > 0 {
            return Ok(self.start_utc);
        }
        let start_utc_seconds = self.start_utc.checked_div(1000u64).ok_or(ErrorCode::Overflow)?;
        Ok(start_utc_seconds)
    }

    /// Updates the stream start UTC to seconds if it's necesary
    pub fn update_start_utc(&mut self) -> Result<()> {

        let start_utc_seconds = self.get_start_utc()?;

        if self.start_utc_in_seconds == 0 {
            self.start_utc = start_utc_seconds;
            self.start_utc_in_seconds = start_utc_seconds;
        }

        Ok(())
    }
}