use anchor_lang::prelude::*;
use anchor_spl::token::*;
use crate::treasury::*;
use crate::stream::*;
use crate::errors::*;

// TODO: Temporary disabled until proper handling of the pool tokens mited to the contributor is implemented 
// pub fn create_deposit_receipt<'info>(
//     treasury: &Account<'info, Treasury>,
//     mint: &AccountInfo<'info>,
//     to: &AccountInfo<'info>,
//     token_program: &AccountInfo<'info>,
//     amount: u64,

// ) -> ProgramResult {

//     let treasury_signer_seed: &[&[&[_]]] = &[&[
//         treasury.treasurer_address.as_ref(),
//         &treasury.slot.to_le_bytes(),
//         &treasury.bump.to_le_bytes()
//     ]];
//     let cpi_accounts = MintTo { 
//         mint: mint.clone(), 
//         to: to.clone(), 
//         authority: treasury.to_account_info().clone() 
//     };
//     let mint_cpi_ctx = CpiContext::new_with_signer(token_program.clone(), cpi_accounts, treasury_signer_seed);

//     mint_to(mint_cpi_ctx, amount)
// }

pub fn validate_stream<'info>(
    stream_account: &Account<'info, Stream>,
    treasury_info: &AccountInfo<'info>,
    associated_token_info: &AccountInfo<'info>
    
) -> ProgramResult {
    
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

pub fn close_treasury_pool_token_account<'info>(
    treasurer: &AccountInfo<'info>,
    treasurer_treasury_token: &AccountInfo<'info>,
    treasury_mint: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    amount: u64

) -> ProgramResult {

    if treasurer_treasury_token.data_len() == TokenAccount::LEN {
        // Burn
        let burn_cpi_accounts = Burn {
            mint: treasury_mint.clone(), 
            to: treasurer_treasury_token.clone(), 
            authority: treasurer.clone()
        };

        let burn_cpi_ctx = CpiContext::new(token_program.clone(), burn_cpi_accounts);
        burn(burn_cpi_ctx, amount)?;
        
        // Close treasurer treasury token account
        let close_token_cpi_accounts = CloseAccount { 
            account: treasurer_treasury_token.clone(), 
            destination: treasurer.clone(),
            authority: treasurer.clone()
        };

        let close_token_cpi_ctx = CpiContext::new(token_program.clone(), close_token_cpi_accounts);
        close_account(close_token_cpi_ctx)?;
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
) -> ProgramResult {

    assert!(deallocated_units >= transferred_out_units);

    if treasury.allocation_assigned_units > deallocated_units {
        treasury.allocation_assigned_units = treasury.allocation_assigned_units
            .checked_sub(deallocated_units).ok_or(ErrorCode::Overflow)?;
    } else {
        treasury.allocation_assigned_units = 0;
    }

    treasury.last_known_balance_slot = slot;
    treasury.last_known_balance_block_time = timestamp;
    
    if treasury.last_known_balance_units > transferred_out_units {
        treasury.last_known_balance_units = treasury.last_known_balance_units
                .checked_sub(transferred_out_units).ok_or(ErrorCode::Overflow)?;
    } else {
        treasury.last_known_balance_units = 0;
    }
    
    if treasury.total_streams > 0 {
        treasury.total_streams = treasury.total_streams.checked_sub(1).unwrap();
    }

    Ok(())
}