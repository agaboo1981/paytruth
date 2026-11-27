use anchor_lang::prelude::*;

#[error_code]
pub enum PaytruthError {
    #[msg("Payment amount is less than the invoice amount due")]
    Underpayment,
    #[msg("Invoice has already been paid")]
    DuplicatePayment,
    #[msg("Invoice is not open")]
    InvoiceNotOpen,
    #[msg("Invoice has expired")]
    InvoiceExpired,
    #[msg("Invoice is not paid")]
    InvoiceNotPaid,
    #[msg("Invoice has already been claimed")]
    AlreadyClaimed,
    #[msg("Overpayment has already been refunded")]
    AlreadyRefunded,
    #[msg("Invoice has no excess to refund")]
    NothingToRefund,
    #[msg("Invoice has not expired yet")]
    NotExpired,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid expiry")]
    InvalidExpiry,
    #[msg("Invalid mint")]
    InvalidMint,
    #[msg("Invalid escrow account")]
    InvalidEscrow,
    #[msg("Signer is not the invoice merchant")]
    UnauthorizedMerchant,
    #[msg("Invalid payer associated token account")]
    InvalidPayerAta,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Vault is not empty")]
    VaultNotEmpty,
    #[msg("Invoice is not in a terminal state")]
    InvoiceNotTerminal,
    #[msg("Recorded excess has not been refunded")]
    ExcessOutstanding,
    #[msg("Nothing to recover")]
    NothingToRecover,
    #[msg("Payer is not recorded on the invoice")]
    PayerNotRecorded,
    #[msg("Mint does not match config usdc mint")]
    ConfigMintMismatch,
}
