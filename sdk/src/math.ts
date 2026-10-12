/**
 * Bit-exact port of `programs/liq/src/math.rs` and the pool quoting logic in
 * `state.rs`. Rounding always favours the pool. Fixture tests compare these
 * results with values produced by the Rust code itself.
 */
import { BPS_DENOMINATOR, LAMPORTS_PER_SOL, TOKEN_UNIT } from "./constants";
import type { PoolAccount, TradeOutcome } from "./types";

export class LiqMathError extends Error {}

const U64_MAX = (1n << 64n) - 1n;

function u64(v: bigint): bigint {
  if (v < 0n || v > U64_MAX) throw new LiqMathError("MathOverflow");
  return v;
}

const ceilDiv = (num: bigint, den: bigint) => (num + den - 1n) / den;

export function tokensOutForSol(solReserves: bigint, tokenReserves: bigint, solIn: bigint): bigint {
  const den = solReserves + solIn;
  if (den === 0n) throw new LiqMathError("MathOverflow");
  return u64((tokenReserves * solIn) / den);
}

export function solInForTokens(solReserves: bigint, tokenReserves: bigint, tokensOut: bigint): bigint {
  if (tokensOut >= tokenReserves) throw new LiqMathError("InsufficientLiquidity");
  return u64(ceilDiv(solReserves * tokensOut, tokenReserves - tokensOut));
}

export function solOutForTokens(solReserves: bigint, tokenReserves: bigint, tokensIn: bigint): bigint {
  const den = tokenReserves + tokensIn;
  if (den === 0n) throw new LiqMathError("MathOverflow");
  return u64((solReserves * tokensIn) / den);
}

export const feeOn = (amount: bigint, bps: number) => u64(ceilDiv(amount * BigInt(bps), BPS_DENOMINATOR));

export const netFromGross = (gross: bigint, bps: number) =>
  u64((gross * BPS_DENOMINATOR) / (BPS_DENOMINATOR + BigInt(bps)));

export function splitFee(fee: bigint, protocolBps: number, creatorBps: number): [bigint, bigint] {
  const total = BigInt(protocolBps + creatorBps);
  if (total === 0n) return [0n, 0n];
  const creator = (fee * BigInt(creatorBps)) / total;
  return [fee - creator, creator];
}

export function priceReserves(pool: PoolAccount): [bigint, bigint] {
  return pool.phase === "curve" ? [pool.virtualSol, pool.virtualTokens] : [pool.realSol, pool.realTokens];
}

export const totalFeeBps = (pool: PoolAccount) => pool.params.protocolFeeBps + pool.params.creatorFeeBps;

export function quoteBuy(pool: PoolAccount, grossLamports: bigint): TradeOutcome {
  if (grossLamports <= 0n) throw new LiqMathError("ZeroAmount");
  const bps = totalFeeBps(pool);
  const [ps, pt] = priceReserves(pool);

  let net = netFromGross(grossLamports, bps);
  let tokens = tokensOutForSol(ps, pt, net);
  let fee = grossLamports - net;
  let overflows = false;

  if (pool.phase === "curve" && tokens >= pool.realTokens) {
    tokens = pool.realTokens;
    net = solInForTokens(ps, pt, tokens);
    fee = feeOn(net, bps);
    overflows = true;
  }
  if (tokens <= 0n) throw new LiqMathError("ZeroAmount");
  if (tokens >= pt) throw new LiqMathError("InsufficientLiquidity");

  const [protocolFee, creatorFee] = splitFee(fee, pool.params.protocolFeeBps, pool.params.creatorFeeBps);
  return { sol: net, tokens, protocolFee, creatorFee, overflows };
}

export function quoteSell(pool: PoolAccount, tokensIn: bigint): TradeOutcome {
  if (tokensIn <= 0n) throw new LiqMathError("ZeroAmount");
  const [ps, pt] = priceReserves(pool);
  let gross = solOutForTokens(ps, pt, tokensIn);
  if (gross > pool.realSol) gross = pool.realSol;
  const fee = feeOn(gross, totalFeeBps(pool));
  if (gross <= fee) throw new LiqMathError("InsufficientLiquidity");
  const [protocolFee, creatorFee] = splitFee(fee, pool.params.protocolFeeBps, pool.params.creatorFeeBps);
  return { sol: gross, tokens: tokensIn, protocolFee, creatorFee, overflows: false };
}

/** Total lamports a buy will take from the wallet (reserves + all fees). */
export const buyCost = (o: TradeOutcome) => o.sol + o.protocolFee + o.creatorFee;
/** Lamports a sell pays out to the wallet after fees. */
export const sellPayout = (o: TradeOutcome) => o.sol - o.protocolFee - o.creatorFee;

/** Immutable state transition mirroring `Pool::apply_buy` (+ overflow). */
export function applyBuy(pool: PoolAccount, o: TradeOutcome, now = 0n): PoolAccount {
  const next: PoolAccount = {
    ...pool,
    realSol: pool.realSol + o.sol,
    realTokens: pool.realTokens - o.tokens,
    creatorFeesUnclaimed: pool.creatorFeesUnclaimed + o.creatorFee,
    creatorFeesTotal: pool.creatorFeesTotal + o.creatorFee,
    volumeLamports: pool.volumeLamports + o.sol,
    tradeCount: pool.tradeCount + 1n,
  };
  if (pool.phase === "curve") {
    next.virtualSol = pool.virtualSol + o.sol;
    next.virtualTokens = pool.virtualTokens - o.tokens;
  }
  return o.overflows ? applyOverflow(next, now) : next;
}

export function applySell(pool: PoolAccount, o: TradeOutcome): PoolAccount {
  const next: PoolAccount = {
    ...pool,
    realSol: pool.realSol - o.sol,
    realTokens: pool.realTokens + o.tokens,
    creatorFeesUnclaimed: pool.creatorFeesUnclaimed + o.creatorFee,
    creatorFeesTotal: pool.creatorFeesTotal + o.creatorFee,
    volumeLamports: pool.volumeLamports + o.sol,
    tradeCount: pool.tradeCount + 1n,
  };
  if (pool.phase === "curve") {
    next.virtualSol = pool.virtualSol - o.sol;
    next.virtualTokens = pool.virtualTokens + o.tokens;
  }
  return next;
}

export function planOverflow(pool: PoolAccount) {
  const fee = pool.params.graduationFeeLamports < pool.realSol ? pool.params.graduationFeeLamports : pool.realSol;
  const solSeed = pool.realSol - fee;
  let poolTokens = (solSeed * pool.virtualTokens) / pool.virtualSol;
  if (poolTokens > pool.reserveTokens) poolTokens = pool.reserveTokens;
  return { fee, solSeed, poolTokens, burn: pool.reserveTokens - poolTokens };
}

function applyOverflow(pool: PoolAccount, now: bigint): PoolAccount {
  const { fee, poolTokens } = planOverflow(pool);
  return {
    ...pool,
    realSol: pool.realSol - fee,
    realTokens: poolTokens,
    reserveTokens: 0n,
    phase: "pool",
    graduatedAt: now,
  };
}

// ── Display helpers ─────────────────────────────────────────────────────────

/** Spot price in SOL per whole token. */
export function spotPrice(pool: PoolAccount): number {
  const [ps, pt] = priceReserves(pool);
  if (pt === 0n) return 0;
  return Number(ps) / Number(LAMPORTS_PER_SOL) / (Number(pt) / Number(TOKEN_UNIT));
}

/** Fully diluted market cap in SOL (circulating supply × spot price). */
export function marketCapSol(pool: PoolAccount): number {
  const supply = pool.phase === "curve" ? pool.params.totalSupply : pool.params.curveSupply + pool.realTokens;
  return spotPrice(pool) * (Number(supply) / Number(TOKEN_UNIT));
}

/** 0..1 — how full the vessel is. 1 once the curve has overflowed. */
export function fillLevel(pool: PoolAccount): number {
  if (pool.phase === "pool") return 1;
  const sold = pool.params.curveSupply - pool.realTokens;
  return Number(sold) / Number(pool.params.curveSupply);
}

/** Lamports needed (fees included) to finish the curve right now. */
export function lamportsToOverflow(pool: PoolAccount): bigint {
  if (pool.phase === "pool") return 0n;
  const [ps, pt] = priceReserves(pool);
  const net = solInForTokens(ps, pt, pool.realTokens);
  return net + feeOn(net, totalFeeBps(pool));
}

/** Apply slippage tolerance (in bps) to a minimum-out amount. */
export const withSlippage = (amount: bigint, slippageBps: number) =>
  (amount * (BPS_DENOMINATOR - BigInt(slippageBps))) / BPS_DENOMINATOR;
