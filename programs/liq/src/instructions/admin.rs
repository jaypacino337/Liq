use anchor_lang::prelude::*;

use crate::{
    constants::CONFIG_SEED,
    program::Liq,
    state::{Config, LaunchParams},
};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,

    /// Only the program's upgrade authority may create the singleton config,
    /// so nobody can front-run initialization after deploy.
    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, Liq>,
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()))]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}

pub fn initialize(ctx: Context<Initialize>, fee_recipient: Pubkey, params: LaunchParams) -> Result<()> {
    params.validate()?;
    ctx.accounts.config.set_inner(Config {
        authority: ctx.accounts.authority.key(),
        fee_recipient,
        params,
        paused: false,
        launch_count: 0,
        bump: ctx.bumps.config,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,
}

/// Every field is optional so the admin can change one knob at a time.
/// Changes only affect pools launched afterwards.
pub fn update_config(
    ctx: Context<UpdateConfig>,
    new_authority: Option<Pubkey>,
    fee_recipient: Option<Pubkey>,
    params: Option<LaunchParams>,
    paused: Option<bool>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    if let Some(params) = params {
        params.validate()?;
        config.params = params;
    }
    if let Some(fee_recipient) = fee_recipient {
        config.fee_recipient = fee_recipient;
    }
    if let Some(paused) = paused {
        config.paused = paused;
    }
    if let Some(new_authority) = new_authority {
        config.authority = new_authority;
    }
    Ok(())
}
