# liq

**A Solana launchpad where liquidity can't be pulled.**

Every token on Liq starts as a drop. Buyers *pour* SOL into its vessel along a bonding curve. When the curve sells out, the vessel **overflows**: the program reopens the market as a constant-product pool it owns outright, at exactly the curve's closing price, and **never mints LP tokens**. There's no withdraw instruction, so there's nothing to rug. That applies to the creator, the admin and us.

```
 launch ──► fill (bonding curve) ──► OVERFLOW ──► permanent pool
 1B minted     price climbs            ~85 SOL     no LP tokens · trades forever
 mint auth     calm-waters cap         reserve     creator still earns fees
 renounced     on early buys           burned
```

## What's in the repo

| Path | What |
|---|---|
| `programs/liq` | Anchor 1.2 program (Token-2022). Pricing math, pool state machine, instructions. |
| `programs/liq/tests` | End-to-end tests that run the compiled `.so` in LiteSVM with the real Token-2022 and ATA programs. |
| `sdk/` | `@liq/sdk`: bit-exact TypeScript port of the math, account and event decoders, instruction builders, `LiqClient`. |
| `app/` | Next.js 16 app: liquid UI, live tide ticker, Pour/Drain trading, launch flow with in-browser vanity mint grinding. |
| `scripts/` | Program-id rotation. `sdk/scripts/init-config.ts` initializes a fresh deployment. |

## Mechanics

| | |
|---|---|
| **Supply** | 1,000,000,000 tokens (6 dp), minted once into the pool vault. Mint authority set to `None` in the same transaction. No freeze authority. |
| **Metadata** | Stored on the mint itself via the Token-2022 metadata extension. The app packs the JSON into the URI, so there's nothing to host. |
| **Curve** | `x·y=k` on 30 SOL / 1.073B virtual reserves. 793.1M tokens are sold on the curve, and full fill raises ~85 SOL. |
| **Overflow** | The buy that empties the curve is trimmed to exactly what's left, and the buyer is only charged for that. Then, in the same instruction: graduation fee out, pool seeded with `real_sol × vT / vS` reserve tokens (price-continuous), excess reserve **burned**, phase becomes `Pool`. |
| **Pool phase** | The same `buy` / `sell` instructions now price against real reserves. Lamports never leave except to traders and fee recipients. |
| **Calm waters** | For the first 30s, each buy is capped at 2 SOL (per transaction). A creator's first buy can be bundled atomically with the launch. |
| **Fees** | 1% protocol + 0.25% creator by default. Hard ceiling of 5% in the program, and each pool snapshots its params at launch. |
| **Creator fees** | Accrue inside the pool account and are claimed with `claim_creator_fees`, so an empty creator wallet can never block trading. |
| **Pause** | The admin can pause launches and buys. **Sells are never paused.** |
| **Init gate** | `initialize` requires the program's upgrade authority, so nobody can front-run config creation after deploy. |
| **Invariant** | Pool lamports = rent + `real_sol` + unclaimed creator fees, and vault = `real_tokens` + `reserve_tokens`. Asserted after every trade in tests. |

Rounding always favours the pool: users receive `floor` and pay `ceil`. A buy followed by a sell can never profit (tested).

### Instructions

| Instruction | Who | Notes |
|---|---|---|
| `initialize(fee_recipient, params)` | upgrade authority | one-time |
| `update_config(new_authority?, fee_recipient?, params?, paused?)` | config authority | only affects future launches |
| `create_launch(name, symbol, uri)` | anyone | mint is a client keypair (vanity-able) |
| `buy(max_sol_cost, min_tokens_out)` | anyone | exact-in SOL, fees included, slippage-guarded |
| `sell(tokens_in, min_sol_out)` | anyone | exact-in tokens, payout after fees |
| `claim_creator_fees()` | pool creator | |

Events: `LaunchEvent`, `TradeEvent`, `OverflowEvent`, `CreatorClaimEvent`. The SDK parses them from logs (`parseEventsFromLogs`) and streams them live (`LiqClient.onEvents`).

## Quick start

Requirements: Rust ≥ 1.97.1, the [Agave/Solana CLI](https://docs.anza.xyz/cli/install) (for `cargo build-sbf`), Node 22, pnpm 10.

```bash
pnpm install

# Program
(cd programs/liq && cargo build-sbf)   # → target/deploy/liq.so
cargo test -p liq                      # 14 unit + 7 LiteSVM end-to-end tests

# SDK (parity fixtures + SDK-built txs against the compiled .so)
pnpm test:sdk

# App
pnpm dev                               # http://localhost:3000
```

### Sandbox mode

The app ships in **sandbox mode** by default: a full market simulation in your browser running the SDK's exact on-chain math, including fees, calm waters, overflow and burn. Simulated traders keep it moving, and you get 25 fake SOL to launch and trade with. Flip the header switch to talk to a real cluster.

### Deploying

```bash
# 1. Use a program id you own (generates a keypair if missing, rebuilds, refreshes fixtures)
scripts/set-program-id.sh

# 2. Deploy
solana program deploy target/deploy/liq.so --program-id target/deploy/liq-keypair.json -u devnet

# 3. Initialize config (signed by the upgrade authority)
RPC_URL=https://api.devnet.solana.com FEE_RECIPIENT=<pubkey> pnpm --filter @liq/sdk init-config

# 4. Point the app at it
cp app/.env.example app/.env.local   # set NEXT_PUBLIC_LIQ_MODE=chain
```

The fee recipient must stay rent-exempt (keep ≥ 0.001 SOL in it), since protocol fees are paid to it directly.

## SDK usage

```ts
import { Connection, PublicKey } from "@solana/web3.js";
import { LiqClient, quoteBuy, fillLevel } from "@liq/sdk";

const client = new LiqClient(new Connection("https://api.devnet.solana.com"));
const pool = await client.fetchPool(mint);
console.log(`${(fillLevel(pool!) * 100).toFixed(1)}% full`);

const { tx, quote } = await client.buildBuy({ trader, mint, lamports: 1_000_000_000n, slippageBps: 100 });
// sign with any wallet adapter, then send
```

## Honest limits

- **Calm waters is per transaction**, not per wallet. A determined sniper can split buys across wallets. It blunts single-transaction whale snipes; it doesn't stop sybils.
- **The pool is Liq's own AMM.** Aggregators won't route to it until someone writes an adapter. Migrating to Raydium/Meteora would reintroduce an LP position someone holds, which is the thing Liq avoids.
- **Not audited.** Treat this as a well-tested starting point, not production-ready.
