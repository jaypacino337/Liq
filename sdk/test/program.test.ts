/**
 * Runs SDK-built transactions against the compiled program in LiteSVM, so the
 * hand-written account lists and encoders are verified end to end.
 * Skipped when target/deploy/liq.so has not been built.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { LiteSVM, Clock, FailedTransactionMetadata } from "litesvm";
import { address, getTransactionDecoder, lamports, type EncodedAccount } from "@solana/kit";
import {

  DEFAULT_LAUNCH_PARAMS,
  LIQ_PROGRAM_ID,
  associatedTokenAddress,
  buyIx,
  claimCreatorFeesIx,
  configPda,
  createLaunchIx,
  decodeConfig,
  decodeMintMetadata,
  decodePool,
  initializeIx,
  parseEventsFromLogs,
  poolPda,
  programDataPda,
  quoteBuy,
  quoteSell,
  sellIx,
  sellPayout,
  updateConfigIx,
} from "../src";

const SO = fileURLToPath(new URL("../../target/deploy/liq.so", import.meta.url));
const SOL = BigInt(LAMPORTS_PER_SOL);

// Thin adapter: build and sign with web3.js (as the app does), execute in LiteSVM's kit API.
const addr = (k: PublicKey) => address(k.toBase58());
const txDecoder = getTransactionDecoder();

function setup() {
  const svm = new LiteSVM();
  svm.addProgram(addr(LIQ_PROGRAM_ID), readFileSync(SO));
  const admin = Keypair.generate();
  const feeRecipient = Keypair.generate().publicKey;
  const airdrop = (k: PublicKey, amount: bigint) => svm.airdrop(addr(k), lamports(amount));
  airdrop(admin.publicKey, 10n * SOL);
  airdrop(feeRecipient, SOL);

  const getAccount = (k: PublicKey) => {
    const a = svm.getAccount(addr(k));
    return a.exists ? a : null;
  };
  const balance = (k: PublicKey) => BigInt(svm.getBalance(addr(k)) ?? 0n);

  // Give the deployment an upgrade authority so `initialize` can pass its gate.
  const pd = getAccount(programDataPda())!;
  const data = Uint8Array.from(pd.data);
  data[12] = 1;
  data.set(admin.publicKey.toBytes(), 13);
  svm.setAccount({ ...(pd as EncodedAccount), data });

  const send = (ixs: TransactionInstruction[], signers: Keypair[]) => {
    svm.expireBlockhash();
    const tx = new Transaction().add(...ixs);
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = signers[0]!.publicKey;
    tx.sign(...signers);
    const res = svm.sendTransaction(txDecoder.decode(tx.serialize()));
    if (res instanceof FailedTransactionMetadata) {
      throw new Error(`${res.toString()}\n${res.meta().logs().join("\n")}`);
    }
    return res.logs();
  };
  const user = (sol: bigint) => {
    const k = Keypair.generate();
    airdrop(k.publicKey, sol * SOL);
    return k;
  };
  const pool = (mint: PublicKey) => decodePool(getAccount(poolPda(mint))!.data);
  const warp = (secs: bigint) => {
    const c = svm.getClock();
    svm.setClock(new Clock(c.slot, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, c.unixTimestamp + secs));
  };

  send([initializeIx({ authority: admin.publicKey, feeRecipient, params: DEFAULT_LAUNCH_PARAMS })], [admin]);
  return { svm, admin, feeRecipient, send, user, pool, warp, getAccount, balance };
}

describe.skipIf(!existsSync(SO))("SDK against the compiled program", () => {
  it("initializes config with the SDK encoder", () => {
    const { admin, feeRecipient, getAccount } = setup();
    const cfg = decodeConfig(getAccount(configPda())!.data);
    expect(cfg.authority.equals(admin.publicKey)).toBe(true);
    expect(cfg.feeRecipient.equals(feeRecipient)).toBe(true);
    expect(cfg.params).toEqual(DEFAULT_LAUNCH_PARAMS);
  });

  it("launches, trades, overflows and claims using only SDK builders", () => {
    const env = setup();
    const creator = env.user(10n);
    const mint = Keypair.generate();

    // Launch with an atomic dev buy, exactly as the app does it.
    const logs = env.send(
      [
        createLaunchIx({ creator: creator.publicKey, mint: mint.publicKey, name: "Tidal", symbol: "TIDE", uri: "https://x.y/t.json" }),
        buyIx({ trader: creator.publicKey, mint: mint.publicKey, feeRecipient: env.feeRecipient, maxSolCost: SOL, minTokensOut: 0n }),
      ],
      [creator, mint],
    );
    const events = parseEventsFromLogs(logs);
    expect(events.map((e) => e.name)).toEqual(["LaunchEvent", "TradeEvent"]);

    let p = env.pool(mint.publicKey);
    expect(p.creator.equals(creator.publicKey)).toBe(true);
    const meta = decodeMintMetadata(env.getAccount(mint.publicKey)!.data);
    expect(meta).toEqual({ name: "Tidal", symbol: "TIDE", uri: "https://x.y/t.json", supply: DEFAULT_LAUNCH_PARAMS.totalSupply, decimals: 6 });
    expect(p.tradeCount).toBe(1n);

    // Sell half with an exact slippage bound from the SDK quote.
    const held = env.getAccount(associatedTokenAddress(creator.publicKey, mint.publicKey));
    expect(held).toBeTruthy();
    const half = (DEFAULT_LAUNCH_PARAMS.totalSupply - p.realTokens - p.reserveTokens) / 2n;
    const sq = quoteSell(p, half);
    env.send(
      [sellIx({ trader: creator.publicKey, mint: mint.publicKey, feeRecipient: env.feeRecipient, tokensIn: half, minSolOut: sellPayout(sq) })],
      [creator],
    );

    // Whale overflows the curve after calm waters end.
    env.warp(60n);
    const whale = env.user(200n);
    p = env.pool(mint.publicKey);
    const q = quoteBuy(p, 150n * SOL);
    expect(q.overflows).toBe(true);
    const wl = env.send(
      [buyIx({ trader: whale.publicKey, mint: mint.publicKey, feeRecipient: env.feeRecipient, maxSolCost: 150n * SOL, minTokensOut: q.tokens })],
      [whale],
    );
    expect(parseEventsFromLogs(wl).map((e) => e.name)).toEqual(["TradeEvent", "OverflowEvent"]);
    p = env.pool(mint.publicKey);
    expect(p.phase).toBe("pool");

    // Creator collects the accrued fees.
    const owed = p.creatorFeesUnclaimed;
    const before = env.balance(creator.publicKey);
    env.send([claimCreatorFeesIx({ creator: creator.publicKey, mint: mint.publicKey })], [creator]);
    expect(env.balance(creator.publicKey) - before).toBe(owed - 5000n);
  });

  it("pauses via updateConfig", () => {
    const env = setup();
    env.send([updateConfigIx({ authority: env.admin.publicKey, paused: true })], [env.admin]);
    const creator = env.user(5n);
    const mint = Keypair.generate();
    expect(() =>
      env.send(
        [createLaunchIx({ creator: creator.publicKey, mint: mint.publicKey, name: "N", symbol: "S", uri: "" })],
        [creator, mint],
      ),
    ).toThrow(/Paused|6001/);
  });
});

