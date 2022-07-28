use anchor_lang::prelude::*;

#[event]
pub struct StreamEvent {
    // state data
    pub version: u8,
    pub initialized: bool,
    pub name: String,
    pub treasurer_address: Pubkey,
    pub rate_amount_units: u64,
    pub rate_interval_in_seconds: u64,
    pub start_utc: u64,
    pub cliff_vest_amount_units: u64,
    pub cliff_vest_percent: u64,
    pub beneficiary_address: Pubkey,
    pub beneficiary_associated_token: Pubkey,
    pub treasury_address: Pubkey,
    pub allocation_assigned_units: u64,
    #[deprecated]
    pub allocation_reserved_units: u64, // deprecated
    pub total_withdrawals_units: u64,
    pub last_withdrawal_units: u64,
    pub last_withdrawal_slot: u64,
    pub last_withdrawal_block_time: u64,
    pub last_manual_stop_withdrawable_units_snap: u64,
    pub last_manual_stop_slot: u64,
    pub last_manual_stop_block_time: u64,
    pub last_manual_resume_remaining_allocation_units_snap: u64,
    pub last_manual_resume_slot: u64,
    pub last_manual_resume_block_time: u64,
    pub last_known_total_seconds_in_paused_status: u64,
    pub last_auto_stop_block_time: u64,
    pub fee_payed_by_treasurer: bool,
    // calculated data
    pub status: String,
    pub is_manual_pause: bool,
    pub cliff_units: u64,
    pub current_block_time: u64,
    pub seconds_since_start: u64,
    pub est_depletion_time: u64,
    // pub streamed_units_per_second: f64,
    pub funds_left_in_stream: u64,
    pub funds_sent_to_beneficiary: u64,
    pub withdrawable_units_while_paused: u64,
    pub non_stop_earning_units: u64,
    pub missed_units_while_paused: u64,
    pub entitled_earnings_units: u64,
    pub withdrawable_units_while_running: u64,
    pub beneficiary_remaining_allocation: u64, // unused_allocation
    pub beneficiary_withdrawable_amount: u64,  // withdrawable_units,
    pub last_known_stop_block_time: u64,
    /// Unix timestamp (in seconds) when the stream was created
    pub created_on_utc: u64,
    pub category: u8,
    pub sub_category: u8,
}

#[event]
pub struct CreateTreasuryEvent {
    pub timestamp: u64,
    pub sol_fee_charged: u64,
    pub token_fee_charged: u64,
    pub sol_deposited_for_fees: u64,
    pub treasury_is_sol_fee_payed_by_treasury: bool,
    pub treasury_type: u8,
    pub treasury_is_auto_close: bool,
    #[index]
    pub treasury: Pubkey,
}

#[event]
pub struct CreateStreamEvent {
    pub timestamp: u64,
    pub sol_fee_charged: u64,
    pub token_fee_charged: u64,
    pub stream_start_ts: u64,
    pub stream_rate_amount: u64,
    pub stream_rate_interval: u64,
    pub stream_allocation: u64,
    pub stream_cliff: u64,
    pub stream_is_token_withdraw_fee_payed_by_treasury: bool,
    pub treasury_is_sol_fee_payed_by_treasury: bool,
    pub treasury_allocation_after: u64,
    pub treasury_balance_after: u64,
    #[index]
    pub stream: Pubkey,
    #[index]
    pub treasury: Pubkey,
}

#[event]
pub struct StreamWithdrawEvent {
    pub timestamp: u64,
    pub sol_fee_charged: u64,
    pub token_fee_charged: u64,
    pub amount: u64,
    pub token_amount_sent_to_beneficiary: u64,
    pub stream_withdrawable_before: u64,
    pub stream_is_manually_paused: bool,
    pub stream_allocation_after: u64,
    pub stream_total_withdrawals_after: u64,
    pub stream_is_token_withdraw_fee_payed_by_treasury: bool,
    pub treasury_is_sol_fee_payed_by_treasury: bool,
    pub treasury_allocation_after: u64,
    pub treasury_balance_after: u64,
    pub treasury_total_withdrawals_after: u64,
    #[index]
    pub stream: Pubkey,
    #[index]
    pub treasury: Pubkey,
}

#[event]
pub struct StreamPauseEvent {
    pub timestamp: u64,
    pub sol_fee_charged: u64,
    pub token_fee_charged: u64,
    pub stream_last_manual_stop_withdrawable_after: u64,
    #[index]
    pub stream: Pubkey,
    #[index]
    pub treasury: Pubkey,
}

#[event]
pub struct StreamResumeEvent {
    pub timestamp: u64,
    pub sol_fee_charged: u64,
    pub token_fee_charged: u64,
    pub stream_total_seconds_in_paused_status_after: u64,
    #[index]
    pub stream: Pubkey,
    #[index]
    pub treasury: Pubkey,
}

#[event]
pub struct TreasuryRefreshEvent {
    pub timestamp: u64,
    pub sol_fee_charged: u64,
    pub token_fee_charged: u64,
    pub treasury_balance_after: u64,
    #[index]
    pub treasury: Pubkey,
}

#[event]
pub struct StreamTransferEvent {
    pub timestamp: u64,
    pub sol_fee_charged: u64,
    pub token_fee_charged: u64,
    #[index]
    pub stream: Pubkey,
    #[index]
    pub treasury: Pubkey,
    pub previous_beneficiary: Pubkey,
    pub new_beneficiary: Pubkey,
}

#[event]
pub struct TreasuryAddFundsEvent {
    pub timestamp: u64,
    pub sol_fee_charged: u64,
    pub token_fee_charged: u64,
    pub amount: u64,
    pub treasury_is_sol_fee_payed_by_treasury: bool,
    pub treasury_balance_after: u64,
    #[index]
    pub treasury: Pubkey,
}

#[event]
pub struct StreamAllocateEvent {
    pub timestamp: u64,
    pub sol_fee_charged: u64,
    pub token_fee_charged: u64,
    pub amount: u64,
    pub stream_status_before: u32,
    pub stream_was_manually_paused_before: bool,
    pub stream_last_auto_stop_block_time: u64,
    pub stream_total_seconds_in_paused_status_after: u64,
    pub stream_is_token_withdraw_fee_payed_by_treasury: bool,
    pub stream_allocation_after: u64,
    pub treasury_is_sol_fee_payed_by_treasury: bool,
    pub treasury_allocation_after: u64,
    pub treasury_balance_after: u64,
    #[index]
    pub stream: Pubkey,
    #[index]
    pub treasury: Pubkey,
}

#[event]
pub struct CloseStreamEvent {
    pub timestamp: u64,
    pub sol_fee_charged: u64,
    pub token_fee_charged: u64,
    pub token_amount_sent_to_beneficiary: u64,
    pub stream_is_token_withdraw_fee_payed_by_treasury: bool,
    pub stream_allocation_before: u64,
    pub stream_total_withdrawals_before: u64,
    pub treasury_is_sol_fee_payed_by_treasury: bool,
    pub treasury_allocation_after: u64,
    pub treasury_balance_after: u64,
    pub treasury_total_streams_after: u64,
    #[index]
    pub stream: Pubkey,
    #[index]
    pub treasury: Pubkey,
}

#[event]
pub struct CloseTreasuryEvent {
    pub timestamp: u64,
    pub sol_fee_charged: u64,
    pub token_fee_charged: u64,
    pub token_amount_sent_to_destination: u64,
    pub treasury_is_sol_fee_payed_by_treasury: bool,
    #[index]
    pub treasury: Pubkey,
}

#[event]
pub struct TreasuryWithdrawEvent {
    pub timestamp: u64,
    pub sol_fee_charged: u64,
    pub token_fee_charged: u64,
    pub amount: u64,
    pub token_amount_sent_to_destination: u64,
    pub treasury_is_sol_fee_payed_by_treasury: bool,
    pub treasury_balance_after: u64,
    #[index]
    pub treasury: Pubkey,
}
