use anchor_lang::prelude::*;
use anchor_spl::token::*;
use anchor_spl::associated_token::*;

use crate::constants::*;
use crate::errors::*;
use crate::treasury::*;
use crate::stream::*;
use crate::enums::*;

pub mod fee_treasury {
    anchor_lang::declare_id!("3TD6SWY9M1mLY2kZWJNavPLhwXvcRsWdnZLRaMzERJBw");
}

pub mod maintenance_authority {
    anchor_lang::declare_id!("5qEv4iKaYfGBAJy5x7R4AjVPAKFgyMuSPfqM5NXRcbyD");
}

/// Create Treasury
#[derive(Accounts, Clone)]
#[instruction(
    slot: u64,
    treasury_bump: u8,
    treasury_mint_bump: u8
)]
pub struct CreateTreasuryAccounts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub treasurer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        seeds = [treasurer.key().as_ref(), &slot.to_le_bytes()],
        bump = treasury_bump,
        space = 300
    )]
    pub treasury: Account<'info, Treasury>,
    #[account(
        init,
        payer = payer,
        seeds = [treasurer.key().as_ref(), treasury.key().as_ref(), &slot.to_le_bytes()],
        bump = treasury_mint_bump,
        mint::decimals = TREASURY_POOL_MINT_DECIMALS,
        mint::authority = treasury,
        mint::freeze_authority = treasury,
    )]
    pub treasury_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = associated_token,
        associated_token::authority = treasury
    )]
    pub treasury_token: Box<Account<'info, TokenAccount>>,
    pub associated_token: Box<Account<'info, Mint>>,

    #[account(
        mut, 
        constraint = fee_treasury.key() == fee_treasury::ID @ ErrorCode::InvalidFeeTreasuryAccount
    )]
    pub fee_treasury: SystemAccount<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Create Stream
#[derive(Accounts, Clone)]
#[instruction(
    name: String,
    start_utc: u64,
    rate_amount_units: u64,
    rate_interval_in_seconds: u64,
    allocation_assigned_units: u64,
    cliff_vest_amount_units: u64,
    cliff_vest_percent: u64,
)]
pub struct CreateStreamAccounts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub initializer: Signer<'info>,
    #[account(constraint = treasurer.key() == treasury.treasurer_address @ ErrorCode::NotAuthorized)]
    pub treasurer: Signer<'info>,
    #[account(
        mut,
        seeds = [treasurer.key().as_ref(), &treasury.slot.to_le_bytes()],
        bump = treasury.bump,
        constraint = treasury.version == 2 @ ErrorCode::InvalidTreasuryVersion,
        constraint = treasury.initialized == true @ ErrorCode::TreasuryNotInitialized,
        constraint = treasury.to_account_info().data_len() == 300 @ ErrorCode::InvalidTreasurySize
    )]
    pub treasury: Account<'info, Treasury>,
    #[account(
        mut,
        associated_token::mint = associated_token,
        associated_token::authority = treasury
    )]
    pub treasury_token: Box<Account<'info, TokenAccount>>,
    #[account(
        constraint = associated_token.key() == treasury.associated_token_address @ ErrorCode::InvalidAssociatedToken
    )]
    pub associated_token: Box<Account<'info, Mint>>,
    #[account(constraint = beneficiary.key() != treasurer.key() @ ErrorCode::InvalidBeneficiary)]
    pub beneficiary: SystemAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = 500,
        // constraint = rate_amount_units > 0 @ ErrorCode::InvalidStreamRate, // This is sent equals to zero for OTP
        // constraint = rate_interval_in_seconds > 0 @ ErrorCode::InvalidStreamRate, // This is sent equals to zero for OTP
        constraint = allocation_assigned_units >= cliff_vest_amount_units @ ErrorCode::InvalidCliff,
        constraint = cliff_vest_percent <= PERCENT_DENOMINATOR @ ErrorCode::InvalidCliff,
    )]
    pub stream: Account<'info, Stream>,
    #[account(
        mut, 
        constraint = fee_treasury.key() == fee_treasury::ID @ ErrorCode::InvalidFeeTreasuryAccount
    )]
    pub fee_treasury: SystemAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = associated_token,
        associated_token::authority = fee_treasury
    )]
    pub fee_treasury_token: Box<Account<'info, TokenAccount>>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Withdraw
#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct WithdrawAccounts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        constraint = amount > 0 @ ErrorCode::ZeroWithdrawalAmount,
        constraint = beneficiary.key() == stream.beneficiary_address @ ErrorCode::InvalidBeneficiary
    )]
    pub beneficiary: Signer<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = associated_token,
        associated_token::authority = beneficiary
    )]
    pub beneficiary_token: Box<Account<'info, TokenAccount>>,
    #[account(
        constraint = (
            associated_token.key() == treasury.associated_token_address &&
            associated_token.key() == stream.beneficiary_associated_token
        ) @ ErrorCode::InvalidAssociatedToken
    )]
    pub associated_token: Box<Account<'info, Mint>>,
    #[account(
        mut,
        seeds = [stream.treasurer_address.as_ref(), &treasury.slot.to_le_bytes()],
        bump = treasury.bump,
        constraint = treasury.version == 2 @ ErrorCode::InvalidTreasuryVersion,
        constraint = treasury.initialized == true @ ErrorCode::TreasuryNotInitialized,
        constraint = treasury.to_account_info().data_len() == 300 @ ErrorCode::InvalidTreasurySize,
    )]
    pub treasury: Account<'info, Treasury>,
    #[account(
        mut,
        associated_token::mint = associated_token,
        associated_token::authority = treasury
    )]
    pub treasury_token: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = stream.treasury_address == treasury.key() @ ErrorCode::InvalidTreasury,
        constraint = stream.version == 2 @ ErrorCode::InvalidStreamVersion,
        constraint = stream.initialized == true @ ErrorCode::StreamNotInitialized,
        constraint = stream.to_account_info().data_len() == 500 @ ErrorCode::InvalidStreamSize,
    )]
    pub stream: Account<'info, Stream>,
    #[account(
        mut, 
        constraint = fee_treasury.key() == fee_treasury::ID @ ErrorCode::InvalidFeeTreasuryAccount
    )]
    pub fee_treasury: SystemAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = associated_token,
        associated_token::authority = fee_treasury
    )]
    pub fee_treasury_token: Box<Account<'info, TokenAccount>>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Pause or Resume Stream
#[derive(Accounts)]
pub struct PauseOrResumeStreamAccounts<'info> {
    #[account(
        constraint = (
            initializer.key() == stream.treasurer_address || 
            initializer.key() == stream.beneficiary_address
        ) @ ErrorCode::NotAuthorized
    )]
    pub initializer: Signer<'info>,
    #[account(
        mut,
        seeds = [stream.treasurer_address.as_ref(), &treasury.slot.to_le_bytes()],
        bump = treasury.bump,
        constraint = treasury.version == 2 @ ErrorCode::InvalidTreasuryVersion,
        constraint = treasury.initialized == true @ ErrorCode::TreasuryNotInitialized,
        constraint = treasury.to_account_info().data_len() == 300 @ ErrorCode::InvalidTreasurySize
    )]
    pub treasury: Account<'info, Treasury>,
    #[account(
        constraint = (
            associated_token.key() == stream.beneficiary_associated_token &&
            associated_token.key() == treasury.associated_token_address
        ) @ ErrorCode::InvalidAssociatedToken,
    )]
    pub associated_token: Box<Account<'info, Mint>>,
    #[account(
        mut,
        constraint = stream.treasury_address == treasury.key() @ ErrorCode::InvalidTreasury,
        constraint = stream.version == 2 @ ErrorCode::InvalidStreamVersion,
        constraint = stream.initialized == true @ ErrorCode::StreamNotInitialized,
        constraint = stream.to_account_info().data_len() == 500 @ ErrorCode::InvalidStreamSize,
        constraint = treasury.treasury_type != TREASURY_TYPE_LOCKED @ ErrorCode::PauseOrResumeLockedStreamNotAllowed
    )]
    pub stream: Account<'info, Stream>
}



/// Refresh Treasury Data
#[derive(Accounts)]
pub struct RefreshTreasuryDataAccounts<'info> {
    #[account(constraint = treasurer.key() == treasury.treasurer_address @ ErrorCode::InvalidTreasurer)]
    pub treasurer: Signer<'info>,
    #[account(constraint = associated_token.key() == treasury.associated_token_address @ ErrorCode::InvalidAssociatedToken)]
    pub associated_token: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [treasurer.key().as_ref(), &treasury.slot.to_le_bytes()],
        bump = treasury.bump,
        constraint = treasury.treasurer_address == treasurer.key() @ ErrorCode::NotAuthorized,
        constraint = treasury.version == 2 @ ErrorCode::InvalidTreasuryVersion,
        constraint = treasury.initialized == true @ ErrorCode::TreasuryNotInitialized,
        constraint = treasury.to_account_info().data_len() == 300 @ ErrorCode::InvalidTreasurySize,
    )]
    pub treasury: Account<'info, Treasury>,
    #[account(
        mut,
        associated_token::mint = associated_token,
        associated_token::authority = treasury
    )]
    pub treasury_token: Account<'info, TokenAccount>
}

/// Transfer Stream
#[derive(Accounts)]
#[instruction(new_beneficiary: Pubkey)]
pub struct TransferStreamAccounts<'info> {
    #[account(
        mut,
        constraint = beneficiary.key() == stream.beneficiary_address @ ErrorCode::NotAuthorized
    )]
    pub beneficiary: Signer<'info>,
    #[account(
        mut,
        constraint = stream.version == 2 @ ErrorCode::InvalidStreamVersion,
        constraint = stream.initialized == true @ ErrorCode::StreamNotInitialized,
        constraint = stream.to_account_info().data_len() == 500 @ ErrorCode::InvalidStreamSize
    )]
    pub stream: Account<'info, Stream>,
    #[account(
        mut, 
        constraint = fee_treasury.key() == fee_treasury::ID @ ErrorCode::InvalidFeeTreasuryAccount
    )]
    pub fee_treasury: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Get Stream
#[derive(Accounts)]
pub struct GetStreamAccounts<'info> {
    #[account(
        constraint = stream.version == 2 @ ErrorCode::InvalidStreamVersion,
        constraint = stream.initialized == true @ ErrorCode::StreamNotInitialized,
        constraint = stream.to_account_info().data_len() == 500 @ ErrorCode::InvalidStreamSize
    )]
    pub stream: Account<'info, Stream>
}

#[derive(Accounts)]
#[instruction(
    amount: u64,
)]
pub struct AddFundsAccounts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        constraint = amount > 0 @ ErrorCode::ZeroContributionAmount
    )]
    pub contributor: Signer<'info>,
    #[account(
        mut,
        associated_token::mint = associated_token,
        associated_token::authority = contributor,
        constraint = contributor_token.amount >= amount @ ErrorCode::InsufficientFunds,
    )]
    pub contributor_token: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = treasury_mint,
        associated_token::authority = contributor
    )]
    pub contributor_treasury_token: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = treasury.version == 2 @ ErrorCode::InvalidTreasuryVersion,
        constraint = treasury.initialized == true @ ErrorCode::TreasuryNotInitialized,
        constraint = treasury.to_account_info().data_len() == 300 @ ErrorCode::InvalidTreasurySize,
        constraint = (
            treasury.associated_token_address == Pubkey::default() ||
            treasury.associated_token_address == associated_token.key()
        ) @ ErrorCode::InvalidAssociatedToken,
    )]
    pub treasury: Account<'info, Treasury>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = associated_token,
        associated_token::authority = treasury
    )]
    pub treasury_token: Box<Account<'info, TokenAccount>>,
    pub associated_token: Box<Account<'info, Mint>>,
    #[account(
        mut,
        constraint = treasury_mint.decimals == TREASURY_POOL_MINT_DECIMALS @ ErrorCode::InvalidTreasuryMintDecimals,
        constraint = treasury_mint.key() == treasury.mint_address @ ErrorCode::InvalidTreasuryMint
    )]
    pub treasury_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        constraint = fee_treasury.key() == fee_treasury::ID @ ErrorCode::InvalidFeeTreasuryAccount
    )]
    pub fee_treasury: SystemAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = associated_token,
        associated_token::authority = fee_treasury
    )]
    pub fee_treasury_token: Box<Account<'info, TokenAccount>>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(
    amount: u64,
)]
pub struct AllocateAccounts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account()]
    pub treasurer: Signer<'info>,
    #[account(
        mut,
        seeds = [stream.treasurer_address.as_ref(), &treasury.slot.to_le_bytes()],
        bump = treasury.bump,

        constraint = treasury.version == 2 @ ErrorCode::InvalidTreasuryVersion,
        constraint = treasury.initialized == true @ ErrorCode::TreasuryNotInitialized,
        constraint = treasury.to_account_info().data_len() == 300 @ ErrorCode::InvalidTreasurySize,
        constraint = treasury.associated_token_address == associated_token.key() @ ErrorCode::InvalidAssociatedToken,
        constraint = treasury.treasury_type != TREASURY_TYPE_LOCKED @ ErrorCode::AllocateNotAllowedOnLockedStreams,
        constraint = treasury.treasurer_address == treasurer.key() @ ErrorCode::InvalidTreasurer,
    )]
    pub treasury: Account<'info, Treasury>,
    #[account(
        mut,
        associated_token::mint = associated_token,
        associated_token::authority = treasury
    )]
    pub treasury_token: Box<Account<'info, TokenAccount>>,
    pub associated_token: Box<Account<'info, Mint>>,
    #[account(
        mut,
        constraint = stream.treasury_address == treasury.key() @ ErrorCode::InvalidTreasury,
        constraint = stream.version == 2 @ ErrorCode::InvalidStreamVersion,
        constraint = stream.initialized == true @ ErrorCode::StreamNotInitialized,
        constraint = stream.to_account_info().data_len() == 500 @ ErrorCode::InvalidStreamSize,
        constraint = (
            treasury.treasury_type != TREASURY_TYPE_LOCKED || 
            stream.get_status(Clock::get()?.unix_timestamp as u64)? == StreamStatus::Paused // TODO: Review
        ) @ ErrorCode::CloseLockedStreamNotAllowedWhileRunning,

        constraint = stream.treasurer_address == treasurer.key() @ ErrorCode::InvalidTreasurer,
        constraint = stream.beneficiary_associated_token == associated_token.key() @ ErrorCode::InvalidTreasury, // Probably redundant check
    )]
    pub stream: Account<'info, Stream>,
    #[account(
        mut,
        constraint = fee_treasury.key() == fee_treasury::ID @ ErrorCode::InvalidFeeTreasuryAccount
    )]
    pub fee_treasury: SystemAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = associated_token,
        associated_token::authority = fee_treasury
    )]
    pub fee_treasury_token: Box<Account<'info, TokenAccount>>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CloseStreamAccounts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        constraint = (
            treasurer.key() == stream.treasurer_address && 
            treasurer.key() == treasury.treasurer_address
        ) @ ErrorCode::InvalidTreasurer
    )]
    pub treasurer: Signer<'info>,
    #[account(
        constraint = beneficiary.key() == stream.beneficiary_address @ ErrorCode::InvalidBeneficiary
    )]
    pub beneficiary: SystemAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = associated_token,
        associated_token::authority = beneficiary
    )]
    pub beneficiary_token: Box<Account<'info, TokenAccount>>,
    #[account(
        constraint = (
            associated_token.key() == stream.beneficiary_associated_token &&
            associated_token.key() == treasury.associated_token_address
        ) @ ErrorCode::InvalidAssociatedToken,
    )]
    pub associated_token: Box<Account<'info, Mint>>,
    #[account(
        mut,
        seeds = [stream.treasurer_address.as_ref(), &treasury.slot.to_le_bytes()],
        bump = treasury.bump,
        constraint = treasury.version == 2 @ ErrorCode::InvalidTreasuryVersion,
        constraint = treasury.initialized == true @ ErrorCode::TreasuryNotInitialized,
        constraint = treasury.to_account_info().data_len() == 300 @ ErrorCode::InvalidTreasurySize
    )]
    pub treasury: Account<'info, Treasury>,
    #[account(
        mut,
        associated_token::mint = associated_token,
        associated_token::authority = treasury
    )]
    pub treasury_token: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        close = payer,
        constraint = stream.treasury_address == treasury.key() @ ErrorCode::InvalidTreasury,
        constraint = stream.version == 2 @ ErrorCode::InvalidStreamVersion,
        constraint = stream.initialized == true @ ErrorCode::StreamNotInitialized,
        constraint = stream.to_account_info().data_len() == 500 @ ErrorCode::InvalidStreamSize,
        constraint = (
            treasury.treasury_type != TREASURY_TYPE_LOCKED || stream.get_status(Clock::get()?.unix_timestamp as u64)? == StreamStatus::Paused
        ) @ ErrorCode::CloseLockedStreamNotAllowedWhileRunning
    )]
    pub stream: Account<'info, Stream>,
    #[account(
        mut, 
        constraint = fee_treasury.key() == fee_treasury::ID @ ErrorCode::InvalidFeeTreasuryAccount
    )]
    pub fee_treasury: SystemAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = associated_token,
        associated_token::authority = fee_treasury
    )]
    pub fee_treasury_token: Box<Account<'info, TokenAccount>>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CloseTreasuryAccounts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        constraint = treasurer.key() == treasury.treasurer_address @ ErrorCode::InvalidTreasurer
    )]
    pub treasurer: Signer<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = treasury_mint,
        associated_token::authority = treasurer
    )]
    pub treasurer_treasury_token: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub destination_authority: SystemAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = associated_token,
        associated_token::authority = destination_authority,
    )]
    pub destination_token_account: Box<Account<'info, TokenAccount>>,
    #[account(
        constraint = (
            treasury.associated_token_address == Pubkey::default() ||
            associated_token.key() == treasury.associated_token_address
         ) @ ErrorCode::InvalidAssociatedToken
    )]
    pub associated_token: Box<Account<'info, Mint>>,
    #[account(
        mut,
        seeds = [treasurer.key().as_ref(), &treasury.slot.to_le_bytes()],
        bump = treasury.bump,
        close = destination_authority,
        constraint = treasury.version == 2 @ ErrorCode::InvalidTreasuryVersion,
        constraint = treasury.initialized == true @ ErrorCode::TreasuryNotInitialized,
        constraint = treasury.to_account_info().data_len() == 300 @ ErrorCode::InvalidTreasurySize,
        constraint = treasury.total_streams == 0 @ ErrorCode::TreasuryContainsStreams,
    )]
    pub treasury: Account<'info, Treasury>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = associated_token,
        associated_token::authority = treasury
    )]
    pub treasury_token: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = treasury_mint.decimals == TREASURY_POOL_MINT_DECIMALS @ ErrorCode::InvalidTreasuryMintDecimals,
        constraint = treasury_mint.key() == treasury.mint_address @ ErrorCode::InvalidTreasuryMint
    )]
    pub treasury_mint: Box<Account<'info, Mint>>,
    #[account(
        mut, 
        constraint = fee_treasury.key() == fee_treasury::ID @ ErrorCode::InvalidFeeTreasuryAccount
    )]
    pub fee_treasury: SystemAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = associated_token,
        associated_token::authority = fee_treasury
    )]
    pub fee_treasury_token: Box<Account<'info, TokenAccount>>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// #[derive(Accounts)]
// #[instruction(
//     new_allocated_amount: u64,
//     new_withdrawals_amount: u64
// )]
// pub struct UpdateTreasuryDataAccounts<'info> {
//     #[account(
//         mut, 
//         address = maintenance_authority::ID @ ErrorCode::NotAuthorized
//     )]
//     pub authority: Signer<'info>,
//     #[account(
//         constraint = associated_token.key() == treasury.associated_token_address @ ErrorCode::InvalidAssociatedToken
//     )]
//     pub associated_token: Account<'info, Mint>,
//     #[account(
//         mut,
//         seeds = [treasury.treasurer_address.as_ref(), &treasury.slot.to_le_bytes()],
//         bump = treasury.bump,
//         constraint = treasury.version == 2 @ ErrorCode::InvalidTreasuryVersion,
//         constraint = treasury.initialized == true @ ErrorCode::TreasuryNotInitialized,
//         constraint = treasury.to_account_info().data_len() == 300 @ ErrorCode::InvalidTreasurySize,
//     )]
//     pub treasury: Account<'info, Treasury>,
//     #[account(
//         mut,
//         associated_token::mint = associated_token,
//         associated_token::authority = treasury,
//         constraint = treasury_token.amount >= new_allocated_amount @ ErrorCode::InvalidTreasuryRequestedAllocation
//     )]
//     pub treasury_token: Account<'info, TokenAccount>
// }


#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct TreasuryWithdrawAccounts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = treasury.treasurer_address @ ErrorCode::InvalidTreasurer
    )]
    pub treasurer: Signer<'info>,
    #[account()]
    pub destination_authority: SystemAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = associated_token,
        associated_token::authority = destination_authority,
    )]
    pub destination_token_account: Box<Account<'info, TokenAccount>>,
    #[account(
        address = treasury.associated_token_address @ ErrorCode::InvalidAssociatedToken
    )]
    pub associated_token: Box<Account<'info, Mint>>,
    #[account(
        mut,
        seeds = [treasurer.key().as_ref(), &treasury.slot.to_le_bytes()],
        bump = treasury.bump,
        constraint = treasury.version == 2 @ ErrorCode::InvalidTreasuryVersion,
        constraint = treasury.initialized == true @ ErrorCode::TreasuryNotInitialized,
        constraint = treasury.to_account_info().data_len() == 300 @ ErrorCode::InvalidTreasurySize,
        constraint = amount > 0 @ ErrorCode::InvalidWithdrawalAmount,
        constraint = treasury.last_known_unallocated_balance()? >= amount @ ErrorCode::InsufficientTreasuryBalance,
    )]
    pub treasury: Account<'info, Treasury>,
    #[account(
        mut,
        associated_token::mint = associated_token,
        associated_token::authority = treasury
    )]
    pub treasury_token: Box<Account<'info, TokenAccount>>,
    #[account(
        mut, 
        constraint = fee_treasury.key() == fee_treasury::ID @ ErrorCode::InvalidFeeTreasuryAccount
    )]
    pub fee_treasury: SystemAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = associated_token,
        associated_token::authority = fee_treasury
    )]
    pub fee_treasury_token: Box<Account<'info, TokenAccount>>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
