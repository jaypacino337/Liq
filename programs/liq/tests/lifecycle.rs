//! End-to-end tests against the compiled SBF binary running in LiteSVM with
//! the real Token-2022 and Associated Token programs.
//!
//! Requires `cargo build-sbf` first (the `.so` is loaded from target/deploy).

use anchor_lang::{prelude::Pubkey, AccountDeserialize, InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use liq::{
    constants::{CONFIG_SEED, POOL_SEED},
    state::{Config, LaunchParams, Phase, Pool},
};
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;
use anchor_lang::solana_program::instruction::Instruction;
use spl_token_2022_interface::{
    extension::{BaseStateWithExtensions, StateWithExtensions},
    state::{Account as TokenAccount, Mint},
};
use spl_token_metadata_interface::state::TokenMetadata;

const SOL: u64 = 1_000_000_000;
const TOKEN_2022: Pubkey = anchor_spl::token_2022::ID;
const ATA_PROGRAM: Pubkey = anchor_spl::associated_token::ID;
const SYSTEM: Pubkey = anchor_lang::system_program::ID;
const UPGRADEABLE_LOADER: Pubkey = anchor_lang::solana_program::bpf_loader_upgradeable::ID;

fn params() -> LaunchParams {
    LaunchParams {
        protocol_fee_bps: 100,
        creator_fee_bps: 25,
        initial_virtual_sol: 30 * SOL,
        initial_virtual_tokens: 1_073_000_000_000_000,
        curve_supply: 793_100_000_000_000,
        total_supply: 1_000_000_000_000_000,
        calm_period_secs: 30,
        calm_max_buy_lamports: 2 * SOL,
        graduation_fee_lamports: SOL,
    }
}

struct Env {
    svm: LiteSVM,
    admin: Keypair,
    fee_recipient: Pubkey,
}

fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[CONFIG_SEED], &liq::ID).0
}
fn pool_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[POOL_SEED, mint.as_ref()], &liq::ID).0
}
fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[owner.as_ref(), TOKEN_2022.as_ref(), mint.as_ref()], &ATA_PROGRAM).0
}

impl Env {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        let so = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/liq.so"))
            .expect("run `cargo build-sbf` before the integration tests");
        svm.add_program(liq::ID, &so).unwrap();

        let admin = Keypair::new();
        svm.airdrop(&admin.pubkey(), 10 * SOL).unwrap();
        let fee_recipient = Keypair::new().pubkey();
        svm.airdrop(&fee_recipient, SOL).unwrap();

        // LiteSVM deploys with no upgrade authority; make `admin` the authority
        // so the initialize gate can be exercised for real.
        let programdata = Pubkey::find_program_address(&[liq::ID.as_ref()], &UPGRADEABLE_LOADER).0;
        let mut acct = svm.get_account(&programdata).unwrap();
        acct.data[12] = 1; // Option::Some
        acct.data[13..45].copy_from_slice(admin.pubkey().as_ref());
        svm.set_account(programdata, acct).unwrap();

        let mut env = Env { svm, admin, fee_recipient };
        let admin_pk = env.admin.pubkey();
        let ix = env.initialize_ix(&admin_pk);
        env.send(ix, &[&env.admin.insecure_clone()]).expect("initialize");
        env
    }

    fn initialize_ix(&self, authority: &Pubkey) -> Instruction {
        let programdata = Pubkey::find_program_address(&[liq::ID.as_ref()], &UPGRADEABLE_LOADER).0;
        Instruction {
            program_id: liq::ID,
            accounts: liq::accounts::Initialize {
                authority: *authority,
                config: config_pda(),
                program: liq::ID,
                program_data: programdata,
                system_program: SYSTEM,
            }
            .to_account_metas(None),
            data: liq::instruction::Initialize { fee_recipient: self.fee_recipient, params: params() }.data(),
        }
    }

    fn send(&mut self, ix: Instruction, signers: &[&Keypair]) -> Result<(), String> {
        self.svm.expire_blockhash();
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&signers[0].pubkey()),
            signers,
            self.svm.latest_blockhash(),
        );
        self.svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}\n{}", e.err, e.meta.logs.join("\n")))
    }

    fn user(&mut self, lamports: u64) -> Keypair {
        let kp = Keypair::new();
        self.svm.airdrop(&kp.pubkey(), lamports).unwrap();
        kp
    }

    fn launch(&mut self, creator: &Keypair) -> Pubkey {
        let mint = Keypair::new();
        let ix = Instruction {
            program_id: liq::ID,
            accounts: liq::accounts::CreateLaunch {
                creator: creator.pubkey(),
                config: config_pda(),
                mint: mint.pubkey(),
                pool: pool_pda(&mint.pubkey()),
                vault: ata(&pool_pda(&mint.pubkey()), &mint.pubkey()),
                token_program: TOKEN_2022,
                associated_token_program: ATA_PROGRAM,
                system_program: SYSTEM,
            }
            .to_account_metas(None),
            data: liq::instruction::CreateLaunch {
                name: "Liquid Gold".into(),
                symbol: "LGLD".into(),
                uri: "https://liq.fun/meta/lgld.json".into(),
            }
            .data(),
        };
        self.send(ix, &[creator, &mint]).expect("create_launch");
        mint.pubkey()
    }

    fn trade_accounts(&self, trader: &Pubkey, mint: &Pubkey) -> Vec<anchor_lang::solana_program::instruction::AccountMeta> {
        let pool = pool_pda(mint);
        liq::accounts::Trade {
            trader: *trader,
            config: config_pda(),
            fee_recipient: self.fee_recipient,
            pool,
            mint: *mint,
            vault: ata(&pool, mint),
            trader_token_account: ata(trader, mint),
            token_program: TOKEN_2022,
            associated_token_program: ATA_PROGRAM,
            system_program: SYSTEM,
        }
        .to_account_metas(None)
    }

    fn buy(&mut self, trader: &Keypair, mint: &Pubkey, max_sol_cost: u64, min_tokens_out: u64) -> Result<(), String> {
        let ix = Instruction {
            program_id: liq::ID,
            accounts: self.trade_accounts(&trader.pubkey(), mint),
            data: liq::instruction::Buy { max_sol_cost, min_tokens_out }.data(),
        };
        self.send(ix, &[trader])
    }

    fn sell(&mut self, trader: &Keypair, mint: &Pubkey, tokens_in: u64, min_sol_out: u64) -> Result<(), String> {
        let ix = Instruction {
            program_id: liq::ID,
            accounts: self.trade_accounts(&trader.pubkey(), mint),
            data: liq::instruction::Sell { tokens_in, min_sol_out }.data(),
        };
        self.send(ix, &[trader])
    }

    fn pool(&self, mint: &Pubkey) -> Pool {
        let acct = self.svm.get_account(&pool_pda(mint)).unwrap();
        Pool::try_deserialize(&mut acct.data.as_slice()).unwrap()
    }

    fn token_balance(&self, owner: &Pubkey, mint: &Pubkey) -> u64 {
        self.svm
            .get_account(&ata(owner, mint))
            .map(|a| StateWithExtensions::<TokenAccount>::unpack(&a.data).unwrap().base.amount)
            .unwrap_or(0)
    }

    fn lamports(&self, key: &Pubkey) -> u64 {
        self.svm.get_balance(key).unwrap_or(0)
    }

    fn warp(&mut self, secs: i64) {
        let mut clock: anchor_lang::prelude::Clock = self.svm.get_sysvar();
        clock.unix_timestamp += secs;
        self.svm.set_sysvar(&clock);
    }

    /// Pool lamports must always be exactly rent + reserves + unclaimed creator fees.
    fn assert_solvent(&self, mint: &Pubkey) {
        let pool = self.pool(mint);
        let acct = self.svm.get_account(&pool_pda(mint)).unwrap();
        let rent = self.svm.minimum_balance_for_rent_exemption(acct.data.len());
        assert_eq!(acct.lamports, rent + pool.real_sol + pool.creator_fees_unclaimed, "pool lamports drifted");
        let vault = self.token_balance(&pool_pda(mint), mint);
        assert_eq!(vault, pool.real_tokens + pool.reserve_tokens, "vault tokens drifted");
    }
}

#[test]
fn initialize_is_gated_to_upgrade_authority() {
    let mut env = Env::new();
    let cfg = env.svm.get_account(&config_pda()).unwrap();
    let cfg = Config::try_deserialize(&mut cfg.data.as_slice()).unwrap();
    assert_eq!(cfg.authority, env.admin.pubkey());
    assert_eq!(cfg.params, params());

    // A stranger can't re-run initialize (already exists) — and on a fresh
    // deploy they would fail the upgrade-authority constraint anyway.
    let stranger = env.user(SOL);
    let ix = env.initialize_ix(&stranger.pubkey());
    assert!(env.send(ix, &[&stranger]).is_err());
}

#[test]
fn launch_mints_fixed_supply_with_onchain_metadata() {
    let mut env = Env::new();
    let creator = env.user(5 * SOL);
    let mint = env.launch(&creator);

    let acct = env.svm.get_account(&mint).unwrap();
    let state = StateWithExtensions::<Mint>::unpack(&acct.data).unwrap();
    assert_eq!(state.base.supply, params().total_supply);
    assert!(state.base.mint_authority.is_none(), "mint authority must be renounced");
    assert!(state.base.freeze_authority.is_none(), "no freeze authority");
    let meta = state.get_variable_len_extension::<TokenMetadata>().unwrap();
    assert_eq!(meta.name, "Liquid Gold");
    assert_eq!(meta.symbol, "LGLD");

    let pool = env.pool(&mint);
    assert_eq!(pool.creator, creator.pubkey());
    assert_eq!(pool.phase, Phase::Curve);
    assert_eq!(pool.real_tokens, params().curve_supply);
    env.assert_solvent(&mint);
}

#[test]
fn calm_waters_caps_early_buys_then_lifts() {
    let mut env = Env::new();
    let creator = env.user(5 * SOL);
    let mint = env.launch(&creator);
    let sniper = env.user(100 * SOL);

    let err = env.buy(&sniper, &mint, 10 * SOL, 0).unwrap_err();
    assert!(err.contains("CalmWatersCap") || err.contains("Custom(6010)"), "{err}");
    env.buy(&sniper, &mint, SOL, 0).expect("small buy is allowed during calm waters");

    env.warp(31);
    env.buy(&sniper, &mint, 10 * SOL, 0).expect("cap lifts after the window");
    env.assert_solvent(&mint);
}

#[test]
fn buy_sell_roundtrip_with_fees_and_slippage() {
    let mut env = Env::new();
    let creator = env.user(5 * SOL);
    let mint = env.launch(&creator);
    env.warp(60);
    let trader = env.user(20 * SOL);
    let fee_before = env.lamports(&env.fee_recipient);

    // Slippage guard: demand an impossible amount.
    let err = env.buy(&trader, &mint, SOL, u64::MAX).unwrap_err();
    assert!(err.contains("SlippageExceeded"), "{err}");
    let quote = env.pool(&mint).quote_buy(5 * SOL).unwrap();
    env.buy(&trader, &mint, 5 * SOL, quote.tokens).unwrap();
    let held = env.token_balance(&trader.pubkey(), &mint);
    assert_eq!(held, quote.tokens);
    assert_eq!(env.lamports(&env.fee_recipient) - fee_before, quote.protocol_fee);
    env.assert_solvent(&mint);

    let sell_quote = env.pool(&mint).quote_sell(held).unwrap();
    let payout = sell_quote.sol - sell_quote.protocol_fee - sell_quote.creator_fee;
    assert!(env.sell(&trader, &mint, held, payout + 1).is_err(), "slippage must reject");
    let before = env.lamports(&trader.pubkey());
    env.sell(&trader, &mint, held, payout).unwrap();
    assert_eq!(env.lamports(&trader.pubkey()) - before, payout - 5000, "fee payer pays 5000 lamports");
    assert_eq!(env.token_balance(&trader.pubkey(), &mint), 0);
    env.assert_solvent(&mint);

    // Round trip loses exactly the fees + rounding, never gains.
    let pool = env.pool(&mint);
    assert!(pool.real_sol < 10_000, "only dust should remain: {}", pool.real_sol);
    assert_eq!(pool.trade_count, 2);
}

#[test]
fn overflow_graduates_into_permanent_pool() {
    let mut env = Env::new();
    let creator = env.user(5 * SOL);
    let mint = env.launch(&creator);
    env.warp(60);
    let whale = env.user(200 * SOL);
    let fee_before = env.lamports(&env.fee_recipient);

    env.buy(&whale, &mint, 150 * SOL, 0).expect("whale buy overflows the curve");
    let pool = env.pool(&mint);
    assert_eq!(pool.phase, Phase::Pool);
    assert_eq!(pool.reserve_tokens, 0);
    assert!(pool.real_sol > 80 * SOL, "raised {}", pool.real_sol);
    assert_eq!(env.token_balance(&whale.pubkey(), &mint), params().curve_supply);
    // Graduation fee landed with the protocol.
    assert!(env.lamports(&env.fee_recipient) - fee_before > SOL);
    env.assert_solvent(&mint);

    // Excess reserve was burned, so circulating supply shrank.
    let acct = env.svm.get_account(&mint).unwrap();
    let supply = StateWithExtensions::<Mint>::unpack(&acct.data).unwrap().base.supply;
    assert_eq!(supply, params().curve_supply + pool.real_tokens);

    // The pool trades both ways and can never be drained to zero.
    let half = params().curve_supply / 2;
    env.sell(&whale, &mint, half, 0).unwrap();
    env.buy(&whale, &mint, 5 * SOL, 0).unwrap();
    let rest = env.token_balance(&whale.pubkey(), &mint);
    env.sell(&whale, &mint, rest, 0).unwrap();
    let pool = env.pool(&mint);
    assert!(pool.real_sol > 0 && pool.real_tokens > 0);
    env.assert_solvent(&mint);
}

#[test]
fn creator_claims_accrued_fees() {
    let mut env = Env::new();
    let creator = env.user(5 * SOL);
    let mint = env.launch(&creator);
    env.warp(60);
    let trader = env.user(50 * SOL);
    env.buy(&trader, &mint, 20 * SOL, 0).unwrap();

    let owed = env.pool(&mint).creator_fees_unclaimed;
    assert!(owed > 0);
    let claim = |creator: &Keypair| Instruction {
        program_id: liq::ID,
        accounts: liq::accounts::ClaimCreatorFees { creator: creator.pubkey(), pool: pool_pda(&mint) }
            .to_account_metas(None),
        data: liq::instruction::ClaimCreatorFees {}.data(),
    };

    let impostor = env.user(SOL);
    assert!(env.send(claim(&impostor), &[&impostor]).is_err(), "only the creator may claim");

    let before = env.lamports(&creator.pubkey());
    env.send(claim(&creator), &[&creator]).unwrap();
    assert_eq!(env.lamports(&creator.pubkey()) - before, owed - 5000, "fee payer pays 5000 lamports");
    assert_eq!(env.pool(&mint).creator_fees_unclaimed, 0);
    assert!(env.send(claim(&creator), &[&creator]).is_err(), "nothing left to claim");
    env.assert_solvent(&mint);
}

#[test]
fn pause_blocks_buys_but_never_sells() {
    let mut env = Env::new();
    let creator = env.user(5 * SOL);
    let mint = env.launch(&creator);
    env.warp(60);
    let trader = env.user(20 * SOL);
    env.buy(&trader, &mint, 2 * SOL, 0).unwrap();

    let admin = env.admin.insecure_clone();
    let ix = Instruction {
        program_id: liq::ID,
        accounts: liq::accounts::UpdateConfig { authority: admin.pubkey(), config: config_pda() }
            .to_account_metas(None),
        data: liq::instruction::UpdateConfig {
            new_authority: None,
            fee_recipient: None,
            params: None,
            paused: Some(true),
        }
        .data(),
    };
    env.send(ix, &[&admin]).unwrap();

    assert!(env.buy(&trader, &mint, SOL, 0).unwrap_err().contains("Paused"));
    let held = env.token_balance(&trader.pubkey(), &mint);
    env.sell(&trader, &mint, held, 0).expect("exits stay open while paused");
}
