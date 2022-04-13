// Fee constants
pub const CREATE_TREASURY_FLAT_FEE: u64 = 10_000;
pub const CREATE_STREAM_FLAT_FEE: u64 = 10_000;
pub const ADD_FUNDS_FLAT_FEE: u64 = 25_000;
pub const WITHDRAW_PERCENT_FEE: u64 = 2_500;
// pub const PROPOSE_UPDATE_FLAT_FEE: u64 = 10_000; // Not in use at the moment
pub const CLOSE_STREAM_FLAT_FEE: u64 = 10_000;
pub const CLOSE_STREAM_PERCENT_FEE: u64 = 2_500;
// pub const CLOSE_TREASURY_FLAT_FEE: u64 = 10_000; // Not in use at the moment
// pub const CLOSE_TREASURY_PERCENT_FEE: u64 = 2_500; // Not in use at the moment
pub const TRANSFER_STREAM_FLAT_FEE: u64 = 10_000;
pub const TREASURY_WITHDRAW_PERCENT_FEE: u64 = 2_500;

pub const PERCENT_DENOMINATOR: u64 = 1_000_000;

// General
pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
pub const TREASURY_POOL_MINT_DECIMALS: u8 = 6;

// Stream Allocation Types
// pub const ALLOCATION_TYPE_ASSIGN_TO_ALL_STREAMS: u8 = 0; // NOT IMPLEMENTED YET
pub const ALLOCATION_TYPE_ASSIGN_TO_SPECIFIC_STREAM: u8 = 1;
pub const ALLOCATION_TYPE_LEAVE_UNALLOCATED: u8 = 2;
pub const TREASURY_TYPE_OPEN: u8 = 0;
pub const TREASURY_TYPE_LOCKED: u8 = 1;
