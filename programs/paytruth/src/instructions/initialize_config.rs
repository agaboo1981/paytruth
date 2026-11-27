use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_spl::token;

use crate::{
    constants::*,
    error::PaytruthError,
    state::{Config, CONFIG_BODY_SIZE},
};

#[derive(Accounts)]
#[instruction(usdc_mint: Pubkey)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + CONFIG_BODY_SIZE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,
    /// CHECK: verified manually against the `usdc_mint` argument, the classic token program
    /// owner, an `spl_token::state::Mint` layout, and `decimals == USDC_DECIMALS`.
    pub usdc_mint: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_config(ctx: Context<InitializeConfig>, usdc_mint: Pubkey) -> Result<()> {
    let mint_info = &ctx.accounts.usdc_mint;

    require_keys_eq!(mint_info.key(), usdc_mint, PaytruthError::InvalidMint);
    require_keys_eq!(*mint_info.owner, token::ID, PaytruthError::InvalidMint);

    let data = mint_info.try_borrow_data()?;
    let mint = anchor_spl::token::spl_token::state::Mint::unpack(&data)
        .map_err(|_| PaytruthError::InvalidMint)?;
    require!(mint.decimals == USDC_DECIMALS, PaytruthError::InvalidMint);

    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.usdc_mint = usdc_mint;
    config.bump = ctx.bumps.config;

    Ok(())
}
