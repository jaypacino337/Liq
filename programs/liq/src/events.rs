use anchor_lang::prelude::*;

#[event]
pub struct LaunchEvent {
    pub mint: Pubkey,
    pub pool: Pubkey,
    pub creator: Pubkey,
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub launch_index: u64,
    pub timestamp: i64,
}

#[event]
pub struct TradeEvent {
    pub mint: Pubkey,
    pub trader: Pubkey,
    pub is_buy: bool,
    /// Lamports that entered (buy) or left (sell) the pool reserves.
    pub sol_amount: u64,
    pub token_amount: u64,
    pub protocol_fee: u64,
    pub creator_fee: u64,
    /// Reserves used for pricing after the trade (virtual on the curve, real in the pool).
    pub price_sol_reserves: u64,
    pub price_token_reserves: u64,
    pub phase: u8,
    pub timestamp: i64,
}

/// Emitted when a curve sells out and spills into its permanent pool.
#[event]
pub struct OverflowEvent {
    pub mint: Pubkey,
    pub sol_seeded: u64,
    pub tokens_seeded: u64,
    pub tokens_burned: u64,
    pub graduation_fee: u64,
    pub timestamp: i64,
}

#[event]
pub struct CreatorClaimEvent {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub amount: u64,
}
