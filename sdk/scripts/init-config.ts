/**
 * One-time: create the Liq config right after deploying the program.
 * Must be signed by the program's upgrade authority.
 *
 *   RPC_URL=https://api.devnet.solana.com FEE_RECIPIENT=<pubkey> \
 *     pnpm --filter @liq/sdk init-config [path/to/authority.json]
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { DEFAULT_LAUNCH_PARAMS, LiqClient, initializeIx } from "../src";

const rpc = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const keyPath = process.argv[2] ?? `${homedir()}/.config/solana/id.json`;
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))));
const feeRecipient = new PublicKey(process.env.FEE_RECIPIENT ?? authority.publicKey);

const connection = new Connection(rpc, "confirmed");
const client = new LiqClient(connection);
if (await client.isInitialized()) {
  console.log("Already initialized:", await client.fetchConfig());
  process.exit(0);
}
const tx = new Transaction().add(initializeIx({ authority: authority.publicKey, feeRecipient, params: DEFAULT_LAUNCH_PARAMS }));
const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
console.log(`Initialized Liq on ${rpc}\n  authority     ${authority.publicKey.toBase58()}\n  fee recipient ${feeRecipient.toBase58()}\n  tx            ${sig}`);
