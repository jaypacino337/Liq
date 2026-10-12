use anchor_lang::prelude::*;

use crate::{errors::LiqError, math};

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub fee_recipient: Pubkey,
    pub params: LaunchParams,
    pub paused: bool,
    pub launch_count: u64,
    pub bump: u8,
}

/// Everything that shapes a new launch. Snapshotted into each pool at
/// creation, so later admin changes never alter a live market's rules.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct LaunchParams {
    pub protocol_fee_bps: u16,
    pub creator_fee_bps: u16,
    pub initial_virtual_sol: u64,
    pub initial_virtual_tokens: u64,
    /// Tokens sold along the bonding curve. The rest of `total_supply` is the
    /// reserve that seeds the permanent pool at overflow.
    pub curve_supply: u64,
    pub total_supply: u64,
    /// Seconds after launch during which "calm waters" caps each buy.
    pub calm_period_secs: i64,
    pub calm_max_buy_lamports: u64,
    pub graduation_fee_lamports: u64,
}

impl LaunchParams {
    pub fn validate(&self) -> Result<()> {
        require!(
            self.protocol_fee_bps as u32 + self.creator_fee_bps as u32
                <= crate::constants::MAX_TOTAL_FEE_BPS as u32,
            LiqError::FeeTooHigh
        );
        require!(
            self.initial_virtual_sol > 0
                && self.curve_supply > 0
                && self.curve_supply < self.initial_virtual_tokens
                && self.curve_supply < self.total_supply,
            LiqError::InvalidCurveParams
        );
        require!(
            (0..=crate::constants::MAX_CALM_PERIOD_SECS).contains(&self.calm_period_secs),
            LiqError::CalmPeriodTooLong
        );
        Ok(())
    }

    pub fn total_fee_bps(&self) -> u16 {
        self.protocol_fee_bps + self.creator_fee_bps
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum Phase {
    /// Priced on virtual reserves along the bonding curve.
    Curve,
    /// Curve sold out; priced on real reserves. No LP tokens exist, so this
    /// liquidity is permanent.
    Pool,
}

/// One per launched token, PDA `["pool", mint]`. The account itself holds the
/// SOL reserves; its lamports always equal rent + `real_sol` + unclaimed creator fees.
#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub phase: Phase,
    pub params: LaunchParams,
    pub virtual_sol: u64,
    pub virtual_tokens: u64,
    /// Lamports backing the market.
    pub real_sol: u64,
    /// Tradable tokens: left on the curve, or pool depth after overflow.
    pub real_tokens: u64,
    /// Untradable tokens held back to seed the pool at overflow.
    pub reserve_tokens: u64,
    pub creator_fees_unclaimed: u64,
    pub creator_fees_total: u64,
    pub volume_lamports: u64,
    pub trade_count: u64,
    pub launch_index: u64,
    pub launched_at: i64,
    pub graduated_at: i64,
    pub bump: u8,
}

/// The fully resolved effect of a trade, computed before any account moves.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TradeOutcome {
    /// Lamports entering (buy) or leaving (sell) `real_sol`.
    pub sol: u64,
    pub tokens: u64,
    pub protocol_fee: u64,
    pub creator_fee: u64,
    /// True when this buy drains the curve and triggers overflow.
    pub overflows: bool,
}

impl Pool {
    pub fn price_reserves(&self) -> (u64, u64) {
        match self.phase {
            Phase::Curve => (self.virtual_sol, self.virtual_tokens),
            Phase::Pool => (self.real_sol, self.real_tokens),
        }
    }

    pub fn in_calm_waters(&self, now: i64) -> bool {
        self.phase == Phase::Curve && now < self.launched_at.saturating_add(self.params.calm_period_secs)
    }

    /// Quote a buy spending at most `gross_lamports` (fees included). On the
    /// curve, an oversized buy is trimmed to exactly the remaining supply.
    pub fn quote_buy(&self, gross_lamports: u64) -> Result<TradeOutcome> {
        require!(gross_lamports > 0, LiqError::ZeroAmount);
        let p = &self.params;
        let fee_bps = p.total_fee_bps();
        let (ps, pt) = self.price_reserves();

        let mut net = math::net_from_gross(gross_lamports, fee_bps).ok_or(LiqError::MathOverflow)?;
        let mut tokens = math::tokens_out_for_sol(ps, pt, net).ok_or(LiqError::MathOverflow)?;
        let mut fee = gross_lamports - net;
        let mut overflows = false;

        if self.phase == Phase::Curve && tokens >= self.real_tokens {
            tokens = self.real_tokens;
            net = math::sol_in_for_tokens(ps, pt, tokens).ok_or(LiqError::MathOverflow)?;
            fee = math::fee_on(net, fee_bps).ok_or(LiqError::MathOverflow)?;
            overflows = true;
        }
        require!(tokens > 0, LiqError::ZeroAmount);
        require!(tokens < pt, LiqError::InsufficientLiquidity);

        let (protocol_fee, creator_fee) =
            math::split_fee(fee, p.protocol_fee_bps, p.creator_fee_bps).ok_or(LiqError::MathOverflow)?;
        Ok(TradeOutcome { sol: net, tokens, protocol_fee, creator_fee, overflows })
    }

    pub fn quote_sell(&self, tokens_in: u64) -> Result<TradeOutcome> {
        require!(tokens_in > 0, LiqError::ZeroAmount);
        let p = &self.params;
        let (ps, pt) = self.price_reserves();
        let gross = math::sol_out_for_tokens(ps, pt, tokens_in)
            .ok_or(LiqError::MathOverflow)?
            .min(self.real_sol);
        let fee = math::fee_on(gross, p.total_fee_bps()).ok_or(LiqError::MathOverflow)?;
        require!(gross > fee, LiqError::InsufficientLiquidity);
        let (protocol_fee, creator_fee) =
            math::split_fee(fee, p.protocol_fee_bps, p.creator_fee_bps).ok_or(LiqError::MathOverflow)?;
        Ok(TradeOutcome { sol: gross, tokens: tokens_in, protocol_fee, creator_fee, overflows: false })
    }

    pub fn apply_buy(&mut self, o: &TradeOutcome) -> Result<()> {
        self.real_sol = self.real_sol.checked_add(o.sol).ok_or(LiqError::MathOverflow)?;
        self.real_tokens = self.real_tokens.checked_sub(o.tokens).ok_or(LiqError::MathOverflow)?;
        if self.phase == Phase::Curve {
            self.virtual_sol = self.virtual_sol.checked_add(o.sol).ok_or(LiqError::MathOverflow)?;
            self.virtual_tokens = self.virtual_tokens.checked_sub(o.tokens).ok_or(LiqError::MathOverflow)?;
        }
        self.record(o)
    }

    pub fn apply_sell(&mut self, o: &TradeOutcome) -> Result<()> {
        self.real_sol = self.real_sol.checked_sub(o.sol).ok_or(LiqError::MathOverflow)?;
        self.real_tokens = self.real_tokens.checked_add(o.tokens).ok_or(LiqError::MathOverflow)?;
        if self.phase == Phase::Curve {
            self.virtual_sol = self.virtual_sol.checked_sub(o.sol).ok_or(LiqError::MathOverflow)?;
            self.virtual_tokens = self.virtual_tokens.checked_add(o.tokens).ok_or(LiqError::MathOverflow)?;
        }
        self.record(o)
    }

    fn record(&mut self, o: &TradeOutcome) -> Result<()> {
        self.creator_fees_unclaimed =
            self.creator_fees_unclaimed.checked_add(o.creator_fee).ok_or(LiqError::MathOverflow)?;
        self.creator_fees_total = self.creator_fees_total.checked_add(o.creator_fee).ok_or(LiqError::MathOverflow)?;
        self.volume_lamports = self.volume_lamports.saturating_add(o.sol);
        self.trade_count = self.trade_count.saturating_add(1);
        Ok(())
    }

    /// Plan the overflow: (graduation fee, tokens to seed the pool, tokens to burn).
    /// The pool opens at exactly the curve's closing price.
    pub fn plan_overflow(&self) -> Result<(u64, u64, u64)> {
        let fee = self.params.graduation_fee_lamports.min(self.real_sol);
        let sol_seed = self.real_sol - fee;
        let pool_tokens = math::pool_tokens_for_price(sol_seed, self.virtual_sol, self.virtual_tokens)
            .ok_or(LiqError::MathOverflow)?
            .min(self.reserve_tokens);
        require!(sol_seed > 0 && pool_tokens > 0, LiqError::InsufficientLiquidity);
        Ok((fee, pool_tokens, self.reserve_tokens - pool_tokens))
    }

    pub fn apply_overflow(&mut self, fee: u64, pool_tokens: u64, now: i64) {
        self.real_sol -= fee;
        self.real_tokens = pool_tokens;
        self.reserve_tokens = 0;
        self.phase = Phase::Pool;
        self.graduated_at = now;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params() -> LaunchParams {
        LaunchParams {
            protocol_fee_bps: 100,
            creator_fee_bps: 25,
            initial_virtual_sol: 30_000_000_000,
            initial_virtual_tokens: 1_073_000_000_000_000,
            curve_supply: 793_100_000_000_000,
            total_supply: 1_000_000_000_000_000,
            calm_period_secs: 60,
            calm_max_buy_lamports: 2_000_000_000,
            graduation_fee_lamports: 1_000_000_000,
        }
    }

    fn fresh_pool() -> Pool {
        let p = params();
        Pool {
            mint: Pubkey::default(),
            creator: Pubkey::default(),
            phase: Phase::Curve,
            params: p,
            virtual_sol: p.initial_virtual_sol,
            virtual_tokens: p.initial_virtual_tokens,
            real_sol: 0,
            real_tokens: p.curve_supply,
            reserve_tokens: p.total_supply - p.curve_supply,
            creator_fees_unclaimed: 0,
            creator_fees_total: 0,
            volume_lamports: 0,
            trade_count: 0,
            launch_index: 0,
            launched_at: 1_000,
            graduated_at: 0,
            bump: 255,
        }
    }

    #[test]
    fn default_params_are_valid() {
        params().validate().unwrap();
    }

    #[test]
    fn rejects_punitive_fees() {
        let mut p = params();
        p.protocol_fee_bps = 400;
        p.creator_fee_bps = 101;
        assert!(p.validate().is_err());
    }

    #[test]
    fn buy_charges_at_most_gross() {
        let pool = fresh_pool();
        let o = pool.quote_buy(1_000_000_000).unwrap();
        assert!(o.sol + o.protocol_fee + o.creator_fee <= 1_000_000_000);
        assert!(!o.overflows);
        assert!(o.tokens > 30_000_000_000_000, "1 SOL should buy >30M tokens at launch");
    }

    #[test]
    fn whale_buy_is_trimmed_and_overflows() {
        let pool = fresh_pool();
        let o = pool.quote_buy(500_000_000_000).unwrap();
        assert!(o.overflows);
        assert_eq!(o.tokens, pool.real_tokens);
        assert!(o.sol < 90_000_000_000 && o.sol > 80_000_000_000, "raised {}", o.sol);
    }

    #[test]
    fn full_lifecycle_keeps_price_continuous() {
        let mut pool = fresh_pool();
        let o = pool.quote_buy(500_000_000_000).unwrap();
        pool.apply_buy(&o).unwrap();
        let closing = (pool.virtual_sol as f64) / (pool.virtual_tokens as f64);
        let (fee, seed, burn) = pool.plan_overflow().unwrap();
        assert_eq!(seed + burn, params().total_supply - params().curve_supply);
        pool.apply_overflow(fee, seed, 2_000);
        let opening = (pool.real_sol as f64) / (pool.real_tokens as f64);
        assert!((closing - opening).abs() / closing < 1e-9, "{closing} vs {opening}");
        assert_eq!(pool.phase, Phase::Pool);

        // Pool phase: buys and sells both work and never drain reserves.
        let b = pool.quote_buy(10_000_000_000).unwrap();
        pool.apply_buy(&b).unwrap();
        let s = pool.quote_sell(b.tokens).unwrap();
        assert!(s.sol <= b.sol);
        pool.apply_sell(&s).unwrap();
        assert!(pool.real_sol > 0 && pool.real_tokens > 0);
    }

    #[test]
    fn sell_cannot_exceed_real_sol() {
        let mut pool = fresh_pool();
        let o = pool.quote_buy(5_000_000_000).unwrap();
        pool.apply_buy(&o).unwrap();
        let s = pool.quote_sell(o.tokens).unwrap();
        assert!(s.sol <= pool.real_sol);
        pool.apply_sell(&s).unwrap();
        assert_eq!(pool.virtual_sol - pool.real_sol, params().initial_virtual_sol);
    }

    #[test]
    fn calm_waters_window() {
        let pool = fresh_pool();
        assert!(pool.in_calm_waters(1_000));
        assert!(pool.in_calm_waters(1_059));
        assert!(!pool.in_calm_waters(1_060));
    }
}
