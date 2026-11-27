use anchor_lang::prelude::*;

#[event]
pub struct InvoiceCreated {
    pub invoice: Pubkey,
    pub merchant: Pubkey,
    pub invoice_id: u64,
    pub amount_due: u64,
    pub expires_at: i64,
    pub timestamp: i64,
}

#[event]
pub struct InvoicePaid {
    pub invoice: Pubkey,
    pub payer: Pubkey,
    pub amount: u64,
    pub excess: u64,
    pub timestamp: i64,
}

#[event]
pub struct InvoiceClaimed {
    pub invoice: Pubkey,
    pub merchant: Pubkey,
    pub amount_due: u64,
    pub timestamp: i64,
}

#[event]
pub struct OverpaymentRefunded {
    pub invoice: Pubkey,
    pub payer: Pubkey,
    pub excess: u64,
    pub timestamp: i64,
}

#[event]
pub struct InvoiceExpired {
    pub invoice: Pubkey,
    pub merchant: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct UnattributedRecovered {
    pub invoice: Pubkey,
    pub merchant: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct InvoiceClosed {
    pub invoice: Pubkey,
    pub merchant: Pubkey,
    pub timestamp: i64,
}
