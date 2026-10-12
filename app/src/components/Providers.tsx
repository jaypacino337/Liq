"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import { useChainMarket } from "@/lib/chain";
import { SandboxEngine } from "@/lib/sandbox";
import type { Market, MarketSnapshot, Mode } from "@/lib/market";

const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";
const DEFAULT_MODE: Mode = process.env.NEXT_PUBLIC_LIQ_MODE === "chain" ? "chain" : "sandbox";
const MODE_KEY = "liq.mode";

const MarketContext = createContext<Market | null>(null);
const ModeContext = createContext<{ mode: Mode; setMode: (m: Mode) => void; resetSandbox: () => void }>({
  mode: DEFAULT_MODE,
  setMode: () => {},
  resetSandbox: () => {},
});

export const useMarket = () => {
  const m = useContext(MarketContext);
  if (!m) throw new Error("useMarket outside provider");
  return m;
};
export const useMode = () => useContext(ModeContext);

const EMPTY: MarketSnapshot = { mode: "sandbox", ready: false, tokens: [], feed: [], wallet: { connected: false }, holdings: {}, now: 0 };
const noop = () => () => {};

let engine: SandboxEngine | undefined;
const getEngine = () => (engine ??= new SandboxEngine());

function SandboxMarket({ children }: { children: ReactNode }) {
  const [e, setE] = useState<SandboxEngine>();
  useEffect(() => setE(getEngine()), []);
  const snap = useSyncExternalStore(e?.subscribe ?? noop, e?.getSnapshot ?? (() => EMPTY), () => EMPTY);
  const value = useMemo<Market>(
    () => ({
      ...snap,
      launch: (i) => getEngine().launch(i),
      buy: (m, l, s) => getEngine().buy(m, l, s),
      sell: (m, t, s) => getEngine().sell(m, t, s),
      claim: (m) => getEngine().claim(m),
      watch: () => {},
      refill: () => getEngine().refill(),
    }),
    [snap],
  );
  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

function ChainMarket({ children }: { children: ReactNode }) {
  const market = useChainMarket();
  return <MarketContext.Provider value={market}>{children}</MarketContext.Provider>;
}

export function Providers({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>(DEFAULT_MODE);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODE_KEY);
      if (saved === "sandbox" || saved === "chain") setModeState(saved);
    } catch {}
  }, []);
  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {}
  }, []);
  const resetSandbox = useCallback(() => getEngine().reset(), []);

  return (
    <ConnectionProvider endpoint={RPC}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>
          <ModeContext.Provider value={{ mode, setMode, resetSandbox }}>
            {mode === "sandbox" ? <SandboxMarket>{children}</SandboxMarket> : <ChainMarket>{children}</ChainMarket>}
          </ModeContext.Provider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
