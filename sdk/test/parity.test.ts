/**
 * Parity with the on-chain program: every value here was produced by the Rust
 * code (`cargo run -p liq --example export_fixtures`).
 */
import { describe, expect, it } from "vitest";
import fixtures from "./fixtures.json";
import {
  DEFAULT_LAUNCH_PARAMS,
  DISCRIMINATORS,
  LIQ_PROGRAM_ID,
  POOL_ACCOUNT_SIZE,
  applyBuy,
  applySell,
  bytesToHex,
  buyIx,
  decodeEvent,
  decodePool,
  fillLevel,
  hexToBytes,
  lamportsToOverflow,
  marketCapSol,
  parseEventsFromLogs,
  planOverflow,
  quoteBuy,
  quoteSell,
  sellPayout,
  spotPrice,
  type PoolAccount,
} from "../src";
import { PublicKey } from "@solana/web3.js";

function freshPool(): PoolAccount {
  const p = DEFAULT_LAUNCH_PARAMS;
  return {
    mint: new PublicKey(new Uint8Array(32).fill(7)),
    creator: new PublicKey(new Uint8Array(32).fill(9)),
    phase: "curve",
    params: { ...p, calmPeriodSecs: 30n },
    virtualSol: p.initialVirtualSol,
    virtualTokens: p.initialVirtualTokens,
    realSol: 0n,
    realTokens: p.curveSupply,
    reserveTokens: p.totalSupply - p.curveSupply,
    creatorFeesUnclaimed: 0n,
    creatorFeesTotal: 0n,
    volumeLamports: 0n,
    tradeCount: 0n,
    launchIndex: 42n,
    launchedAt: 1_760_000_000n,
    graduatedAt: 0n,
    bump: 254,
  };
}

describe("parity with the Rust program", () => {
  it("uses the same program id and discriminators", () => {
    expect(LIQ_PROGRAM_ID.toBase58()).toBe(fixtures.programId);
    expect(DISCRIMINATORS).toEqual(fixtures.discriminators);
  });

  it("quotes buys and sells bit-for-bit", () => {
    let pool = freshPool();
    for (const q of fixtures.quotes.filter((q) => q.kind === "buy")) {
      const o = quoteBuy(pool, BigInt(q.input));
      expect({ sol: o.sol, tokens: o.tokens, pf: o.protocolFee, cf: o.creatorFee, ov: o.overflows }).toEqual({
        sol: BigInt(q.sol),
        tokens: BigInt(q.tokens),
        pf: BigInt(q.protocolFee),
        cf: BigInt(q.creatorFee),
        ov: q.overflows,
      });
    }
    pool = applyBuy(pool, quoteBuy(pool, 12_345_678_901n));
    for (const q of fixtures.quotes.filter((q) => q.kind === "sell")) {
      const o = quoteSell(pool, BigInt(q.input));
      expect([o.sol, o.protocolFee, o.creatorFee]).toEqual([BigInt(q.sol), BigInt(q.protocolFee), BigInt(q.creatorFee)]);
    }
  });

  it("decodes a Pool account serialized by Rust", () => {
    const bytes = hexToBytes(fixtures.poolAfterBuy.bytes);
    expect(bytes.length).toBe(POOL_ACCOUNT_SIZE);
    const decoded = decodePool(bytes);
    const simulated = applyBuy(freshPool(), quoteBuy(freshPool(), 12_345_678_901n));
    expect(decoded.realSol).toBe(BigInt(fixtures.poolAfterBuy.realSol));
    expect(decoded.virtualTokens).toBe(BigInt(fixtures.poolAfterBuy.virtualTokens));
    expect(decoded.creatorFeesUnclaimed).toBe(BigInt(fixtures.poolAfterBuy.creatorFeesUnclaimed));
    expect(decoded.mint.toBase58()).toBe(simulated.mint.toBase58());
    expect({ ...decoded, mint: null, creator: null }).toEqual({ ...simulated, mint: null, creator: null });
  });

  it("decodes TradeEvent from program logs", () => {
    const data = hexToBytes(fixtures.tradeEventData);
    const ev = decodeEvent(data);
    expect(ev?.name).toBe("TradeEvent");
    const b64 = Buffer.from(data).toString("base64");
    const parsed = parseEventsFromLogs(["Program log: Instruction: Buy", `Program data: ${b64}`, "Program data: AAAA"]);
    expect(parsed).toHaveLength(1);
    if (parsed[0]?.name !== "TradeEvent") throw new Error("wrong event");
    expect(parsed[0].data.isBuy).toBe(true);
    expect(parsed[0].data.timestamp).toBe(1_760_000_100n);
  });
});

describe("pool lifecycle model", () => {
  it("overflows at ~85 SOL and opens the pool at the closing price", () => {
    let pool = freshPool();
    expect(fillLevel(pool)).toBe(0);
    const needed = lamportsToOverflow(pool);
    expect(Number(needed) / 1e9).toBeGreaterThan(85);
    expect(Number(needed) / 1e9).toBeLessThan(87);

    const closing = (() => {
      const o = quoteBuy(pool, needed);
      const after = { ...pool, virtualSol: pool.virtualSol + o.sol, virtualTokens: pool.virtualTokens - o.tokens, realSol: o.sol, realTokens: 0n };
      return { price: spotPrice(after), plan: planOverflow(after) };
    })();
    pool = applyBuy(pool, quoteBuy(pool, needed));
    expect(pool.phase).toBe("pool");
    expect(fillLevel(pool)).toBe(1);
    expect(Math.abs(spotPrice(pool) - closing.price) / closing.price).toBeLessThan(1e-9);
    expect(closing.plan.burn).toBeGreaterThan(0n);
    expect(marketCapSol(pool)).toBeGreaterThan(300);
  });

  it("never lets a round trip profit", () => {
    let pool = freshPool();
    for (const lamports of [10_000n, 1_000_000_000n, 40_000_000_000n]) {
      const b = quoteBuy(pool, lamports);
      const afterBuy = applyBuy(pool, b);
      const s = quoteSell(afterBuy, b.tokens);
      expect(sellPayout(s)).toBeLessThan(lamports);
      pool = applySell(afterBuy, s);
    }
  });
});

describe("instruction encoding", () => {
  it("encodes buy args after the discriminator", () => {
    const k = PublicKey.unique();
    const ix = buyIx({ trader: k, mint: k, feeRecipient: k, maxSolCost: 5n, minTokensOut: 7n });
    expect(bytesToHex(ix.data.subarray(0, 8))).toBe(DISCRIMINATORS.instructions.buy);
    expect(ix.data.readBigUInt64LE(8)).toBe(5n);
    expect(ix.data.readBigUInt64LE(16)).toBe(7n);
    expect(ix.keys).toHaveLength(10);
  });
});
