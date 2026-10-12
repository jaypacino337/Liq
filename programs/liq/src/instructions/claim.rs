use anchor_lang::prelude::*;

use crate::{constants::POOL_SEED, errors::LiqError, events::CreatorClaimEvent, state::Pool};

#[derive(Accounts)]
pub struct ClaimCreatorFees<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut, seeds = [POOL_SEED, pool.mint.as_ref()], bump = pool.bump, has_one = creator)]
    pub pool: Account<'info, Pool>,
}

/// Creator fees accrue on the pool account rather than being pushed each
/// trade, so an empty creator wallet can never block trading.
pub fn claim_creator_fees(ctx: Context<ClaimCreatorFees>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let amount = pool.creator_fees_unclaimed;
    require!(amount > 0, LiqError::NothingToClaim);
    pool.creator_fees_unclaimed = 0;
    pool.sub_lamports(amount)?;
    ctx.accounts.creator.add_lamports(amount)?;
    emit!(CreatorClaimEvent { mint: pool.mint, creator: pool.creator, amount });
    Ok(())
}
