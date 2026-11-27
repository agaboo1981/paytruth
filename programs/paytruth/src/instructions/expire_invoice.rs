use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::PaytruthError,
    events::InvoiceExpired,
    state::{Invoice, InvoiceStatus},
};

#[derive(Accounts)]
pub struct ExpireInvoice<'info> {
    pub caller: Signer<'info>,
    #[account(
        mut,
        seeds = [INVOICE_SEED, invoice.merchant.as_ref(), invoice.invoice_id.to_le_bytes().as_ref()],
        bump = invoice.bump,
    )]
    pub invoice: Account<'info, Invoice>,
}

pub fn handle_expire_invoice(ctx: Context<ExpireInvoice>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let invoice = &ctx.accounts.invoice;

    require!(
        InvoiceStatus::from_u8(invoice.status) == Some(InvoiceStatus::Open),
        PaytruthError::InvoiceNotOpen
    );
    require!(now >= invoice.expires_at, PaytruthError::NotExpired);

    let invoice = &mut ctx.accounts.invoice;
    invoice.status = InvoiceStatus::Expired as u8;

    emit!(InvoiceExpired {
        invoice: invoice.key(),
        merchant: invoice.merchant,
        timestamp: now,
    });

    Ok(())
}
