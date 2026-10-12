/**
 * Sandbox market: a full simulation running in the browser on the SDK's exact
 * on-chain math (same quotes, fees, calm-waters cap and overflow). Simulated
 * traders keep the tide moving so the app feels alive without a deployment.
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  DEFAULT_LAUNCH_PARAMS,
  LAMPORTS_PER_SOL,
  applyBuy,
  applySell,
  buyCost,
  fillLevel,
  quoteBuy,
  quoteSell,
  sellPayout,
  spotPrice,
  type PoolAccount,
} from "@liq/sdk";
import { hueFor, lamportsToSol, tokensToUi } from "./format";
import type { FeedEvent, LaunchInput, MarketSnapshot, TokenView } from "./market";

const STORAGE_KEY = "liq.sandbox.v3";
const START_BALANCE = 25n * LAMPORTS_PER_SOL;
const MAX_TOKENS = 28;
const MAX_HISTORY = 240;
const MAX_FEED = 160;
export const SANDBOX_WALLET = "SandboxWa11et1111111111111111111111111111111";

const SEEDS: Array<[string, string, string]> = [
  ["Mercury Cat", "MERC", "A cat made entirely of quicksilver. Do not pet."],
  ["Tidepod Labs", "TIDE", "Research division of the ocean."],
  ["Deep End", "DEEP", "For people who jumped in without checking."],
  ["Slurp", "SLURP", "The sound liquidity makes when it gets absorbed."],
  ["Honeypot (Real)", "HONEY", "Actual honey. Sticky but sweet."],
  ["Brine Shrimp", "BRINE", "Sea monkeys were the first memecoin."],
  ["Lava Lamp", "LAVA", "Slow, mesmerizing, mostly up."],
  ["Puddle", "PDL", "Small now. Wait for rain."],
  ["Molten Frog", "MFROG", "Ribbit at 1,200°C."],
  ["Overflow Error", "OVFL", "Stack it until it spills."],
  ["Glass Half Full", "HALF", "Optimism, tokenized."],
  ["Nectar", "NECTR", "What the bees are actually farming."],
  ["Splash Zone", "SPLSH", "Front rows get wet."],
  ["Ripple Duck", "RDUCK", "Quack. The pond remembers."],
  ["Viscous", "VISC", "Thick liquidity, slow rugs (none, actually)."],
  ["Hydra", "HYDRA", "Cut one head, two pools appear."],
];

interface SimToken extends TokenView {
  heat: number;
}

interface State {
  tokens: SimToken[];
  feed: FeedEvent[];
  lamports: bigint;
  holdings: Record<string, bigint>;
  bots: Array<{ id: string; holdings: Record<string, bigint> }>;
  savedAt: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]!;
const nowSec = () => Math.floor(Date.now() / 1000);

function newPool(mint: PublicKey, creator: PublicKey, launchedAt: number): PoolAccount {
  const p = DEFAULT_LAUNCH_PARAMS;
  return {
    mint,
    creator,
    phase: "curve",
    params: p,
    virtualSol: p.initialVirtualSol,
    virtualTokens: p.initialVirtualTokens,
    realSol: 0n,
    realTokens: p.curveSupply,
    reserveTokens: p.totalSupply - p.curveSupply,
    creatorFeesUnclaimed: 0n,
    creatorFeesTotal: 0n,
    volumeLamports: 0n,
    tradeCount: 0n,
    launchIndex: 0n,
    launchedAt: BigInt(launchedAt),
    graduatedAt: 0n,
    bump: 255,
  };
}

// ── (de)serialization: bigint + PublicKey survive localStorage ──────────────
function encode(state: State): string {
  // `this[k]` is the raw value: PublicKey.toJSON has already run on `v`.
  return JSON.stringify(state, function (this: Record<string, unknown>, k, v) {
    const raw = this[k];
    if (raw instanceof PublicKey) return { $k: raw.toBase58() };
    if (typeof v === "bigint") return { $b: v.toString() };
    return v;
  });
}
function decode(raw: string): State {
  return JSON.parse(raw, (_k, v) => {
    if (v && typeof v === "object" && "$b" in v) return BigInt(v.$b);
    if (v && typeof v === "object" && "$k" in v) return new PublicKey(v.$k);
    return v;
  });
}

export class SandboxEngine {
  private state: State;
  private listeners = new Set<() => void>();
  private snapshot: MarketSnapshot;
  private timer?: ReturnType<typeof setInterval>;
  private launchTimer = 0;

  constructor() {
    const saved = this.load();
    this.state = saved ?? this.seed();
    // Persist a fresh seed right away so reloads and deep links see the same market.
    if (!saved) this.save();
    this.snapshot = this.buildSnapshot();
  }

  // ── store protocol for useSyncExternalStore ──
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    if (!this.timer) this.timer = setInterval(() => this.tick(), 1100);
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
    };
  };
  getSnapshot = () => this.snapshot;

  private emit() {
    this.snapshot = this.buildSnapshot();
    for (const l of this.listeners) l();
  }

  private buildSnapshot(): MarketSnapshot {
    return {
      mode: "sandbox",
      ready: true,
      tokens: this.state.tokens,
      feed: this.state.feed,
      wallet: { connected: true, address: SANDBOX_WALLET, lamports: this.state.lamports },
      holdings: { ...this.state.holdings },
      now: nowSec(),
    };
  }

  private load(): State | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = decode(raw);
      if (Date.now() - s.savedAt > 6 * 3600_000) return null;
      return s;
    } catch {
      return null;
    }
  }

  private save() {
    try {
      this.state.savedAt = Date.now();
      localStorage.setItem(STORAGE_KEY, encode(this.state));
    } catch {
      /* private mode / quota — sandbox still works in memory */
    }
  }

  private seed(): State {
    const bots = Array.from({ length: 48 }, () => ({ id: Keypair.generate().publicKey.toBase58(), holdings: {} }));
    const state: State = { tokens: [], feed: [], lamports: START_BALANCE, holdings: {}, bots, savedAt: Date.now() };
    this.state = state;
    const now = Date.now();
    SEEDS.forEach(([name, symbol, description], i) => {
      const age = rand(4, 180) * 60;
      const t = this.addToken({ name, symbol, description, creator: pick(bots).id, at: now - age * 1000 });
      // Pre-fill to a spread of levels; a few are on the brink of overflowing.
      const target = i < 2 ? rand(0.78, 0.93) : i < 4 ? 1.05 : Math.pow(Math.random(), 1.7) * 0.75;
      t.heat = i < 2 ? 0.9 : Math.random() * 0.6;
      let clock = now - age * 1000 + 40_000;
      while (fillLevel(t.pool) < Math.min(target, 1) && t.pool.phase === "curve") {
        clock += rand(5_000, 60_000) * (age / 3600);
        this.botTrade(t, true, Math.min(clock, now - 1000), rand(0.3, 6));
      }
      for (let k = 0; k < 6; k++) this.botTrade(t, Math.random() < 0.5, now - rand(1_000, 60_000));
      t.history.sort((a, b) => a.t - b.t);
    });
    state.feed.sort((a, b) => b.t - a.t);
    return state;
  }

  private addToken(o: { name: string; symbol: string; description?: string; image?: string; uri?: string; creator: string; at: number; mint?: PublicKey }): SimToken {
    const mint = o.mint ?? Keypair.generate().publicKey;
    const pool = newPool(mint, new PublicKey(o.creator === SANDBOX_WALLET ? PublicKey.default : o.creator), Math.floor(o.at / 1000));
    const mintStr = mint.toBase58();
    const token: SimToken = {
      mint: mintStr,
      pool,
      name: o.name,
      symbol: o.symbol,
      uri: o.uri ?? "",
      image: o.image,
      description: o.description,
      hue: hueFor(mintStr),
      history: [{ t: o.at, price: spotPrice(pool), isBuy: true, sol: 0 }],
      heat: 0.5,
    };
    this.state.tokens.unshift(token);
    this.pushFeed({ id: `l-${mintStr}`, kind: "launch", t: o.at, mint: mintStr, symbol: o.symbol, trader: o.creator });
    return token;
  }

  private pushFeed(ev: FeedEvent) {
    this.state.feed.unshift(ev);
    if (this.state.feed.length > MAX_FEED) this.state.feed.length = MAX_FEED;
  }

  private record(t: SimToken, isBuy: boolean, sol: bigint, tokens: bigint, trader: string, at: number) {
    t.history.push({ t: at, price: spotPrice(t.pool), isBuy, sol: lamportsToSol(sol), trader });
    if (t.history.length > MAX_HISTORY) t.history.splice(0, t.history.length - MAX_HISTORY);
    this.pushFeed({
      id: `${t.mint}-${at}-${Math.random()}`,
      kind: "trade",
      t: at,
      mint: t.mint,
      symbol: t.symbol,
      trader,
      isBuy,
      sol: lamportsToSol(sol),
      tokens: tokensToUi(tokens),
    });
  }

  /** Execute a trade exactly as the program would. Returns false if it would revert. */
  private botTrade(t: SimToken, isBuy: boolean, at = Date.now(), sizeSol?: number): boolean {
    const bot = pick(this.state.bots);
    try {
      if (isBuy) {
        let sol = sizeSol ?? Math.exp(rand(-2.3, 0.9)) * (0.6 + 2.5 * t.heat);
        const inCalm = t.pool.phase === "curve" && at / 1000 < Number(t.pool.launchedAt + t.pool.params.calmPeriodSecs);
        if (inCalm) sol = Math.min(sol, 1.9);
        const q = quoteBuy(t.pool, BigInt(Math.floor(sol * 1e9)));
        const wasCurve = t.pool.phase === "curve";
        t.pool = applyBuy(t.pool, q, BigInt(Math.floor(at / 1000)));
        bot.holdings[t.mint] = (bot.holdings[t.mint] ?? 0n) + q.tokens;
        this.record(t, true, q.sol, q.tokens, bot.id, at);
        if (wasCurve && t.pool.phase === "pool") this.onOverflow(t, at);
      } else {
        const held = bot.holdings[t.mint] ?? 0n;
        if (held === 0n) return false;
        const amount = (held * BigInt(Math.floor(rand(0.25, 1) * 1000))) / 1000n;
        const q = quoteSell(t.pool, amount);
        t.pool = applySell(t.pool, q);
        bot.holdings[t.mint] = held - amount;
        this.record(t, false, q.sol, amount, bot.id, at);
      }
      return true;
    } catch {
      return false;
    }
  }

  private onOverflow(t: SimToken, at: number) {
    this.pushFeed({ id: `o-${t.mint}`, kind: "overflow", t: at, mint: t.mint, symbol: t.symbol, sol: lamportsToSol(t.pool.realSol) });
    t.heat = Math.min(t.heat, 0.45);
  }

  private tick() {
    const tokens = this.state.tokens;
    const trades = 1 + (Math.random() < 0.45 ? 1 : 0);
    for (let i = 0; i < trades; i++) {
      // Attention skews to hot and young tokens.
      const weights = tokens.map((t) => 0.15 + t.heat * 1.4 + (Date.now() / 1000 - Number(t.pool.launchedAt) < 600 ? 0.8 : 0));
      let r = Math.random() * weights.reduce((a, b) => a + b, 0);
      const t = tokens[weights.findIndex((w) => (r -= w) < 0)] ?? tokens[0];
      if (!t) break;
      const buyBias = 0.36 + 0.42 * t.heat;
      if (!this.botTrade(t, Math.random() < buyBias)) this.botTrade(t, true);
    }
    for (const t of tokens) {
      t.heat = Math.max(0.02, Math.min(0.98, t.heat + rand(-0.06, 0.06)));
    }
    if (++this.launchTimer > 38 + Math.random() * 20 && tokens.length < MAX_TOKENS) {
      this.launchTimer = 0;
      const [name, symbol, description] = pick(SEEDS);
      const n = Math.floor(rand(2, 99));
      const t = this.addToken({ name: `${name} ${n}`, symbol: `${symbol.slice(0, 4)}${n}`, description, creator: pick(this.state.bots).id, at: Date.now() });
      t.heat = rand(0.4, 0.95);
    }
    if (this.launchTimer % 5 === 0) this.save();
    this.emit();
  }

  // ── user actions ──────────────────────────────────────────────────────────
  private token(mint: string): SimToken {
    const t = this.state.tokens.find((x) => x.mint === mint);
    if (!t) throw new Error("Token not found");
    return t;
  }

  async launch(input: LaunchInput): Promise<string> {
    const fee = 20_000_000n; // ~rent for mint + pool + vault
    if (this.state.lamports < fee + input.devBuyLamports) throw new Error("Not enough SOL in your wallet.");
    const mint = input.mintSecret ? Keypair.fromSecretKey(input.mintSecret).publicKey : undefined;
    this.state.lamports -= fee;
    const t = this.addToken({ ...input, creator: SANDBOX_WALLET, at: Date.now(), mint });
    t.heat = rand(0.45, 0.85);
    if (input.devBuyLamports > 0n) await this.buy(t.mint, input.devBuyLamports, 0);
    this.save();
    this.emit();
    return t.mint;
  }

  async buy(mint: string, lamports: bigint, _slippageBps: number): Promise<string> {
    const t = this.token(mint);
    const q = quoteBuy(t.pool, lamports);
    const cost = buyCost(q);
    if (cost > this.state.lamports) throw new Error("Not enough SOL in your wallet.");
    if (t.pool.phase === "curve" && nowSec() < Number(t.pool.launchedAt + t.pool.params.calmPeriodSecs) && q.sol > t.pool.params.calmMaxBuyLamports) {
      throw new Error("Calm waters: buys are capped for the first moments after launch.");
    }
    const wasCurve = t.pool.phase === "curve";
    t.pool = applyBuy(t.pool, q, BigInt(nowSec()));
    this.state.lamports -= cost;
    this.state.holdings[mint] = (this.state.holdings[mint] ?? 0n) + q.tokens;
    this.record(t, true, q.sol, q.tokens, SANDBOX_WALLET, Date.now());
    if (wasCurve && t.pool.phase === "pool") this.onOverflow(t, Date.now());
    t.heat = Math.min(0.98, t.heat + 0.05);
    this.save();
    this.emit();
    return "sandbox";
  }

  async sell(mint: string, tokens: bigint, _slippageBps: number): Promise<string> {
    const t = this.token(mint);
    const held = this.state.holdings[mint] ?? 0n;
    if (tokens > held) throw new Error("You don't hold that many tokens.");
    const q = quoteSell(t.pool, tokens);
    t.pool = applySell(t.pool, q);
    this.state.lamports += sellPayout(q);
    this.state.holdings[mint] = held - tokens;
    this.record(t, false, q.sol, tokens, SANDBOX_WALLET, Date.now());
    this.save();
    this.emit();
    return "sandbox";
  }

  async claim(mint: string): Promise<string> {
    const t = this.token(mint);
    if (!t.pool.creator.equals(PublicKey.default)) throw new Error("Only the creator can claim.");
    const owed = t.pool.creatorFeesUnclaimed;
    if (owed === 0n) throw new Error("No creator fees to claim yet.");
    t.pool = { ...t.pool, creatorFeesUnclaimed: 0n };
    this.state.lamports += owed;
    this.save();
    this.emit();
    return "sandbox";
  }

  refill() {
    this.state.lamports = START_BALANCE;
    this.save();
    this.emit();
  }

  reset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    this.state = this.seed();
    this.save();
    this.emit();
  }
}

/** In the sandbox, the user's wallet is represented by the default pubkey as creator. */
export const isSandboxCreator = (pool: PoolAccount) => pool.creator.equals(PublicKey.default);
