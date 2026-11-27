use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, TransferChecked},
};

use crate::{
    constants::*,
    error::PaytruthError,
    events::InvoiceClaimed,
    state::{Invoice, InvoiceStatus},
};

#[derive(Accounts)]
pub struct MerchantClaim<'info> {
    #[account(mut)]
    pub merchant: Signer<'info>,
    #[account(
        mut,
        seeds = [INVOICE_SEED, invoice.merchant.as_ref(), invoice.invoice_id.to_le_bytes().as_ref()],
        bump = invoice.bump,
        has_one = merchant @ PaytruthError::UnauthorizedMerchant,
    )]
    pub invoice: Account<'info, Invoice>,
    #[account(constraint = mint.key() == invoice.mint @ PaytruthError::InvalidMint)]
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        constraint = escrow.key() == anchor_spl::associated_token::get_associated_token_address(
            &invoice.key(),
            &mint.key(),
        ) @ PaytruthError::InvalidEscrow,
        constraint = escrow.owner == invoice.key() @ PaytruthError::InvalidEscrow,
    )]
    pub escrow: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = merchant,
        associated_token::mint = mint,
        associated_token::authority = merchant,
        associated_token::token_program = token_program,
    )]
    pub merchant_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_merchant_claim(ctx: Context<MerchantClaim>) -> Result<()> {
    let invoice = &ctx.accounts.invoice;

    require!(
        InvoiceStatus::from_u8(invoice.status) == Some(InvoiceStatus::Paid),
        PaytruthError::InvoiceNotPaid
    );
    require!(!invoice.claimed, PaytruthError::AlreadyClaimed);

    let signer_seeds: &[&[&[u8]]] = &[&[
        INVOICE_SEED,
        invoice.merchant.as_ref(),
        &invoice.invoice_id.to_le_bytes(),
        &[invoice.bump],
    ]];

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        TransferChecked {
            from: ctx.accounts.escrow.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.merchant_ata.to_account_info(),
            authority: ctx.accounts.invoice.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer_checked(cpi_ctx, invoice.amount_due, USDC_DECIMALS)?;

    let invoice = &mut ctx.accounts.invoice;
    invoice.claimed = true;

    emit!(InvoiceClaimed {
        invoice: invoice.key(),
        merchant: invoice.merchant,
        amount_due: invoice.amount_due,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
