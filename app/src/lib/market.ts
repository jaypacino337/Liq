import type { PoolAccount } from "@liq/sdk";

export type Mode = "sandbox" | "chain";

export interface PricePoint {
  /** ms since epoch */
  t: number;
  /** SOL per whole token */
  price: number;
  isBuy: boolean;
  sol: number;
  trader?: string;
}

export interface TokenView {
  mint: string;
  pool: PoolAccount;
  name: string;
  symbol: string;
  uri: string;
  image?: string;
  description?: string;
  hue: number;
  history: PricePoint[];
}

export type FeedEvent =
  | { id: string; kind: "trade"; t: number; mint: string; symbol: string; trader: string; isBuy: boolean; sol: number; tokens: number }
  | { id: string; kind: "launch"; t: number; mint: string; symbol: string; trader: string }
  | { id: string; kind: "overflow"; t: number; mint: string; symbol: string; sol: number };

export interface LaunchInput {
  name: string;
  symbol: string;
  uri: string;
  image?: string;
  description?: string;
  devBuyLamports: bigint;
  /** Optional pre-ground vanity mint secret key. */
  mintSecret?: Uint8Array;
}

export interface MarketSnapshot {
  mode: Mode;
  ready: boolean;
  error?: string;
  tokens: TokenView[];
  feed: FeedEvent[];
  wallet: { connected: boolean; address?: string; lamports?: bigint };
  holdings: Record<string, bigint>;
  /** seconds — chain clock in chain mode, wall clock in sandbox */
  now: number;
}

export interface MarketActions {
  launch(input: LaunchInput): Promise<string>;
  buy(mint: string, lamports: bigint, slippageBps: number): Promise<string>;
  sell(mint: string, tokens: bigint, slippageBps: number): Promise<string>;
  claim(mint: string): Promise<string>;
  /** Load full history for one token (chain mode fetches events lazily). */
  watch(mint: string): void;
  /** Sandbox only: top the fake wallet back up. */
  refill?(): void;
  connect?(): void;
}

export type Market = MarketSnapshot & MarketActions;
