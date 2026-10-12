"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const VANITY_SUFFIX = "Liq";
// Expected tries for a 3-char base58 suffix: 58^3.
export const VANITY_EXPECTED = 58 ** 3;

/** Multi-worker vanity mint grinder. */
export function useVanity() {
  const workers = useRef<Worker[]>([]);
  const [tries, setTries] = useState(0);
  const [result, setResult] = useState<{ secret: Uint8Array; address: string } | null>(null);
  const [running, setRunning] = useState(false);
  const started = useRef(0);

  const stop = useCallback(() => {
    workers.current.forEach((w) => w.terminate());
    workers.current = [];
    setRunning(false);
  }, []);

  const start = useCallback(() => {
    stop();
    setResult(null);
    setTries(0);
    setRunning(true);
    started.current = performance.now();
    const n = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL("./vanity.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e) => {
        if (e.data.type === "progress") setTries((t) => t + e.data.tries);
        if (e.data.type === "found") {
          setResult({ secret: e.data.secret, address: e.data.address });
          stop();
        }
      };
      w.postMessage({ suffix: VANITY_SUFFIX });
      workers.current.push(w);
    }
  }, [stop]);

  useEffect(() => stop, [stop]);

  const elapsed = running ? (performance.now() - started.current) / 1000 : 0;
  const rate = elapsed > 0.5 ? tries / elapsed : 0;
  return { start, stop, running, tries, rate, result, clear: () => setResult(null) };
}
