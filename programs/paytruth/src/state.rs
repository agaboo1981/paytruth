use anchor_lang::prelude::*;

use crate::constants::MEMO_LEN;

/// Helper only; stored on-chain as `Invoice.status: u8` (spec). Not serialized itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum InvoiceStatus {
    Open = 0,
    Paid = 1,
    Expired = 2,
}

impl InvoiceStatus {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Open),
            1 => Some(Self::Paid),
            2 => Some(Self::Expired),
            _ => None,
        }
    }
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Invoice {
    pub merchant: Pubkey,
    pub payer: Pubkey,
    pub mint: Pubkey,
    pub invoice_id: u64,
    pub amount_due: u64,
    pub paid_amount: u64,
    pub refunded_excess: u64,
    pub created_at: i64,
    pub expires_at: i64,
    pub status: u8,
    pub claimed: bool,
    pub bump: u8,
    pub memo: [u8; MEMO_LEN],
}

// Body field sizes per docs/PROGRAM-SPEC.md: Config = 65, Invoice = 203 payload bytes.
pub const CONFIG_BODY_SIZE: usize = 65;
pub const INVOICE_BODY_SIZE: usize = 203;

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::Space;

    const DISCRIMINATOR: usize = 8;

    #[test]
    fn config_account_size_is_73() {
        assert_eq!(Config::INIT_SPACE, 65);
        assert_eq!(DISCRIMINATOR + Config::INIT_SPACE, 73);
        assert_eq!(CONFIG_BODY_SIZE + DISCRIMINATOR, 73);
    }

    #[test]
    fn invoice_account_size_is_211() {
        assert_eq!(Invoice::INIT_SPACE, 203);
        assert_eq!(DISCRIMINATOR + Invoice::INIT_SPACE, 211);
        assert_eq!(INVOICE_BODY_SIZE + DISCRIMINATOR, 211);
    }

    #[test]
    fn status_roundtrip() {
        assert_eq!(InvoiceStatus::from_u8(0), Some(InvoiceStatus::Open));
        assert_eq!(InvoiceStatus::from_u8(1), Some(InvoiceStatus::Paid));
        assert_eq!(InvoiceStatus::from_u8(2), Some(InvoiceStatus::Expired));
        assert_eq!(InvoiceStatus::from_u8(3), None);
    }
}
