use anchor_lang::prelude::*;

#[repr(u8)]
#[derive(Copy, Clone, AnchorSerialize, AnchorDeserialize)]
pub enum Category {
    Default = 0,
    Vesting = 1
}
