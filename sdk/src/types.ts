import type { PublicKey } from "@solana/web3.js";

export interface LaunchParams {
  protocolFeeBps: number;
  creatorFeeBps: number;
  initialVirtualSol: bigint;
  initialVirtualTokens: bigint;
  curveSupply: bigint;
  totalSupply: bigint;
  calmPeriodSecs: bigint;
  calmMaxBuyLamports: bigint;
  graduationFeeLamports: bigint;
}

export type Phase = "curve" | "pool";

export interface ConfigAccount {
  authority: PublicKey;
  feeRecipient: PublicKey;
  params: LaunchParams;
  paused: boolean;
  launchCount: bigint;
  bump: number;
}

export interface PoolAccount {
  mint: PublicKey;
  creator: PublicKey;
  phase: Phase;
  params: LaunchParams;
  virtualSol: bigint;
  virtualTokens: bigint;
  realSol: bigint;
  realTokens: bigint;
  reserveTokens: bigint;
  creatorFeesUnclaimed: bigint;
  creatorFeesTotal: bigint;
  volumeLamports: bigint;
  tradeCount: bigint;
  launchIndex: bigint;
  launchedAt: bigint;
  graduatedAt: bigint;
  bump: number;
}

/** Fully resolved trade, mirroring the program's `TradeOutcome`. */
export interface TradeOutcome {
  /** Lamports entering (buy) or leaving (sell) the reserves, before fees. */
  sol: bigint;
  tokens: bigint;
  protocolFee: bigint;
  creatorFee: bigint;
  overflows: boolean;
}

export interface TradeEvent {
  mint: PublicKey;
  trader: PublicKey;
  isBuy: boolean;
  solAmount: bigint;
  tokenAmount: bigint;
  protocolFee: bigint;
  creatorFee: bigint;
  priceSolReserves: bigint;
  priceTokenReserves: bigint;
  phase: Phase;
  timestamp: bigint;
}

export interface LaunchEvent {
  mint: PublicKey;
  pool: PublicKey;
  creator: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  launchIndex: bigint;
  timestamp: bigint;
}

export interface OverflowEvent {
  mint: PublicKey;
  solSeeded: bigint;
  tokensSeeded: bigint;
  tokensBurned: bigint;
  graduationFee: bigint;
  timestamp: bigint;
}

export type LiqEvent =
  | { name: "TradeEvent"; data: TradeEvent }
  | { name: "LaunchEvent"; data: LaunchEvent }
  | { name: "OverflowEvent"; data: OverflowEvent };
