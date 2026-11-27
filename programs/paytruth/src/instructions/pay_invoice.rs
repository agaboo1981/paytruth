use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::{
    constants::*,
    error::PaytruthError,
    events::InvoicePaid,
    state::{Config, Invoice, InvoiceStatus},
};

#[derive(Accounts)]
pub struct PayInvoice<'info> {
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [INVOICE_SEED, invoice.merchant.as_ref(), invoice.invoice_id.to_le_bytes().as_ref()],
        bump = invoice.bump,
    )]
    pub invoice: Account<'info, Invoice>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub payer_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub escrow: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_pay_invoice(
    ctx: Context<PayInvoice>,
    amount: u64,
    expected_amount_due: u64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let invoice = &ctx.accounts.invoice;

    require!(
        InvoiceStatus::from_u8(invoice.status) == Some(InvoiceStatus::Open),
        PaytruthError::DuplicatePayment
    );
    // QA M2: a signed pay tx is bound to the invoice terms the payer saw. A stale or
    // substituted invoice (different amount_due) is rejected before any transfer.
    require!(
        expected_amount_due == invoice.amount_due,
        PaytruthError::InvoiceMismatch
    );
    require!(now < invoice.expires_at, PaytruthError::InvoiceExpired);
    require!(amount > 0, PaytruthError::InvalidAmount);
    require!(amount >= invoice.amount_due, PaytruthError::Underpayment);
    require_keys_eq!(
        ctx.accounts.mint.key(),
        invoice.mint,
        PaytruthError::InvalidMint
    );
    require_keys_eq!(
        invoice.mint,
        ctx.accounts.config.usdc_mint,
        PaytruthError::ConfigMintMismatch
    );

    let expected_escrow =
        anchor_spl::associated_token::get_associated_token_address(&invoice.key(), &invoice.mint);
    require_keys_eq!(
        ctx.accounts.escrow.key(),
        expected_escrow,
        PaytruthError::InvalidEscrow
    );
    require_keys_eq!(
        ctx.accounts.escrow.owner,
        invoice.key(),
        PaytruthError::InvalidEscrow
    );
    require_keys_eq!(
        ctx.accounts.escrow.mint,
        invoice.mint,
        PaytruthError::InvalidEscrow
    );

    require_keys_eq!(
        ctx.accounts.payer_ata.owner,
        ctx.accounts.payer.key(),
        PaytruthError::InvalidPayerAta
    );
    require_keys_eq!(
        ctx.accounts.payer_ata.mint,
        invoice.mint,
        PaytruthError::InvalidPayerAta
    );

    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.key(),
        TransferChecked {
            from: ctx.accounts.payer_ata.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.escrow.to_account_info(),
            authority: ctx.accounts.payer.to_account_info(),
        },
    );
    token::transfer_checked(cpi_ctx, amount, USDC_DECIMALS)?;

    let excess = amount
        .checked_sub(invoice.amount_due)
        .ok_or(PaytruthError::Overflow)?;

    let invoice = &mut ctx.accounts.invoice;
    invoice.payer = ctx.accounts.payer.key();
    invoice.paid_amount = amount;
    invoice.status = InvoiceStatus::Paid as u8;

    emit!(InvoicePaid {
        invoice: invoice.key(),
        payer: invoice.payer,
        amount,
        excess,
        timestamp: now,
    });

    Ok(())
}
