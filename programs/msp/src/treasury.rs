use anchor_lang::prelude::*;

use crate::errors::ErrorCode;

#[account]
pub struct Treasury {
    pub initialized: bool,
    pub version: u8,
    pub bump: u8,
    pub slot: u64,
    pub name: [u8; 32],
    pub treasurer_address: Pubkey,
    pub associated_token_address: Pubkey,
    /// [deprecated] The address of the Mint of the treasury pool
    // #[deprecated]
    pub mint_address: Pubkey,
    /// Max 5 labels per treasury
    pub labels: Vec<String>,
    /// Treasury balance tracking
    /// The last known treasury balance (will be updated in the `refreshTreasuryData` instruction)
    pub last_known_balance_units: u64,
    /// The slot of the last time the treasury balance was updated
    pub last_known_balance_slot: u64,
    /// The blocktime when the treasury balance was updated
    pub last_known_balance_block_time: u64,
    /// Treasury allocation tracking
    /// The allocation assigned accross all the streams that belong to this treasury
    ///
    /// The allocation assined will be modified in the following instructions:
    /// `createStream`, `withdraw` and `closeStream`
    pub allocation_assigned_units: u64,
    /// The allocation reserved accross all the streams that belong to this treasury
    ///
    /// [deprecated] The allocation reserved will be modified in the following instructions:
    /// `createStream`, `withdraw` and `closeStream`
    // #[deprecated]
    pub allocation_reserved_units: u64, // deprecated
    /// The total amount withdrawn by all the streams that belong to this treasury
    pub total_withdrawals_units: u64,
    /// The current amount of streams in the treasury (will be updated in the `refreshTreasuryData` instruction)
    pub total_streams: u64,
    pub created_on_utc: u64,
    /// The type of the treasury (Open, Locked)
    pub treasury_type: u8,
    /// only used for filtering in the ui
    pub auto_close: bool,
    /// Indicates whether program sol fees are payed from the `treasury`'s
    /// lamports balance (when true) or by the `payer` account in the
    /// transaction (when false)
    pub sol_fee_payed_by_treasury: bool,
    /// Indicates the main product category such as `Vesting(1)`
    /// The default value is set to a `Default(0)` cateogry.
    pub category: u8,
}

impl Treasury {
    /// Gets the last known unallocated balance as
    /// `last_known_balance_units` - `allocation_assigned_units`
    pub fn last_known_unallocated_balance(&self) -> Result<u64> {
        let result = self
            .last_known_balance_units
            .checked_sub(self.allocation_assigned_units)
            .ok_or(ErrorCode::Overflow)?;
        #[cfg(feature = "test")]
        msg!("last_known_unallocated_balance: {0}", result);
        Ok(result)
    }
}
