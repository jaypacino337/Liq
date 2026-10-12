import { PublicKey } from "@solana/web3.js";
import { DISCRIMINATORS, LIQ_PROGRAM_ID, POOL_SEED, CONFIG_SEED, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "./constants";
import { Reader, hexToBytes, startsWith } from "./codec";
import type { ConfigAccount, PoolAccount } from "./types";

export const POOL_DISCRIMINATOR = hexToBytes(DISCRIMINATORS.accounts.Pool);
export const CONFIG_DISCRIMINATOR = hexToBytes(DISCRIMINATORS.accounts.Config);
/** Serialized Pool size in bytes, discriminator included. */
export const POOL_ACCOUNT_SIZE = 230;

export function configPda(programId = LIQ_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([new TextEncoder().encode(CONFIG_SEED)], programId)[0];
}

export function poolPda(mint: PublicKey, programId = LIQ_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([new TextEncoder().encode(POOL_SEED), mint.toBytes()], programId)[0];
}

/** Token-2022 associated token account. */
export function associatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), TOKEN_2022_PROGRAM_ID.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

export function programDataPda(programId = LIQ_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync(
    [programId.toBytes()],
    new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
  )[0];
}

export function decodePool(data: Uint8Array): PoolAccount {
  if (!startsWith(data, POOL_DISCRIMINATOR)) throw new Error("Not a Liq Pool account");
  const r = new Reader(data).skip(8);
  return {
    mint: r.pubkey(),
    creator: r.pubkey(),
    phase: r.u8() === 0 ? "curve" : "pool",
    params: r.launchParams(),
    virtualSol: r.u64(),
    virtualTokens: r.u64(),
    realSol: r.u64(),
    realTokens: r.u64(),
    reserveTokens: r.u64(),
    creatorFeesUnclaimed: r.u64(),
    creatorFeesTotal: r.u64(),
    volumeLamports: r.u64(),
    tradeCount: r.u64(),
    launchIndex: r.u64(),
    launchedAt: r.i64(),
    graduatedAt: r.i64(),
    bump: r.u8(),
  };
}

export function decodeConfig(data: Uint8Array): ConfigAccount {
  if (!startsWith(data, CONFIG_DISCRIMINATOR)) throw new Error("Not a Liq Config account");
  const r = new Reader(data).skip(8);
  return {
    authority: r.pubkey(),
    feeRecipient: r.pubkey(),
    params: r.launchParams(),
    paused: r.bool(),
    launchCount: r.u64(),
    bump: r.u8(),
  };
}
