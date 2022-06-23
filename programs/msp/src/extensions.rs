use crate::errors::ErrorCode;
use crate::stream::*;
use crate::treasury::*;
use anchor_lang::prelude::*;

pub fn validate_stream<'info>(
    stream_account: &Account<'info, Stream>,
    treasury_info: &AccountInfo<'info>,
    associated_token_info: &AccountInfo<'info>,
) -> Result<()> {
    let stream = &mut stream_account.clone().into_inner() as &mut Stream;

    if stream.treasury_address != *treasury_info.key {
        return Err(ErrorCode::InvalidTreasury.into());
    }
    if stream.beneficiary_associated_token != *associated_token_info.key {
        return Err(ErrorCode::InvalidTreasury.into());
    }
    if stream.version != 2 {
        return Err(ErrorCode::InvalidStreamVersion.into());
    }
    if stream.initialized == false {
        return Err(ErrorCode::StreamNotInitialized.into());
    }
    if stream_account.to_account_info().data_len() != 500 {
        return Err(ErrorCode::InvalidStreamSize.into());
    }

    Ok(())
}

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
