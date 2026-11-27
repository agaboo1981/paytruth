pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H");

#[program]
pub mod paytruth {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, usdc_mint: Pubkey) -> Result<()> {
        crate::instructions::initialize_config::handle_initialize_config(ctx, usdc_mint)
    }

    pub fn create_invoice(
        ctx: Context<CreateInvoice>,
        invoice_id: u64,
        amount_due: u64,
        expires_at: i64,
        memo: [u8; MEMO_LEN],
    ) -> Result<()> {
        crate::instructions::create_invoice::handle_create_invoice(
            ctx, invoice_id, amount_due, expires_at, memo,
        )
    }

    pub fn pay_invoice(
        ctx: Context<PayInvoice>,
        amount: u64,
        expected_amount_due: u64,
    ) -> Result<()> {
        crate::instructions::pay_invoice::handle_pay_invoice(ctx, amount, expected_amount_due)
    }

    pub fn merchant_claim(ctx: Context<MerchantClaim>) -> Result<()> {
        crate::instructions::merchant_claim::handle_merchant_claim(ctx)
    }

    pub fn refund_overpayment(ctx: Context<RefundOverpayment>) -> Result<()> {
        crate::instructions::refund_overpayment::handle_refund_overpayment(ctx)
    }

    pub fn expire_invoice(ctx: Context<ExpireInvoice>) -> Result<()> {
        crate::instructions::expire_invoice::handle_expire_invoice(ctx)
    }

    pub fn recover_unattributed(ctx: Context<RecoverUnattributed>) -> Result<()> {
        crate::instructions::recover_unattributed::handle_recover_unattributed(ctx)
    }

    pub fn close_invoice(ctx: Context<CloseInvoice>) -> Result<()> {
        crate::instructions::close_invoice::handle_close_invoice(ctx)
    }
}
