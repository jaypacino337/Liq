import { PublicKey } from "@solana/web3.js";
import type { LaunchParams } from "./types";

export const LIQ_PROGRAM_ID = new PublicKey("2ZNPpmsqjdZtNU3hDMNPjYFFWMF6VuU7XtHsaM7feaGP");
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
export const BPF_UPGRADEABLE_LOADER_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

export const CONFIG_SEED = "config";
export const POOL_SEED = "pool";

export const TOKEN_DECIMALS = 6;
export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const TOKEN_UNIT = 10n ** BigInt(TOKEN_DECIMALS);
export const BPS_DENOMINATOR = 10_000n;

export const MAX_NAME_LEN = 32;
export const MAX_SYMBOL_LEN = 10;
export const MAX_URI_LEN = 200;

/** Default economics: 1B supply, ~85 SOL raised when the curve overflows. */
export const DEFAULT_LAUNCH_PARAMS: LaunchParams = {
  protocolFeeBps: 100,
  creatorFeeBps: 25,
  initialVirtualSol: 30n * LAMPORTS_PER_SOL,
  initialVirtualTokens: 1_073_000_000n * TOKEN_UNIT,
  curveSupply: 793_100_000n * TOKEN_UNIT,
  totalSupply: 1_000_000_000n * TOKEN_UNIT,
  calmPeriodSecs: 30n,
  calmMaxBuyLamports: 2n * LAMPORTS_PER_SOL,
  graduationFeeLamports: LAMPORTS_PER_SOL,
};

/** Anchor 8-byte discriminators (verified against the program in tests). */
export const DISCRIMINATORS = {
  accounts: {
    Config: "9b0caae01efacc82",
    Pool: "f19a6d0411b16dbc",
  },
  events: {
    TradeEvent: "bddb7fd34ee661ee",
    LaunchEvent: "1bc12f82735cef5e",
    OverflowEvent: "f630051ddcb92c66",
  },
  instructions: {
    initialize: "afaf6d1f0d989bed",
    updateConfig: "1d9efcbf0a53db63",
    createLaunch: "efdfff8627797f3e",
    buy: "66063d1201daebea",
    sell: "33e685a4017f83ad",
    claimCreatorFees: "00177dea9c768659",
  },
} as const;
