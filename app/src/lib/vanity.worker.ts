/// <reference lib="webworker" />
// Grinds keypairs until the base58 address ends with the requested suffix.
import { Keypair } from "@solana/web3.js";

self.onmessage = (e: MessageEvent<{ suffix: string }>) => {
  const { suffix } = e.data;
  let tries = 0;
  for (;;) {
    const kp = Keypair.generate();
    tries++;
    if (kp.publicKey.toBase58().endsWith(suffix)) {
      self.postMessage({ type: "found", secret: kp.secretKey, address: kp.publicKey.toBase58(), tries });
      return;
    }
    if (tries % 1000 === 0) self.postMessage({ type: "progress", tries: 1000 });
  }
};
