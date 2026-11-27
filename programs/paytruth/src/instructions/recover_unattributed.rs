use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, TransferChecked},
};

use crate::{
    constants::*,
    error::PaytruthError,
    events::UnattributedRecovered,
    state::{Invoice, InvoiceStatus},
};

#[derive(Accounts)]
pub struct RecoverUnattributed<'info> {
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
            &invoice.mint,
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
    pub destination_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_recover_unattributed(ctx: Context<RecoverUnattributed>) -> Result<()> {
    let invoice = &ctx.accounts.invoice;

    match InvoiceStatus::from_u8(invoice.status) {
        // Closed is terminal with excess already cleared; allows recovering tokens sent to an
        // escrow ATA that a third party re-created after close.
        Some(InvoiceStatus::Expired) | Some(InvoiceStatus::Closed) => {}
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

    let amount = ctx.accounts.escrow.amount;
    require!(amount > 0, PaytruthError::NothingToRecover);

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
            to: ctx.accounts.destination_ata.to_account_info(),
            authority: ctx.accounts.invoice.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer_checked(cpi_ctx, amount, USDC_DECIMALS)?;

    emit!(UnattributedRecovered {
        invoice: invoice.key(),
        merchant: invoice.merchant,
        amount,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
