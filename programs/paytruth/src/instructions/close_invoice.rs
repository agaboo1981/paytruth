use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount};

use crate::{
    constants::*,
    error::PaytruthError,
    events::InvoiceClosed,
    state::{Invoice, InvoiceStatus},
};

#[derive(Accounts)]
pub struct CloseInvoice<'info> {
    #[account(mut)]
    pub merchant: Signer<'info>,
    #[account(
        mut,
        seeds = [INVOICE_SEED, invoice.merchant.as_ref(), invoice.invoice_id.to_le_bytes().as_ref()],
        bump = invoice.bump,
        has_one = merchant @ PaytruthError::UnauthorizedMerchant,
        close = merchant,
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
    pub token_program: Program<'info, Token>,
}

pub fn handle_close_invoice(ctx: Context<CloseInvoice>) -> Result<()> {
    let invoice = &ctx.accounts.invoice;

    match InvoiceStatus::from_u8(invoice.status) {
        Some(InvoiceStatus::Expired) => {}
        Some(InvoiceStatus::Paid) if invoice.claimed => {
            let excess = invoice
                .paid_amount
                .checked_sub(invoice.amount_due)
                .ok_or(PaytruthError::Overflow)?;
            if excess != 0 && invoice.refunded_excess != excess {
                return err!(PaytruthError::ExcessOutstanding);
            }
        }
        _ => return err!(PaytruthError::InvoiceNotTerminal),
    }

    require!(
        ctx.accounts.escrow.amount == 0,
        PaytruthError::VaultNotEmpty
    );

    let signer_seeds: &[&[&[u8]]] = &[&[
        INVOICE_SEED,
        invoice.merchant.as_ref(),
        &invoice.invoice_id.to_le_bytes(),
        &[invoice.bump],
    ]];

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        CloseAccount {
            account: ctx.accounts.escrow.to_account_info(),
            destination: ctx.accounts.merchant.to_account_info(),
            authority: ctx.accounts.invoice.to_account_info(),
        },
        signer_seeds,
    );
    token::close_account(cpi_ctx)?;

    emit!(InvoiceClosed {
        invoice: invoice.key(),
        merchant: invoice.merchant,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
