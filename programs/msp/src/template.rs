use anchor_lang::prelude::*;

#[account]
pub struct StreamTemplate {
    pub version: u8, // offset: 8
    pub bump: u8,
    /// The start timestamp blocktime
    pub start_utc_in_seconds: u64,

    /// The percentage availaible to withdraw inmidiately (without streaming)
    /// once the money stream starts.
    pub cliff_vest_percent: u64,

    pub rate_interval_in_seconds: u64,
    pub duration_number_of_units: u64,

    pub fee_payed_by_treasurer: bool,
    // total bytes: 43
}
