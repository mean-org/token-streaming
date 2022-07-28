use crate::errors::ErrorCode;
use crate::treasury::*;
use anchor_lang::prelude::*;

// TODO: move into 'close stream'
pub fn close_stream_update_treasury<'info>(
    treasury: &mut Treasury,
    transferred_out_units: u64,
    deallocated_units: u64,
    timestamp: u64,
    slot: u64,
) -> Result<()> {
    assert!(deallocated_units >= transferred_out_units);

    if treasury.allocation_assigned_units > deallocated_units {
        treasury.allocation_assigned_units = treasury
            .allocation_assigned_units
            .checked_sub(deallocated_units)
            .ok_or(ErrorCode::Overflow)?;
    } else {
        treasury.allocation_assigned_units = 0;
    }

    treasury.last_known_balance_slot = slot;
    treasury.last_known_balance_block_time = timestamp;

    if treasury.last_known_balance_units > transferred_out_units {
        treasury.last_known_balance_units = treasury
            .last_known_balance_units
            .checked_sub(transferred_out_units)
            .ok_or(ErrorCode::Overflow)?;
    } else {
        treasury.last_known_balance_units = 0;
    }

    if treasury.total_streams > 0 {
        treasury.total_streams = treasury.total_streams.checked_sub(1).unwrap();
    } else {
        return Err(ErrorCode::InvalidTotalStreamsInTreasury.into());
    }

    Ok(())
}
