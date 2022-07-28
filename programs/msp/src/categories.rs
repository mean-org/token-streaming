use anchor_lang::prelude::*;

#[repr(u8)]
#[derive(Copy, Clone, AnchorSerialize, AnchorDeserialize)]
pub enum Category {
    Default = 0,
    Vesting = 1,
}

#[repr(u8)]
#[derive(Copy, Clone, AnchorSerialize, AnchorDeserialize)]
pub enum SubCategory {
    Default = 0,
    Advisor = 1,
    Development = 2,
    Foundation = 3,
    Investor = 4,
    Marketing = 5,
    Partnership = 6,
    Seed = 7,
    Team = 8,
    Community = 9,
}
