//! Pure, overflow-safe pricing math shared by both phases of a Liq pool.
//!
//! Every function works on `u128` intermediates and returns `None` on
//! overflow or an impossible request, so callers map that to `MathOverflow`.
//! Rounding always favours the pool: users receive `floor`, pay `ceil`.

pub const BPS_DENOMINATOR: u128 = 10_000;

/// Tokens received for `sol_in` lamports against constant-product reserves.
/// `floor(token_reserves * sol_in / (sol_reserves + sol_in))`
pub fn tokens_out_for_sol(sol_reserves: u64, token_reserves: u64, sol_in: u64) -> Option<u64> {
    let num = (token_reserves as u128).checked_mul(sol_in as u128)?;
    let den = (sol_reserves as u128).checked_add(sol_in as u128)?;
    if den == 0 {
        return None;
    }
    u64::try_from(num / den).ok()
}

/// Lamports required to buy exactly `tokens_out`.
/// `ceil(sol_reserves * tokens_out / (token_reserves - tokens_out))`
pub fn sol_in_for_tokens(sol_reserves: u64, token_reserves: u64, tokens_out: u64) -> Option<u64> {
    if tokens_out >= token_reserves {
        return None;
    }
    let num = (sol_reserves as u128).checked_mul(tokens_out as u128)?;
    let den = (token_reserves - tokens_out) as u128;
    u64::try_from(ceil_div(num, den)?).ok()
}

/// Lamports received (before fees) for selling `tokens_in`.
/// `floor(sol_reserves * tokens_in / (token_reserves + tokens_in))`
pub fn sol_out_for_tokens(sol_reserves: u64, token_reserves: u64, tokens_in: u64) -> Option<u64> {
    let num = (sol_reserves as u128).checked_mul(tokens_in as u128)?;
    let den = (token_reserves as u128).checked_add(tokens_in as u128)?;
    if den == 0 {
        return None;
    }
    u64::try_from(num / den).ok()
}

/// Fee charged on `amount`, rounded up.
pub fn fee_on(amount: u64, bps: u16) -> Option<u64> {
    let num = (amount as u128).checked_mul(bps as u128)?;
    u64::try_from(ceil_div(num, BPS_DENOMINATOR)?).ok()
}

/// The largest net amount whose fee-inclusive cost fits inside `gross`.
/// `floor(gross * 10_000 / (10_000 + bps))`
pub fn net_from_gross(gross: u64, bps: u16) -> Option<u64> {
    let num = (gross as u128).checked_mul(BPS_DENOMINATOR)?;
    let den = BPS_DENOMINATOR.checked_add(bps as u128)?;
    u64::try_from(num / den).ok()
}

/// Splits a total fee into (protocol, creator) shares by their bps weights.
/// The creator share is floored; the protocol takes the remainder.
pub fn split_fee(fee: u64, protocol_bps: u16, creator_bps: u16) -> Option<(u64, u64)> {
    let total = protocol_bps as u128 + creator_bps as u128;
    if total == 0 {
        return Some((0, 0));
    }
    let creator = u64::try_from((fee as u128).checked_mul(creator_bps as u128)? / total).ok()?;
    Some((fee.checked_sub(creator)?, creator))
}

/// Tokens to seed the permanent pool so its opening price equals the
/// curve's closing price: `real_sol * virtual_tokens / virtual_sol`.
pub fn pool_tokens_for_price(real_sol: u64, virtual_sol: u64, virtual_tokens: u64) -> Option<u64> {
    if virtual_sol == 0 {
        return None;
    }
    let num = (real_sol as u128).checked_mul(virtual_tokens as u128)?;
    u64::try_from(num / virtual_sol as u128).ok()
}

fn ceil_div(num: u128, den: u128) -> Option<u128> {
    if den == 0 {
        return None;
    }
    Some(num.div_ceil(den))
}

#[cfg(test)]
mod tests {
    use super::*;

    const VS: u64 = 30_000_000_000; // 30 SOL
    const VT: u64 = 1_073_000_000_000_000; // 1.073B tokens @ 6dp

    #[test]
    fn buy_then_sell_never_profits() {
        for sol in [1u64, 1_000, 10_000_000, 1_000_000_000, 50_000_000_000] {
            let tokens = tokens_out_for_sol(VS, VT, sol).unwrap();
            let back = sol_out_for_tokens(VS + sol, VT - tokens, tokens).unwrap();
            assert!(back <= sol, "round trip of {sol} returned {back}");
        }
    }

    #[test]
    fn exact_out_cost_covers_quote() {
        for tokens in [1u64, 1_000_000, 500_000_000_000, 793_100_000_000_000] {
            let cost = sol_in_for_tokens(VS, VT, tokens).unwrap();
            assert!(tokens_out_for_sol(VS, VT, cost).unwrap() >= tokens);
            if cost > 0 {
                assert!(tokens_out_for_sol(VS, VT, cost - 1).unwrap() < tokens);
            }
        }
    }

    #[test]
    fn cannot_buy_entire_reserve() {
        assert!(sol_in_for_tokens(VS, VT, VT).is_none());
        assert!(sol_in_for_tokens(VS, VT, VT + 1).is_none());
    }

    #[test]
    fn gross_net_fee_roundtrip_is_conservative() {
        for bps in [0u16, 1, 100, 125, 500] {
            for gross in [0u64, 1, 99, 10_001, 1_000_000_000, u64::MAX / 2] {
                let net = net_from_gross(gross, bps).unwrap();
                let fee = fee_on(net, bps).unwrap();
                assert!(net + fee <= gross, "bps={bps} gross={gross}");
            }
        }
    }

    #[test]
    fn fee_split_is_exact() {
        let (p, c) = split_fee(1_001, 100, 50).unwrap();
        assert_eq!(p + c, 1_001);
        assert_eq!(c, 333);
        assert_eq!(split_fee(500, 0, 0).unwrap(), (0, 0));
        assert_eq!(split_fee(500, 0, 100).unwrap(), (0, 500));
    }

    #[test]
    fn pool_seed_preserves_closing_price() {
        // Pump-style curve fully sold: ~85 SOL raised.
        let curve_tokens = 793_100_000_000_000u64;
        let cost = sol_in_for_tokens(VS, VT, curve_tokens).unwrap();
        let vs_end = VS + cost;
        let vt_end = VT - curve_tokens;
        let pool_tokens = pool_tokens_for_price(cost, vs_end, vt_end).unwrap();
        // price_curve = vs_end / vt_end ; price_pool = cost / pool_tokens
        let lhs = vs_end as u128 * pool_tokens as u128;
        let rhs = cost as u128 * vt_end as u128;
        assert!(rhs - lhs < vs_end as u128, "prices diverge");
        assert!(pool_tokens < 206_900_000_000_000 + 1_000_000_000);
    }

    #[test]
    fn overflow_is_reported_not_wrapped() {
        assert!(tokens_out_for_sol(0, 0, 0).is_none());
        assert!(fee_on(u64::MAX, 10_000).is_some());
        assert!(sol_out_for_tokens(u64::MAX, 1, u64::MAX).is_some());
    }
}
