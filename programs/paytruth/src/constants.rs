use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

#[constant]
pub const INVOICE_SEED: &[u8] = b"invoice";

pub const USDC_DECIMALS: u8 = 6;

pub const MEMO_LEN: usize = 64;
