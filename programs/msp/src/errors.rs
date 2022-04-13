use anchor_lang::prelude::*;

#[error]
pub enum ErrorCode {
    #[msg("Invalid Money Streaming Program ID")]
    InvalidProgramId,
    #[msg("Invalid account owner")]
    InvalidOwner,
    #[msg("Not Authorized")]
    NotAuthorized,
    #[msg("Overflow")]
    Overflow,
    #[msg("Invalid associated token address")]
    InvalidAssociatedToken,
    #[msg("Invalid fee treasury account")]
    InvalidFeeTreasuryAccount,
    #[msg("Invalid treasury mint decimals")]
    InvalidTreasuryMintDecimals,
    #[msg("Treasury is already initialized")]
    TreasuryAlreadyInitialized,
    #[msg("Treasury is not initialized")]
    TreasuryNotInitialized,
    #[msg("Invalid treasury version")]
    InvalidTreasuryVersion,
    #[msg("Invalid treasury mint address")]
    InvalidTreasuryMint,
    #[msg("Invalid treasury account")]
    InvalidTreasury,
    #[msg("Invalid treasury size")]
    InvalidTreasurySize,
    #[msg("Invalid treasurer")]
    InvalidTreasurer, // 6013
    #[msg("Invalid beneficiary")]
    InvalidBeneficiary,
    // Stream
    #[msg("Invalid argument")]
    InvalidArgument,
    #[msg("Stream not initialized")]
    StreamNotInitialized,
    #[msg("Stream is already initialized")]
    StreamAlreadyInitialized,
    #[msg("Invalid stream version")]
    InvalidStreamVersion,
    #[msg("Invalid stream size")]
    InvalidStreamSize,
    #[msg("Invalid stream account")]
    InvalidStream,
    #[msg("Invalid requested stream allocation")]
    InvalidRequestedStreamAllocation,
    #[msg("Invalid withdrawal amount")]
    InvalidWithdrawalAmount, // 6022
    #[msg("The string length is larger than 32 bytes")]
    StringTooLong,
    #[msg("The stream is already running")]
    StreamAlreadyRunning,
    #[msg("The stream is already paused")]
    StreamAlreadyPaused,
    #[msg("Stream allocation assigned is zero")]
    StreamZeroRemainingAllocation,
    #[msg("Contribution amount is zero")]
    ZeroContributionAmount,
    #[msg("Withdrawal amount is zero")]
    ZeroWithdrawalAmount,
    #[msg("Stream has not started")]
    StreamIsScheduled,
    #[msg("Streams in a Locked treasury can not be closed while running")]
    CloseLockedStreamNotAllowedWhileRunning,
    #[msg("Streams in a Locked treasury can not be paused or resumed")]
    PauseOrResumeLockedStreamNotAllowed,
    #[msg("Can not pause a stream if the reserved allocation is greater than the withdrawable amount")]
    ReservedAllocationExceedWithdrawableAmount,
    #[msg("Can not allocate funds to a stream from a locked treasury")]
    AllocateNotAllowedOnLockedStreams,
    #[msg("Invalid stream rate")]
    InvalidStreamRate,
    #[msg("Invalid cliff")]
    InvalidCliff,
    #[msg("Insufficient lamports")]
    InsufficientLamports,
    #[msg("This treasury contains one or more streams")]
    TreasuryContainsStreams,
    #[msg("Insufficient funds")]
    InsufficientFunds,
    #[msg("Insufficient treasury balance")]
    InsufficientTreasuryBalance, // 6039
    #[msg("Stream is auto-paused. To resume use allocate")]
    CannotResumeAutoPausedStream,
    // UPDATE TREASURY ERROR
    #[msg("Treasury allocation can not be greater than treasury balance")]
    InvalidTreasuryRequestedAllocation,
}