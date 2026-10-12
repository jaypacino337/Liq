use anchor_lang::{prelude::*, system_program};
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::{self, Burn, Token2022, TransferChecked},
    token_interface::{Mint, TokenAccount},
};

use crate::{
    constants::*,
    errors::LiqError,
    events::{OverflowEvent, TradeEvent},
    state::{Config, Pool, TradeOutcome},
};

/// Shared by `buy` and `sell` so clients build both from one account list.
#[derive(Accounts)]
pub struct Trade<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    /// CHECK: receives protocol fees; pinned to the config's recipient.
    #[account(mut, address = config.fee_recipient)]
    pub fee_recipient: UncheckedAccount<'info>,

    #[account(mut, seeds = [POOL_SEED, mint.key().as_ref()], bump = pool.bump, has_one = mint)]
    pub pool: Box<Account<'info, Pool>>,

    #[account(mut, mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = pool,
        associated_token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = trader,
        associated_token::mint = mint,
        associated_token::authority = trader,
        associated_token::token_program = token_program,
    )]
    pub trader_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> Trade<'info> {
    fn pay_from_trader(&self, to: AccountInfo<'info>, lamports: u64) -> Result<()> {
        if lamports == 0 {
            return Ok(());
        }
        system_program::transfer(
            CpiContext::new(
                system_program::ID,
                system_program::Transfer { from: self.trader.to_account_info(), to },
            ),
            lamports,
        )
    }

    fn emit_trade(&self, o: &TradeOutcome, is_buy: bool, now: i64) {
        let (price_sol_reserves, price_token_reserves) = self.pool.price_reserves();
        emit!(TradeEvent {
            mint: self.mint.key(),
            trader: self.trader.key(),
            is_buy,
            sol_amount: o.sol,
            token_amount: o.tokens,
            protocol_fee: o.protocol_fee,
            creator_fee: o.creator_fee,
            price_sol_reserves,
            price_token_reserves,
            phase: self.pool.phase as u8,
            timestamp: now,
        });
    }
}

/// Spend up to `max_sol_cost` lamports (fees included) for at least `min_tokens_out`.
pub fn buy(mut ctx: Context<Trade>, max_sol_cost: u64, min_tokens_out: u64) -> Result<()> {
    let accounts = &mut ctx.accounts;
    require!(!accounts.config.paused, LiqError::Paused);
    let now = Clock::get()?.unix_timestamp;

    let o = accounts.pool.quote_buy(max_sol_cost)?;
    require!(o.tokens >= min_tokens_out, LiqError::SlippageExceeded);
    if accounts.pool.in_calm_waters(now) {
        require!(o.sol <= accounts.pool.params.calm_max_buy_lamports, LiqError::CalmWatersCap);
    }

    // Reserves and the creator's accrued share both live on the pool account.
    let pool_info = accounts.pool.to_account_info();
    accounts.pay_from_trader(pool_info, o.sol + o.creator_fee)?;
    accounts.pay_from_trader(accounts.fee_recipient.to_account_info(), o.protocol_fee)?;

    let mint_key = accounts.mint.key();
    let signer: &[&[&[u8]]] = &[&[POOL_SEED, mint_key.as_ref(), &[accounts.pool.bump]]];
    token_2022::transfer_checked(
        CpiContext::new_with_signer(
            token_2022::ID,
            TransferChecked {
                from: accounts.vault.to_account_info(),
                mint: accounts.mint.to_account_info(),
                to: accounts.trader_token_account.to_account_info(),
                authority: accounts.pool.to_account_info(),
            },
            signer,
        ),
        o.tokens,
        accounts.mint.decimals,
    )?;

    accounts.pool.apply_buy(&o)?;
    accounts.emit_trade(&o, true, now);

    if o.overflows {
        overflow(accounts, signer, now)?;
    }
    Ok(())
}

/// The curve has sold out: burn the unneeded reserve, take the graduation fee,
/// and reopen as a constant-product pool at the exact closing price. No LP
/// tokens are minted, so nobody can ever withdraw this liquidity.
fn overflow(accounts: &mut Trade, signer: &[&[&[u8]]], now: i64) -> Result<()> {
    let (fee, pool_tokens, burn) = accounts.pool.plan_overflow()?;

    if burn > 0 {
        token_2022::burn(
            CpiContext::new_with_signer(
                token_2022::ID,
                Burn {
                    mint: accounts.mint.to_account_info(),
                    from: accounts.vault.to_account_info(),
                    authority: accounts.pool.to_account_info(),
                },
                signer,
            ),
            burn,
        )?;
    }
    if fee > 0 {
        accounts.pool.sub_lamports(fee)?;
        accounts.fee_recipient.add_lamports(fee)?;
    }

    accounts.pool.apply_overflow(fee, pool_tokens, now);
    emit!(OverflowEvent {
        mint: accounts.mint.key(),
        sol_seeded: accounts.pool.real_sol,
        tokens_seeded: pool_tokens,
        tokens_burned: burn,
        graduation_fee: fee,
        timestamp: now,
    });
    Ok(())
}

/// Sell exactly `tokens_in` for at least `min_sol_out` lamports after fees.
/// Selling is never paused: holders can always exit.
pub fn sell(mut ctx: Context<Trade>, tokens_in: u64, min_sol_out: u64) -> Result<()> {
    let accounts = &mut ctx.accounts;
    let now = Clock::get()?.unix_timestamp;

    let o = accounts.pool.quote_sell(tokens_in)?;
    let payout = o.sol - o.protocol_fee - o.creator_fee;
    require!(payout >= min_sol_out, LiqError::SlippageExceeded);

    token_2022::transfer_checked(
        CpiContext::new(
            token_2022::ID,
            TransferChecked {
                from: accounts.trader_token_account.to_account_info(),
                mint: accounts.mint.to_account_info(),
                to: accounts.vault.to_account_info(),
                authority: accounts.trader.to_account_info(),
            },
        ),
        tokens_in,
        accounts.mint.decimals,
    )?;

    // The creator's cut stays on the pool account as an unclaimed balance.
    accounts.pool.sub_lamports(o.sol - o.creator_fee)?;
    accounts.trader.add_lamports(payout)?;
    if o.protocol_fee > 0 {
        accounts.fee_recipient.add_lamports(o.protocol_fee)?;
    }

    accounts.pool.apply_sell(&o)?;
    accounts.emit_trade(&o, false, now);
    Ok(())
}
