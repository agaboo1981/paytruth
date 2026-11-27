use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, TransferChecked},
};

use crate::{
    constants::*,
    error::PaytruthError,
    events::OverpaymentRefunded,
    state::{Invoice, InvoiceStatus},
};

#[derive(Accounts)]
pub struct RefundOverpayment<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(
        mut,
        seeds = [INVOICE_SEED, invoice.merchant.as_ref(), invoice.invoice_id.to_le_bytes().as_ref()],
        bump = invoice.bump,
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
    /// CHECK: the recorded payer, used only as the authority of `payer_ata`; its `address`
    /// constraint ties it to `invoice.payer`.
    #[account(address = invoice.payer @ PaytruthError::InvalidPayerAta)]
    pub payer: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = mint,
        associated_token::authority = payer,
        associated_token::token_program = token_program,
    )]
    pub payer_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_refund_overpayment(ctx: Context<RefundOverpayment>) -> Result<()> {
    let invoice = &ctx.accounts.invoice;

    require!(
        InvoiceStatus::from_u8(invoice.status) == Some(InvoiceStatus::Paid),
        PaytruthError::InvoiceNotPaid
    );
    require_keys_neq!(
        invoice.payer,
        Pubkey::default(),
        PaytruthError::PayerNotRecorded
    );
    require!(
        invoice.paid_amount > invoice.amount_due,
        PaytruthError::NothingToRefund
    );
    require!(invoice.refunded_excess == 0, PaytruthError::AlreadyRefunded);

    let excess = invoice
        .paid_amount
        .checked_sub(invoice.amount_due)
        .ok_or(PaytruthError::Overflow)?;

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
            to: ctx.accounts.payer_ata.to_account_info(),
            authority: ctx.accounts.invoice.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer_checked(cpi_ctx, excess, USDC_DECIMALS)?;

    let invoice = &mut ctx.accounts.invoice;
    invoice.refunded_excess = excess;

    emit!(OverpaymentRefunded {
        invoice: invoice.key(),
        payer: invoice.payer,
        excess,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
