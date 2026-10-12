//! Liq — a Solana launchpad where every token starts as a bonding curve and,
//! when the curve sells out, overflows into a permanent constant-product pool
//! with no LP tokens. Liquidity that can't be pulled.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;
use state::LaunchParams;

declare_id!("2ZNPpmsqjdZtNU3hDMNPjYFFWMF6VuU7XtHsaM7feaGP");

#[program]
pub mod liq {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, fee_recipient: Pubkey, params: LaunchParams) -> Result<()> {
        instructions::admin::initialize(ctx, fee_recipient, params)
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        new_authority: Option<Pubkey>,
        fee_recipient: Option<Pubkey>,
        params: Option<LaunchParams>,
        paused: Option<bool>,
    ) -> Result<()> {
        instructions::admin::update_config(ctx, new_authority, fee_recipient, params, paused)
    }

    pub fn create_launch(ctx: Context<CreateLaunch>, name: String, symbol: String, uri: String) -> Result<()> {
        instructions::create::create_launch(ctx, name, symbol, uri)
    }

    pub fn buy(ctx: Context<Trade>, max_sol_cost: u64, min_tokens_out: u64) -> Result<()> {
        instructions::trade::buy(ctx, max_sol_cost, min_tokens_out)
    }

    pub fn sell(ctx: Context<Trade>, tokens_in: u64, min_sol_out: u64) -> Result<()> {
        instructions::trade::sell(ctx, tokens_in, min_sol_out)
    }

    pub fn claim_creator_fees(ctx: Context<ClaimCreatorFees>) -> Result<()> {
        instructions::claim::claim_creator_fees(ctx)
    }
}
