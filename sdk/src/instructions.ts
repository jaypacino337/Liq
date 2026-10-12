import { PublicKey, TransactionInstruction, type AccountMeta } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  DISCRIMINATORS,
  LIQ_PROGRAM_ID,
  MAX_NAME_LEN,
  MAX_SYMBOL_LEN,
  MAX_URI_LEN,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "./constants";
import { Writer, hexToBytes } from "./codec";
import { associatedTokenAddress, configPda, poolPda, programDataPda } from "./accounts";
import type { LaunchParams } from "./types";

const w = (k: PublicKey, isSigner = false): AccountMeta => ({ pubkey: k, isSigner, isWritable: true });
const r = (k: PublicKey, isSigner = false): AccountMeta => ({ pubkey: k, isSigner, isWritable: false });
const disc = (name: keyof typeof DISCRIMINATORS.instructions) => hexToBytes(DISCRIMINATORS.instructions[name]);

function ix(keys: AccountMeta[], data: Uint8Array, programId: PublicKey) {
  return new TransactionInstruction({ programId, keys, data: Buffer.from(data) });
}

export function initializeIx(args: {
  authority: PublicKey;
  feeRecipient: PublicKey;
  params: LaunchParams;
  programId?: PublicKey;
}) {
  const programId = args.programId ?? LIQ_PROGRAM_ID;
  return ix(
    [w(args.authority, true), w(configPda(programId)), r(programId), r(programDataPda(programId)), r(SYSTEM_PROGRAM_ID)],
    new Writer().raw(disc("initialize")).pubkey(args.feeRecipient).launchParams(args.params).toBytes(),
    programId,
  );
}

export function updateConfigIx(args: {
  authority: PublicKey;
  newAuthority?: PublicKey | null;
  feeRecipient?: PublicKey | null;
  params?: LaunchParams | null;
  paused?: boolean | null;
  programId?: PublicKey;
}) {
  const programId = args.programId ?? LIQ_PROGRAM_ID;
  return ix(
    [r(args.authority, true), w(configPda(programId))],
    new Writer()
      .raw(disc("updateConfig"))
      .option(args.newAuthority, (wr, v) => wr.pubkey(v))
      .option(args.feeRecipient, (wr, v) => wr.pubkey(v))
      .option(args.params, (wr, v) => wr.launchParams(v))
      .option(args.paused, (wr, v) => wr.bool(v))
      .toBytes(),
    programId,
  );
}

export function validateLaunchMetadata(name: string, symbol: string, uri: string): string | null {
  const len = (s: string) => new TextEncoder().encode(s).length;
  if (!name.trim() || len(name) > MAX_NAME_LEN) return `Name must be 1–${MAX_NAME_LEN} bytes`;
  if (!symbol.trim() || len(symbol) > MAX_SYMBOL_LEN) return `Symbol must be 1–${MAX_SYMBOL_LEN} bytes`;
  if (len(uri) > MAX_URI_LEN) return `Metadata URI must be at most ${MAX_URI_LEN} bytes`;
  return null;
}

/** The mint must be a fresh keypair that also signs the transaction. */
export function createLaunchIx(args: {
  creator: PublicKey;
  mint: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  programId?: PublicKey;
}) {
  const programId = args.programId ?? LIQ_PROGRAM_ID;
  const problem = validateLaunchMetadata(args.name, args.symbol, args.uri);
  if (problem) throw new Error(problem);
  const pool = poolPda(args.mint, programId);
  return ix(
    [
      w(args.creator, true),
      w(configPda(programId)),
      w(args.mint, true),
      w(pool),
      w(associatedTokenAddress(pool, args.mint)),
      r(TOKEN_2022_PROGRAM_ID),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      r(SYSTEM_PROGRAM_ID),
    ],
    new Writer().raw(disc("createLaunch")).string(args.name).string(args.symbol).string(args.uri).toBytes(),
    programId,
  );
}

function tradeKeys(trader: PublicKey, mint: PublicKey, feeRecipient: PublicKey, programId: PublicKey) {
  const pool = poolPda(mint, programId);
  return [
    w(trader, true),
    r(configPda(programId)),
    w(feeRecipient),
    w(pool),
    w(mint),
    w(associatedTokenAddress(pool, mint)),
    w(associatedTokenAddress(trader, mint)),
    r(TOKEN_2022_PROGRAM_ID),
    r(ASSOCIATED_TOKEN_PROGRAM_ID),
    r(SYSTEM_PROGRAM_ID),
  ];
}

export function buyIx(args: {
  trader: PublicKey;
  mint: PublicKey;
  feeRecipient: PublicKey;
  maxSolCost: bigint;
  minTokensOut: bigint;
  programId?: PublicKey;
}) {
  const programId = args.programId ?? LIQ_PROGRAM_ID;
  return ix(
    tradeKeys(args.trader, args.mint, args.feeRecipient, programId),
    new Writer().raw(disc("buy")).u64(args.maxSolCost).u64(args.minTokensOut).toBytes(),
    programId,
  );
}

export function sellIx(args: {
  trader: PublicKey;
  mint: PublicKey;
  feeRecipient: PublicKey;
  tokensIn: bigint;
  minSolOut: bigint;
  programId?: PublicKey;
}) {
  const programId = args.programId ?? LIQ_PROGRAM_ID;
  return ix(
    tradeKeys(args.trader, args.mint, args.feeRecipient, programId),
    new Writer().raw(disc("sell")).u64(args.tokensIn).u64(args.minSolOut).toBytes(),
    programId,
  );
}

export function claimCreatorFeesIx(args: { creator: PublicKey; mint: PublicKey; programId?: PublicKey }) {
  const programId = args.programId ?? LIQ_PROGRAM_ID;
  return ix([w(args.creator, true), w(poolPda(args.mint, programId))], disc("claimCreatorFees"), programId);
}
