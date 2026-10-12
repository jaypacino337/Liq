import { Connection, Keypair, PublicKey, Transaction, type Commitment } from "@solana/web3.js";
import { LIQ_PROGRAM_ID } from "./constants";
import { CONFIG_DISCRIMINATOR, POOL_ACCOUNT_SIZE, POOL_DISCRIMINATOR, associatedTokenAddress, configPda, decodeConfig, decodePool, poolPda } from "./accounts";
import { bytesToHex } from "./codec";
import { buyIx, claimCreatorFeesIx, createLaunchIx, sellIx } from "./instructions";
import { buyCost, quoteBuy, quoteSell, sellPayout, withSlippage } from "./math";
import { parseEventsFromLogs } from "./events";
import type { ConfigAccount, LiqEvent, PoolAccount, TradeOutcome } from "./types";

// Minimal base58 for memcmp filters (avoids an extra dependency).
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = BigInt("0x" + (bytesToHex(bytes) || "0"));
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

export interface PoolWithKey {
  address: PublicKey;
  account: PoolAccount;
}

/**
 * High-level reads and transaction builders. Transactions are returned
 * unsigned (besides any fresh mint keypair) so any wallet adapter can sign.
 */
export class LiqClient {
  private configCache?: ConfigAccount;

  constructor(
    readonly connection: Connection,
    readonly programId: PublicKey = LIQ_PROGRAM_ID,
    readonly commitment: Commitment = "confirmed",
  ) {}

  async fetchConfig(force = false): Promise<ConfigAccount> {
    if (this.configCache && !force) return this.configCache;
    const info = await this.connection.getAccountInfo(configPda(this.programId), this.commitment);
    if (!info) throw new Error("Liq config not found — has the program been initialized on this cluster?");
    this.configCache = decodeConfig(info.data);
    return this.configCache;
  }

  async fetchPool(mint: PublicKey): Promise<PoolAccount | null> {
    const info = await this.connection.getAccountInfo(poolPda(mint, this.programId), this.commitment);
    return info ? decodePool(info.data) : null;
  }

  async fetchAllPools(): Promise<PoolWithKey[]> {
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      commitment: this.commitment,
      filters: [{ dataSize: POOL_ACCOUNT_SIZE }, { memcmp: { offset: 0, bytes: base58(POOL_DISCRIMINATOR) } }],
    });
    return accounts.map((a) => ({ address: a.pubkey, account: decodePool(a.account.data) }));
  }

  async isInitialized(): Promise<boolean> {
    const info = await this.connection.getAccountInfo(configPda(this.programId), this.commitment);
    return !!info && CONFIG_DISCRIMINATOR.every((b, i) => info.data[i] === b);
  }

  async tokenBalance(owner: PublicKey, mint: PublicKey): Promise<bigint> {
    try {
      const res = await this.connection.getTokenAccountBalance(associatedTokenAddress(owner, mint), this.commitment);
      return BigInt(res.value.amount);
    } catch {
      return 0n;
    }
  }

  private async finalize(tx: Transaction, feePayer: PublicKey) {
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash(this.commitment);
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = feePayer;
    return tx;
  }

  /**
   * Launch a token, optionally with an atomic first buy by the creator.
   * The returned transaction is already partially signed by the mint keypair.
   */
  async buildLaunch(args: {
    creator: PublicKey;
    name: string;
    symbol: string;
    uri: string;
    initialBuyLamports?: bigint;
    mint?: Keypair;
  }): Promise<{ tx: Transaction; mint: Keypair }> {
    const mint = args.mint ?? Keypair.generate();
    const tx = new Transaction().add(
      createLaunchIx({ creator: args.creator, mint: mint.publicKey, name: args.name, symbol: args.symbol, uri: args.uri, programId: this.programId }),
    );
    if (args.initialBuyLamports && args.initialBuyLamports > 0n) {
      const config = await this.fetchConfig();
      tx.add(
        buyIx({
          trader: args.creator,
          mint: mint.publicKey,
          feeRecipient: config.feeRecipient,
          maxSolCost: args.initialBuyLamports,
          minTokensOut: 0n,
          programId: this.programId,
        }),
      );
    }
    await this.finalize(tx, args.creator);
    tx.partialSign(mint);
    return { tx, mint };
  }

  async buildBuy(args: { trader: PublicKey; mint: PublicKey; lamports: bigint; slippageBps: number; pool?: PoolAccount }) {
    const [config, pool] = await Promise.all([this.fetchConfig(), args.pool ?? this.fetchPool(args.mint)]);
    if (!pool) throw new Error("Pool not found");
    const quote = quoteBuy(pool, args.lamports);
    const tx = new Transaction().add(
      buyIx({
        trader: args.trader,
        mint: args.mint,
        feeRecipient: config.feeRecipient,
        maxSolCost: args.lamports,
        minTokensOut: withSlippage(quote.tokens, args.slippageBps),
        programId: this.programId,
      }),
    );
    return { tx: await this.finalize(tx, args.trader), quote, cost: buyCost(quote) };
  }

  async buildSell(args: { trader: PublicKey; mint: PublicKey; tokens: bigint; slippageBps: number; pool?: PoolAccount }) {
    const [config, pool] = await Promise.all([this.fetchConfig(), args.pool ?? this.fetchPool(args.mint)]);
    if (!pool) throw new Error("Pool not found");
    const quote: TradeOutcome = quoteSell(pool, args.tokens);
    const payout = sellPayout(quote);
    const tx = new Transaction().add(
      sellIx({
        trader: args.trader,
        mint: args.mint,
        feeRecipient: config.feeRecipient,
        tokensIn: args.tokens,
        minSolOut: withSlippage(payout, args.slippageBps),
        programId: this.programId,
      }),
    );
    return { tx: await this.finalize(tx, args.trader), quote, payout };
  }

  async buildClaim(creator: PublicKey, mint: PublicKey) {
    const tx = new Transaction().add(claimCreatorFeesIx({ creator, mint, programId: this.programId }));
    return this.finalize(tx, creator);
  }

  /** Recent Liq events touching `address` (a pool PDA, or the program for everything). */
  async recentEvents(address: PublicKey = this.programId, limit = 25): Promise<LiqEvent[]> {
    const sigs = await this.connection.getSignaturesForAddress(address, { limit }, "confirmed");
    const txs = await this.connection.getTransactions(
      sigs.map((s) => s.signature),
      { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    );
    return txs.flatMap((t) => (t?.meta?.logMessages ? parseEventsFromLogs(t.meta.logMessages) : []));
  }

  /** Live event stream via websocket logs. Returns an unsubscribe function. */
  onEvents(cb: (ev: LiqEvent, signature: string) => void): () => void {
    const id = this.connection.onLogs(this.programId, (logs) => {
      if (logs.err) return;
      for (const ev of parseEventsFromLogs(logs.logs)) cb(ev, logs.signature);
    });
    return () => void this.connection.removeOnLogsListener(id);
  }
}
