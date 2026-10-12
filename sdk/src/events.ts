import { DISCRIMINATORS } from "./constants";
import { Reader, hexToBytes, startsWith } from "./codec";
import type { LiqEvent } from "./types";

const TRADE = hexToBytes(DISCRIMINATORS.events.TradeEvent);
const LAUNCH = hexToBytes(DISCRIMINATORS.events.LaunchEvent);
const OVERFLOW = hexToBytes(DISCRIMINATORS.events.OverflowEvent);

/** Decode one Anchor event payload (discriminator + Borsh body). */
export function decodeEvent(data: Uint8Array): LiqEvent | null {
  const r = new Reader(data).skip(8);
  if (startsWith(data, TRADE)) {
    return {
      name: "TradeEvent",
      data: {
        mint: r.pubkey(),
        trader: r.pubkey(),
        isBuy: r.bool(),
        solAmount: r.u64(),
        tokenAmount: r.u64(),
        protocolFee: r.u64(),
        creatorFee: r.u64(),
        priceSolReserves: r.u64(),
        priceTokenReserves: r.u64(),
        phase: r.u8() === 0 ? "curve" : "pool",
        timestamp: r.i64(),
      },
    };
  }
  if (startsWith(data, LAUNCH)) {
    return {
      name: "LaunchEvent",
      data: {
        mint: r.pubkey(),
        pool: r.pubkey(),
        creator: r.pubkey(),
        name: r.string(),
        symbol: r.string(),
        uri: r.string(),
        launchIndex: r.u64(),
        timestamp: r.i64(),
      },
    };
  }
  if (startsWith(data, OVERFLOW)) {
    return {
      name: "OverflowEvent",
      data: {
        mint: r.pubkey(),
        solSeeded: r.u64(),
        tokensSeeded: r.u64(),
        tokensBurned: r.u64(),
        graduationFee: r.u64(),
        timestamp: r.i64(),
      },
    };
  }
  return null;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Extract every Liq event from a transaction's log messages. */
export function parseEventsFromLogs(logs: readonly string[]): LiqEvent[] {
  const out: LiqEvent[] = [];
  for (const line of logs) {
    const m = /^Program data: (.+)$/.exec(line);
    if (!m?.[1]) continue;
    try {
      const ev = decodeEvent(base64ToBytes(m[1]));
      if (ev) out.push(ev);
    } catch {
      // Not ours, or truncated logs — skip.
    }
  }
  return out;
}
