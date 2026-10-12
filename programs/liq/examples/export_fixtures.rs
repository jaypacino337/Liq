//! Writes sdk/test/fixtures.json: discriminators, serialized accounts and
//! reference quotes, so the TypeScript SDK is tested against this exact code.
//!
//! cargo run -p liq --example export_fixtures

use anchor_lang::{prelude::Pubkey, AccountSerialize, Discriminator, Event};
use liq::{
    events::TradeEvent,
    state::{LaunchParams, Phase, Pool},
};

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn main() {
    let params = LaunchParams {
        protocol_fee_bps: 100,
        creator_fee_bps: 25,
        initial_virtual_sol: 30_000_000_000,
        initial_virtual_tokens: 1_073_000_000_000_000,
        curve_supply: 793_100_000_000_000,
        total_supply: 1_000_000_000_000_000,
        calm_period_secs: 30,
        calm_max_buy_lamports: 2_000_000_000,
        graduation_fee_lamports: 1_000_000_000,
    };
    let mut pool = Pool {
        mint: Pubkey::new_from_array([7; 32]),
        creator: Pubkey::new_from_array([9; 32]),
        phase: Phase::Curve,
        params,
        virtual_sol: params.initial_virtual_sol,
        virtual_tokens: params.initial_virtual_tokens,
        real_sol: 0,
        real_tokens: params.curve_supply,
        reserve_tokens: params.total_supply - params.curve_supply,
        creator_fees_unclaimed: 0,
        creator_fees_total: 0,
        volume_lamports: 0,
        trade_count: 0,
        launch_index: 42,
        launched_at: 1_760_000_000,
        graduated_at: 0,
        bump: 254,
    };

    let mut quotes = vec![];
    for gross in [1_000u64, 123_456_789, 1_000_000_000, 7_777_777_777, 25_000_000_000, 400_000_000_000] {
        let o = pool.quote_buy(gross).unwrap();
        quotes.push(format!(
            r#"{{"kind":"buy","phase":"curve","input":"{gross}","sol":"{}","tokens":"{}","protocolFee":"{}","creatorFee":"{}","overflows":{}}}"#,
            o.sol, o.tokens, o.protocol_fee, o.creator_fee, o.overflows
        ));
    }
    let b = pool.quote_buy(12_345_678_901).unwrap();
    pool.apply_buy(&b).unwrap();
    for tokens in [1_000_000u64, 50_000_000_000_000, b.tokens] {
        let o = pool.quote_sell(tokens).unwrap();
        quotes.push(format!(
            r#"{{"kind":"sell","phase":"curve-after-buy","input":"{tokens}","sol":"{}","tokens":"{}","protocolFee":"{}","creatorFee":"{}","overflows":false}}"#,
            o.sol, o.tokens, o.protocol_fee, o.creator_fee
        ));
    }
    let mut pool_bytes = vec![];
    pool.try_serialize(&mut pool_bytes).unwrap();

    let ev = TradeEvent {
        mint: pool.mint,
        trader: pool.creator,
        is_buy: true,
        sol_amount: b.sol,
        token_amount: b.tokens,
        protocol_fee: b.protocol_fee,
        creator_fee: b.creator_fee,
        price_sol_reserves: pool.virtual_sol,
        price_token_reserves: pool.virtual_tokens,
        phase: 0,
        timestamp: 1_760_000_100,
    };

    let ix = |name: &str, d: &[u8]| format!(r#""{name}":"{}""#, hex(d));
    let out = format!(
        r#"{{
  "programId": "{}",
  "discriminators": {{
    "accounts": {{"Config":"{}","Pool":"{}"}},
    "events": {{"TradeEvent":"{}","LaunchEvent":"{}","OverflowEvent":"{}"}},
    "instructions": {{{},{},{},{},{},{}}}
  }},
  "poolAfterBuy": {{"bytes":"{}","realSol":"{}","virtualTokens":"{}","creatorFeesUnclaimed":"{}"}},
  "tradeEventData": "{}",
  "quotes": [
    {}
  ]
}}
"#,
        liq::ID,
        hex(liq::state::Config::DISCRIMINATOR),
        hex(Pool::DISCRIMINATOR),
        hex(TradeEvent::DISCRIMINATOR),
        hex(liq::events::LaunchEvent::DISCRIMINATOR),
        hex(liq::events::OverflowEvent::DISCRIMINATOR),
        ix("initialize", liq::instruction::Initialize::DISCRIMINATOR),
        ix("updateConfig", liq::instruction::UpdateConfig::DISCRIMINATOR),
        ix("createLaunch", liq::instruction::CreateLaunch::DISCRIMINATOR),
        ix("buy", liq::instruction::Buy::DISCRIMINATOR),
        ix("sell", liq::instruction::Sell::DISCRIMINATOR),
        ix("claimCreatorFees", liq::instruction::ClaimCreatorFees::DISCRIMINATOR),
        hex(&pool_bytes),
        pool.real_sol,
        pool.virtual_tokens,
        pool.creator_fees_unclaimed,
        hex(&ev.data()),
        quotes.join(",\n    "),
    );
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../sdk/test/fixtures.json");
    std::fs::write(path, out).unwrap();
    println!("wrote {path}");
}
