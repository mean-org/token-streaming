use anchor_lang::prelude::*;
use anchor_spl::associated_token::*;
use anchor_spl::token::*;

use crate::constants::*;
use crate::enums::*;
use crate::errors::ErrorCode;
use crate::stream::*;
use crate::template::*;
use crate::treasury::*;
use crate::categories::*;

pub mod fee_treasury {
    anchor_lang::declare_id!("3TD6SWY9M1mLY2kZWJNavPLhwXvcRsWdnZLRaMzERJBw");
}

pub mod maintenance_authority {
    anchor_lang::declare_id!("5qEv4iKaYfGBAJy5x7R4AjVPAKFgyMuSPfqM5NXRcbyD");
}

/// Create Treasury
#[derive(Accounts, Clone)]
#[instruction(
    idl_file_version: u8,
    slot: u64,
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
        bump,
        space = 300,
        constraint = idl_file_version == IDL_FILE_VERSION @ErrorCode::InvalidIdlFileVersion,
    )]
    pub treasury: Account<'info, Treasury>,

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
    idl_file_version: u8,
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
    #[account(constraint = treasurer.key() == treasury.treasurer_address @ ErrorCode::NotAuthorized)]
    pub treasurer: Signer<'info>,
    #[account(
        mut,
        seeds = [treasurer.key().as_ref(), &treasury.slot.to_le_bytes()],
        bump = treasury.bump,
        constraint = treasury.version == 2 @ ErrorCode::InvalidTreasuryVersion,
        constraint = treasury.initialized == true @ ErrorCode::TreasuryNotInitialized,
        constraint = treasury.to_account_info().data_len() == 300 @ ErrorCode::InvalidTreasurySize,
        constraint = idl_file_version == IDL_FILE_VERSION @ErrorCode::InvalidIdlFileVersion,
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
        // rate_amount_units and rate_interval_in_seconds are allowed to be
        // equal to zero to support one time payments (OTP)
        // Here, because we are forcing cliff_vest_amount_units to be positive,
        // we are also forcing allocation_assigned_units to be positive
        constraint = (
                rate_amount_units == 0 &&
                rate_interval_in_seconds == 0 &&
                cliff_vest_amount_units > 0 &&
                cliff_vest_amount_units == allocation_assigned_units) ||
            (rate_amount_units > 0 && rate_interval_in_seconds > 0)
            @ ErrorCode::InvalidStreamRate,
        constraint = allocation_assigned_units >= cliff_vest_amount_units @ ErrorCode::InvalidCliff,
        constraint = cliff_vest_percent <= PERCENT_DENOMINATOR @ ErrorCode::InvalidCliff,
        // passing both, cliff amount and cliff percent is not allowed
        constraint = (cliff_vest_amount_units == 0 || cliff_vest_percent == 0) @ ErrorCode::InvalidCliff,
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

/// Create Stream
#[derive(Accounts, Clone)]
#[instruction(
    idl_file_version: u8,
    name: String,
    start_utc: u64,
    rate_amount_units: u64,
    rate_interval_in_seconds: u64,
    allocation_assigned_units: u64,
    cliff_vest_amount_units: u64,
    cliff_vest_percent: u64,
    _fee_payed_by_treasurer: bool,
    stream_pda_seed: Pubkey,
)]
pub struct CreateStreamPdaAccounts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(constraint = treasurer.key() == treasury.treasurer_address @ ErrorCode::NotAuthorized)]
    pub treasurer: Signer<'info>,
    #[account(
        mut,
        seeds = [treasurer.key().as_ref(), &treasury.slot.to_le_bytes()],
        bump = treasury.bump,
        constraint = treasury.version == 2 @ ErrorCode::InvalidTreasuryVersion,
        constraint = treasury.initialized == true @ ErrorCode::TreasuryNotInitialized,
        constraint = treasury.to_account_info().data_len() == 300 @ ErrorCode::InvalidTreasurySize,
        constraint = idl_file_version == IDL_FILE_VERSION @ErrorCode::InvalidIdlFileVersion,
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
        seeds = [
            b"stream",
            treasury.key().as_ref(),
            stream_pda_seed.key().as_ref()
        ],
        bump,
        payer = payer,
        space = 500,
        // rate_amount_units and rate_interval_in_seconds are allowed to be
        // equal to zero to support one time payments (OTP)
        // Here, because we are forcing cliff_vest_amount_units to be positive,
        // we are also forcing allocation_assigned_units to be positive
        constraint = (
                rate_amount_units == 0 &&
                rate_interval_in_seconds == 0 &&
                cliff_vest_amount_units > 0 &&
                cliff_vest_amount_units == allocation_assigned_units) ||
            (rate_amount_units > 0 && rate_interval_in_seconds > 0)
            @ ErrorCode::InvalidStreamRate,
        constraint = allocation_assigned_units >= cliff_vest_amount_units @ ErrorCode::InvalidCliff,
        constraint = cliff_vest_percent <= PERCENT_DENOMINATOR @ ErrorCode::InvalidCliff,
        // passing both, cliff amount and cliff percent is not allowed
        constraint = (cliff_vest_amount_units == 0 || cliff_vest_percent == 0) @ ErrorCode::InvalidCliff,
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

/// Create Treasury And Template
#[derive(Accounts, Clone)]
#[instruction(
    idl_file_version: u8,
    name: String,
    treasury_type: u8,
    auto_close: bool,
    sol_fee_payed_by_treasury: bool,
    category: Category,
    sub_category: SubCategory,
    start_utc: u64,
    rate_interval_in_seconds: u64,
    duration_number_of_units: u64,
    cliff_vest_percent: u64,
    fee_payed_by_treasurer: bool,
    slot: u64,
)]
pub struct CreateTreasuryAndTemplateAccounts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub treasurer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        seeds = [treasurer.key().as_ref(), &slot.to_le_bytes()],
        bump,
        space = 300,
        constraint = idl_file_version == IDL_FILE_VERSION @ErrorCode::InvalidIdlFileVersion,
    )]
    pub treasury: Account<'info, Treasury>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = associated_token,
        associated_token::authority = treasury
    )]
    pub treasury_token: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        seeds = [b"template", treasury.key().as_ref()],
        bump,
        payer = payer,
        space = 200,
        constraint = rate_interval_in_seconds > 0 @ ErrorCode::InvalidStreamRate,
        constraint = duration_number_of_units > 0 @ ErrorCode::NumberOfIntervalsMustBePossitive,
        constraint = cliff_vest_percent <= PERCENT_DENOMINATOR @ ErrorCode::InvalidCliff,
    )]
    pub template: Box<Account<'info, StreamTemplate>>,

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

#[derive(Accounts, Clone)]
#[instruction(
    idl_file_version: u8,
    start_utc: u64,
    rate_interval_in_seconds: u64,
    duration_number_of_units: u64,
    cliff_vest_percent: u64,
    fee_payed_by_treasurer: bool,
)]
pub struct CreateStreamTemplateAccounts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(constraint = treasurer.key() == treasury.treasurer_address @ ErrorCode::NotAuthorized)]
    pub treasurer: Signer<'info>,

    #[account(
        mut,
        seeds = [treasurer.key().as_ref(), &treasury.slot.to_le_bytes()],
        bump = treasury.bump,
        constraint = treasury.version == 2 @ ErrorCode::InvalidTreasuryVersion,
        constraint = treasury.initialized == true @ ErrorCode::TreasuryNotInitialized,
        constraint = treasury.to_account_info().data_len() == 300 @ ErrorCode::InvalidTreasurySize,
        constraint = idl_file_version == IDL_FILE_VERSION @ErrorCode::InvalidIdlFileVersion,
    )]
    pub treasury: Box<Account<'info, Treasury>>,

    #[account(
        init,
        seeds = [b"template", treasury.key().as_ref()],
        bump,
        payer = payer,
        space = 200,
        constraint = rate_interval_in_seconds > 0 @ ErrorCode::InvalidStreamRate,
        constraint = duration_number_of_units > 0 @ ErrorCode::NumberOfIntervalsMustBePossitive,
        constraint = cliff_vest_percent <= PERCENT_DENOMINATOR @ ErrorCode::InvalidCliff,
    )]
    pub template: Box<Account<'info, StreamTemplate>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts, Clone)]
#[instruction(
    idl_file_version: u8,
    start_utc: u64,
    rate_interval_in_seconds: u64,
    duration_number_of_units: u64,
    cliff_vest_percent: u64,
    fee_payed_by_treasurer: bool,
)]
pub struct ModifyStreamTemplateAccounts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(constraint = treasurer.key() == treasury.treasurer_address @ ErrorCode::NotAuthorized)]
    pub treasurer: Signer<'info>,

    #[account(
        mut,
        seeds = [treasurer.key().as_ref(), &treasury.slot.to_le_bytes()],
        bump = treasury.bump,
        constraint = treasury.version == 2 @ ErrorCode::InvalidTreasuryVersion,
        constraint = treasury.initialized == true @ ErrorCode::TreasuryNotInitialized,
        constraint = treasury.to_account_info().data_len() == 300 @ ErrorCode::InvalidTreasurySize,
        constraint = idl_file_version == IDL_FILE_VERSION @ErrorCode::InvalidIdlFileVersion,
    )]
    pub treasury: Box<Account<'info, Treasury>>,

    #[account(
        mut,
        seeds = [b"template", treasury.key().as_ref()],
        bump = template.bump,
        constraint = treasury.total_streams == 0 @ ErrorCode::CannotModifyTemplate,
        constraint = rate_interval_in_seconds > 0 @ ErrorCode::InvalidStreamRate,
        constraint = cliff_vest_percent <= PERCENT_DENOMINATOR @ ErrorCode::InvalidCliff,
    )]
    pub template: Box<Account<'info, StreamTemplate>>,
}

/// Create stream with template
#[derive(Accounts, Clone)]
#[instruction(
    idl_file_version: u8,
    name: String,
    allocation_assigned_units: u64,
)]
pub struct CreateStreamWithTemplateAccounts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(constraint = treasurer.key() == treasury.treasurer_address @ ErrorCode::NotAuthorized)]
    pub treasurer: Signer<'info>,
    #[account(
        mut,
        seeds = [treasurer.key().as_ref(), &treasury.slot.to_le_bytes()],
        bump = treasury.bump,
        constraint = treasury.version == 2 @ ErrorCode::InvalidTreasuryVersion,
        constraint = treasury.initialized == true @ ErrorCode::TreasuryNotInitialized,
        constraint = treasury.to_account_info().data_len() == 300 @ ErrorCode::InvalidTreasurySize,
        constraint = idl_file_version == IDL_FILE_VERSION @ErrorCode::InvalidIdlFileVersion
    )]
    pub treasury: Box<Account<'info, Treasury>>,
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
        seeds = [b"template", treasury.key().as_ref()],
        bump = template.bump,
        constraint = template.version == 2 @ ErrorCode::InvalidTemplateVersion,
        constraint = template.to_account_info().data_len() == 200 @ ErrorCode::InvalidTemplateSize
    )]
    pub template: Box<Account<'info, StreamTemplate>>,

    #[account(
        init,
        payer = payer,
        space = 500,
        // rate_interval_in_seconds > 0 is checked when creating stream template (create_stream_template)
    )]
    pub stream: Box<Account<'info, Stream>>,
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

/// Create stream PDA with template
#[derive(Accounts, Clone)]
#[instruction(
    idl_file_version: u8,
    _name: String,
    _allocation_assigned_units: u64,
    stream_pda_seed: Pubkey
)]
pub struct CreateStreamPdaWithTemplateAccounts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(constraint = treasurer.key() == treasury.treasurer_address @ ErrorCode::NotAuthorized)]
    pub treasurer: Signer<'info>,
    #[account(
        mut,
        seeds = [treasurer.key().as_ref(), &treasury.slot.to_le_bytes()],
        bump = treasury.bump,
        constraint = treasury.version == 2 @ ErrorCode::InvalidTreasuryVersion,
        constraint = treasury.initialized == true @ ErrorCode::TreasuryNotInitialized,
        constraint = treasury.to_account_info().data_len() == 300 @ ErrorCode::InvalidTreasurySize,
        constraint = idl_file_version == IDL_FILE_VERSION @ErrorCode::InvalidIdlFileVersion
    )]
    pub treasury: Box<Account<'info, Treasury>>,
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
        seeds = [b"template", treasury.key().as_ref()],
        bump = template.bump,
        constraint = template.version == 2 @ ErrorCode::InvalidTemplateVersion,
        constraint = template.to_account_info().data_len() == 200 @ ErrorCode::InvalidTemplateSize
    )]
    pub template: Box<Account<'info, StreamTemplate>>,

    #[account(
        init,
        seeds = [
            b"stream",
            treasury.key().as_ref(),
            stream_pda_seed.key().as_ref()
        ],
        bump,
        payer = payer,
        space = 500,
        // rate_interval_in_seconds > 0 is checked when creating stream template (create_stream_template)
    )]
    pub stream: Box<Account<'info, Stream>>,
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
#[instruction(
    idl_file_version: u8,
    amount: u64,
)]
pub struct WithdrawAccounts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        constraint = amount > 0 @ ErrorCode::ZeroWithdrawalAmount,
        constraint = beneficiary.key() == stream.beneficiary_address @ ErrorCode::InvalidBeneficiary,
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
        constraint = idl_file_version == IDL_FILE_VERSION @ErrorCode::InvalidIdlFileVersion,
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
#[instruction(idl_file_version: u8)]
pub struct PauseOrResumeStreamAccounts<'info> {
    #[account(
        constraint = (
            initializer.key() == stream.treasurer_address
        ) @ ErrorCode::NotAuthorized
    )]
    pub initializer: Signer<'info>,
    #[account(
        mut,
        seeds = [stream.treasurer_address.as_ref(), &treasury.slot.to_le_bytes()],
        bump = treasury.bump,
        constraint = treasury.version == 2 @ ErrorCode::InvalidTreasuryVersion,
        constraint = treasury.initialized == true @ ErrorCode::TreasuryNotInitialized,
        constraint = treasury.to_account_info().data_len() == 300 @ ErrorCode::InvalidTreasurySize,
        constraint = idl_file_version == IDL_FILE_VERSION @ErrorCode::InvalidIdlFileVersion,
    )]
    pub treasury: Account<'info, Treasury>,
    #[account(
        mut,
        constraint = stream.treasury_address == treasury.key() @ ErrorCode::InvalidTreasury,
        constraint = stream.version == 2 @ ErrorCode::InvalidStreamVersion,
        constraint = stream.initialized == true @ ErrorCode::StreamNotInitialized,
        constraint = stream.to_account_info().data_len() == 500 @ ErrorCode::InvalidStreamSize,
        constraint = treasury.treasury_type != TREASURY_TYPE_LOCKED @ ErrorCode::PauseOrResumeLockedStreamNotAllowed,
        constraint = stream.beneficiary_associated_token == treasury.associated_token_address @ ErrorCode::InvalidAssociatedToken,
    )]
    pub stream: Account<'info, Stream>,
}

/// Refresh Treasury Data
#[derive(Accounts)]
#[instruction(idl_file_version: u8)]
pub struct RefreshTreasuryDataAccounts<'info> {
    #[account(constraint = associated_token.key() == treasury.associated_token_address @ ErrorCode::InvalidAssociatedToken)]
    pub associated_token: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [treasury.treasurer_address.as_ref(), &treasury.slot.to_le_bytes()],
        bump = treasury.bump,
        constraint = treasury.version == 2 @ ErrorCode::InvalidTreasuryVersion,
        constraint = treasury.initialized == true @ ErrorCode::TreasuryNotInitialized,
        constraint = treasury.to_account_info().data_len() == 300 @ ErrorCode::InvalidTreasurySize,
        constraint = idl_file_version == IDL_FILE_VERSION @ErrorCode::InvalidIdlFileVersion,
    )]
    pub treasury: Account<'info, Treasury>,
    #[account(
        mut,
        associated_token::mint = associated_token,
        associated_token::authority = treasury
    )]
    pub treasury_token: Account<'info, TokenAccount>,
}

/// Transfer Stream
#[derive(Accounts)]
#[instruction(
    idl_file_version: u8,
    new_beneficiary: Pubkey,
)]
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
        constraint = stream.to_account_info().data_len() == 500 @ ErrorCode::InvalidStreamSize,
        constraint = idl_file_version == IDL_FILE_VERSION @ErrorCode::InvalidIdlFileVersion,
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
    pub stream: Account<'info, Stream>,
}

#[derive(Accounts)]
#[instruction(
    idl_file_version: u8,
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
        mut,
        constraint = treasury.version == 2 @ ErrorCode::InvalidTreasuryVersion,
        constraint = treasury.initialized == true @ ErrorCode::TreasuryNotInitialized,
        constraint = treasury.to_account_info().data_len() == 300 @ ErrorCode::InvalidTreasurySize,
        constraint = (
            treasury.associated_token_address == Pubkey::default() ||
            treasury.associated_token_address == associated_token.key()
        ) @ ErrorCode::InvalidAssociatedToken,
        constraint = idl_file_version == IDL_FILE_VERSION @ErrorCode::InvalidIdlFileVersion,
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
    idl_file_version: u8,
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
        constraint = idl_file_version == IDL_FILE_VERSION @ErrorCode::InvalidIdlFileVersion,
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
        constraint = stream.treasurer_address == treasurer.key() @ ErrorCode::InvalidTreasurer,
        constraint = stream.beneficiary_associated_token == associated_token.key() @ ErrorCode::InvalidAssociatedToken,
        constraint = amount > 0 @ ErrorCode::ZeroContributionAmount,
        constraint = stream.rate_amount_units > 0 && stream.rate_interval_in_seconds > 0 @ ErrorCode::InvalidStreamRate,
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
#[instruction(idl_file_version: u8)]
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
        constraint = treasury.to_account_info().data_len() == 300 @ ErrorCode::InvalidTreasurySize,
        constraint = idl_file_version == IDL_FILE_VERSION @ErrorCode::InvalidIdlFileVersion,
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
            treasury.treasury_type != TREASURY_TYPE_LOCKED 
            || stream.get_status(Clock::get()?.unix_timestamp as u64)? == StreamStatus::Paused
            || stream.get_status(Clock::get()?.unix_timestamp as u64)? == StreamStatus::Scheduled
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
#[instruction(idl_file_version: u8)]
pub struct CloseTreasuryAccounts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        constraint = treasurer.key() == treasury.treasurer_address @ ErrorCode::InvalidTreasurer
    )]
    pub treasurer: Signer<'info>,
    #[account(mut)]
    //#[soteria(ignore)]
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
        constraint = idl_file_version == IDL_FILE_VERSION @ErrorCode::InvalidIdlFileVersion,
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
#[instruction(
    idl_file_version: u8,
    amount: u64,
)]
pub struct TreasuryWithdrawAccounts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = treasury.treasurer_address @ ErrorCode::InvalidTreasurer
    )]
    pub treasurer: Signer<'info>,
    #[account()]
    //#[soteria(ignore)]
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
        constraint = idl_file_version == IDL_FILE_VERSION @ErrorCode::InvalidIdlFileVersion,
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
