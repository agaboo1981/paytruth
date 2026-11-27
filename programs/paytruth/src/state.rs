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

// Body field sizes. Config = 65 payload bytes (spec matches).
//
// SPEC-NOTE: docs/PROGRAM-SPEC.md and docs/ARCHITECTURE.md state Invoice InitSpace = 203
// with the formula `96 + 40 + 3 + 64 = 203` (account 8 + 203 = 211). That formula is an
// arithmetic error: the field table lists SIX 8-byte numerals (invoice_id, amount_due,
// paid_amount, refunded_excess, created_at, expires_at) = 48 bytes, not 40. The true
// geometry for the documented field set is 96 (three Pubkeys) + 48 (six i/u64) + 3
// (status, claimed, bump) + 64 (memo) = 211 body, i.e. account 8 + 211 = 219. We keep the
// full documented field set (dropping `created_at` would change the on-chain schema) and
// use the correct geometric sizes here. See the final report for this deviation.
pub const CONFIG_BODY_SIZE: usize = 65;
pub const INVOICE_BODY_SIZE: usize = 211;

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
    fn invoice_account_size_is_219() {
        // SPEC-NOTE: spec text says 203/211; the documented six 8-byte numerals make the
        // true body 211 (account 219). See the note above CONFIG_BODY_SIZE.
        assert_eq!(Invoice::INIT_SPACE, 211);
        assert_eq!(DISCRIMINATOR + Invoice::INIT_SPACE, 219);
        assert_eq!(INVOICE_BODY_SIZE + DISCRIMINATOR, 219);
    }

    #[test]
    fn invoice_field_geometry() {
        assert_eq!(
            core::mem::size_of::<Pubkey>() * 3
                + 8 * 6
                + 1 * 3
                + MEMO_LEN,
            Invoice::INIT_SPACE
        );
    }

    #[test]
    fn status_roundtrip() {
        assert_eq!(InvoiceStatus::from_u8(0), Some(InvoiceStatus::Open));
        assert_eq!(InvoiceStatus::from_u8(1), Some(InvoiceStatus::Paid));
        assert_eq!(InvoiceStatus::from_u8(2), Some(InvoiceStatus::Expired));
        assert_eq!(InvoiceStatus::from_u8(3), None);
    }
}
