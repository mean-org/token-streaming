use anchor_lang::prelude::*;

#[event]
pub struct StreamEvent {
    // state data
    pub version: u8,
    pub initialized: bool,
    pub name: [u8; 32],
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
    pub beneficiary_withdrawable_amount: u64, // withdrawable_units,
    pub last_known_stop_block_time: u64
}