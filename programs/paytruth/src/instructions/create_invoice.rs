use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::{
    constants::*,
    error::PaytruthError,
    events::InvoiceCreated,
    state::{Config, Invoice, InvoiceStatus},
};
#[derive(Accounts)]
#[instruction(invoice_id: u64)]
pub struct CreateInvoice<'info> {
    #[account(mut)]
    pub merchant: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = merchant,
        space = 8 + Invoice::INIT_SPACE,
        seeds = [INVOICE_SEED, merchant.key().as_ref(), invoice_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub invoice: Account<'info, Invoice>,
    #[account(constraint = mint.key() == config.usdc_mint @ PaytruthError::ConfigMintMismatch)]
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = merchant,
        associated_token::mint = mint,
        associated_token::authority = invoice,
        associated_token::token_program = token_program,
    )]
    pub escrow: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_invoice(
    ctx: Context<CreateInvoice>,
    invoice_id: u64,
    amount_due: u64,
    expires_at: i64,
    memo: [u8; MEMO_LEN],
) -> Result<()> {
    require!(amount_due > 0, PaytruthError::InvalidAmount);

    let now = Clock::get()?.unix_timestamp;
    require!(expires_at > now, PaytruthError::InvalidExpiry);

    let invoice = &mut ctx.accounts.invoice;
    invoice.merchant = ctx.accounts.merchant.key();
    invoice.payer = Pubkey::default();
    invoice.mint = ctx.accounts.config.usdc_mint;
    invoice.invoice_id = invoice_id;
    invoice.amount_due = amount_due;
    invoice.paid_amount = 0;
    invoice.refunded_excess = 0;
    invoice.created_at = now;
    invoice.expires_at = expires_at;
    invoice.status = InvoiceStatus::Open as u8;
    invoice.claimed = false;
    invoice.bump = ctx.bumps.invoice;
    invoice.memo = memo;

    emit!(InvoiceCreated {
        invoice: invoice.key(),
        merchant: invoice.merchant,
        invoice_id,
        amount_due,
        expires_at,
        timestamp: now,
    });

    Ok(())
}
