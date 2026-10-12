"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Keypair, PublicKey, type Transaction } from "@solana/web3.js";
import {
  LiqClient,
  TOKEN_2022_PROGRAM_ID,
  decodeMintMetadata,
  poolPda,
  type LiqEvent,
  type OffchainMetadata,
  type PoolWithKey,
} from "@liq/sdk";
import { hueFor, lamportsToSol, tokensToUi } from "./format";
import type { FeedEvent, LaunchInput, Market, PricePoint, TokenView } from "./market";

interface Meta {
  name: string;
  symbol: string;
  uri: string;
  image?: string;
  description?: string;
}

const eventPrice = (ps: bigint, pt: bigint) => (pt === 0n ? 0 : Number(ps) / 1e9 / (Number(pt) / 1e6));

async function fetchOffchain(uri: string): Promise<OffchainMetadata> {
  if (!uri) return {};
  try {
    const res = await fetch(uri, { signal: AbortSignal.timeout(6000) });
    return (await res.json()) as OffchainMetadata;
  } catch {
    return {};
  }
}

export function useChainMarket(): Market {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const client = useMemo(() => new LiqClient(connection), [connection]);

  const [pools, setPools] = useState<PoolWithKey[]>([]);
  const [meta, setMeta] = useState<Record<string, Meta>>({});
  const [histories, setHistories] = useState<Record<string, PricePoint[]>>({});
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const [lamports, setLamports] = useState<bigint>();
  const [holdings, setHoldings] = useState<Record<string, bigint>>({});
  const metaRef = useRef(meta);
  metaRef.current = meta;

  const loadMeta = useCallback(
    async (mints: PublicKey[]) => {
      const missing = mints.filter((m) => !metaRef.current[m.toBase58()]);
      for (let i = 0; i < missing.length; i += 100) {
        const chunk = missing.slice(i, i + 100);
        const infos = await connection.getMultipleAccountsInfo(chunk);
        const entries = await Promise.all(
          chunk.map(async (mint, j) => {
            const onchain = infos[j] ? decodeMintMetadata(infos[j]!.data) : null;
            const off = await fetchOffchain(onchain?.uri ?? "");
            const m: Meta = {
              name: onchain?.name ?? "Unknown",
              symbol: onchain?.symbol ?? "???",
              uri: onchain?.uri ?? "",
              image: off.image,
              description: off.description,
            };
            return [mint.toBase58(), m] as const;
          }),
        );
        setMeta((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      }
    },
    [connection],
  );

  const toFeed = useCallback((ev: LiqEvent, sig: string): FeedEvent | null => {
    const sym = (mint: PublicKey) => metaRef.current[mint.toBase58()]?.symbol ?? "…";
    if (ev.name === "TradeEvent") {
      const d = ev.data;
      return {
        id: `${sig}-t`,
        kind: "trade",
        t: Number(d.timestamp) * 1000,
        mint: d.mint.toBase58(),
        symbol: sym(d.mint),
        trader: d.trader.toBase58(),
        isBuy: d.isBuy,
        sol: lamportsToSol(d.solAmount),
        tokens: tokensToUi(d.tokenAmount),
      };
    }
    if (ev.name === "LaunchEvent") {
      const d = ev.data;
      return { id: `${sig}-l`, kind: "launch", t: Number(d.timestamp) * 1000, mint: d.mint.toBase58(), symbol: d.symbol, trader: d.creator.toBase58() };
    }
    const d = ev.data;
    return { id: `${sig}-o`, kind: "overflow", t: Number(d.timestamp) * 1000, mint: d.mint.toBase58(), symbol: sym(d.mint), sol: lamportsToSol(d.solSeeded) };
  }, []);

  const refresh = useCallback(async () => {
    try {
      if (!(await client.isInitialized())) {
        setError("Liq isn't initialized on this cluster yet. Deploy the program (see README) or switch to the sandbox.");
        setReady(true);
        return;
      }
      const all = await client.fetchAllPools();
      all.sort((a, b) => Number(b.account.launchedAt - a.account.launchedAt));
      setPools(all);
      setError(undefined);
      setReady(true);
      void loadMeta(all.map((p) => p.account.mint));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setReady(true);
    }
  }, [client, loadMeta]);

  const refreshWallet = useCallback(async () => {
    if (!wallet.publicKey) {
      setLamports(undefined);
      setHoldings({});
      return;
    }
    const [bal, accts] = await Promise.all([
      connection.getBalance(wallet.publicKey),
      connection.getParsedTokenAccountsByOwner(wallet.publicKey, { programId: TOKEN_2022_PROGRAM_ID }),
    ]);
    setLamports(BigInt(bal));
    const h: Record<string, bigint> = {};
    for (const a of accts.value) {
      const info = a.account.data.parsed?.info;
      if (info?.mint) h[info.mint] = BigInt(info.tokenAmount.amount);
    }
    setHoldings(h);
  }, [connection, wallet.publicKey]);

  // Initial load + polling.
  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    void refreshWallet();
  }, [refreshWallet]);

  // Recent history for the global tide, then live events over websocket.
  useEffect(() => {
    let alive = true;
    client
      .recentEvents(client.programId, 30)
      .then((evs) => {
        if (!alive) return;
        setFeed(evs.map((e, i) => toFeed(e, `init-${i}`)).filter((x): x is FeedEvent => !!x).sort((a, b) => b.t - a.t));
      })
      .catch(() => {});
    const off = client.onEvents((ev, sig) => {
      const f = toFeed(ev, sig);
      if (f) setFeed((prev) => [f, ...prev.filter((p) => p.id !== f.id)].slice(0, 60));
      if (ev.name === "TradeEvent") {
        const d = ev.data;
        const key = d.mint.toBase58();
        setHistories((prev) =>
          prev[key]
            ? { ...prev, [key]: [...prev[key]!, { t: Number(d.timestamp) * 1000, price: eventPrice(d.priceSolReserves, d.priceTokenReserves), isBuy: d.isBuy, sol: lamportsToSol(d.solAmount), trader: d.trader.toBase58() }] }
            : prev,
        );
        client.fetchPool(d.mint).then((acc) => {
          if (acc) setPools((prev) => prev.map((p) => (p.account.mint.equals(d.mint) ? { ...p, account: acc } : p)));
        });
      } else {
        void refresh();
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, [client, toFeed, refresh]);

  const watch = useCallback(
    (mint: string) => {
      if (histories[mint]) return;
      setHistories((prev) => ({ ...prev, [mint]: [] }));
      client
        .recentEvents(poolPda(new PublicKey(mint)), 200)
        .then((evs) => {
          const pts: PricePoint[] = [];
          for (const e of evs) {
            if (e.name !== "TradeEvent") continue;
            const d = e.data;
            pts.push({ t: Number(d.timestamp) * 1000, price: eventPrice(d.priceSolReserves, d.priceTokenReserves), isBuy: d.isBuy, sol: lamportsToSol(d.solAmount), trader: d.trader.toBase58() });
          }
          pts.sort((a, b) => a.t - b.t);
          setHistories((prev) => ({ ...prev, [mint]: pts }));
        })
        .catch(() => {});
    },
    [client, histories],
  );

  const send = useCallback(
    async (tx: Transaction) => {
      if (!wallet.publicKey) {
        setVisible(true);
        throw new Error("Connect a wallet first.");
      }
      let sig: string;
      if (wallet.signTransaction) {
        const signed = await wallet.signTransaction(tx);
        sig = await connection.sendRawTransaction(signed.serialize());
      } else {
        sig = await wallet.sendTransaction(tx, connection);
      }
      await connection.confirmTransaction(
        { signature: sig, blockhash: tx.recentBlockhash!, lastValidBlockHeight: tx.lastValidBlockHeight! },
        "confirmed",
      );
      void refreshWallet();
      return sig;
    },
    [wallet, connection, setVisible, refreshWallet],
  );

  const requireWallet = useCallback(() => {
    if (!wallet.publicKey) {
      setVisible(true);
      throw new Error("Connect a wallet first.");
    }
    return wallet.publicKey;
  }, [wallet.publicKey, setVisible]);

  const launch = useCallback(
    async (input: LaunchInput) => {
      const creator = requireWallet();
      const { tx, mint } = await client.buildLaunch({
        creator,
        name: input.name,
        symbol: input.symbol,
        uri: input.uri,
        initialBuyLamports: input.devBuyLamports,
        mint: input.mintSecret ? Keypair.fromSecretKey(input.mintSecret) : undefined,
      });
      await send(tx);
      await refresh();
      return mint.publicKey.toBase58();
    },
    [client, requireWallet, send, refresh],
  );

  const poolFor = useCallback((mint: string) => pools.find((p) => p.account.mint.toBase58() === mint)?.account, [pools]);

  const buy = useCallback(
    async (mint: string, lamportsIn: bigint, slippageBps: number) => {
      const trader = requireWallet();
      const { tx } = await client.buildBuy({ trader, mint: new PublicKey(mint), lamports: lamportsIn, slippageBps, pool: poolFor(mint) });
      return send(tx);
    },
    [client, requireWallet, send, poolFor],
  );

  const sell = useCallback(
    async (mint: string, tokens: bigint, slippageBps: number) => {
      const trader = requireWallet();
      const { tx } = await client.buildSell({ trader, mint: new PublicKey(mint), tokens, slippageBps, pool: poolFor(mint) });
      return send(tx);
    },
    [client, requireWallet, send, poolFor],
  );

  const claim = useCallback(
    async (mint: string) => {
      const creator = requireWallet();
      return send(await client.buildClaim(creator, new PublicKey(mint)));
    },
    [client, requireWallet, send],
  );

  const tokens: TokenView[] = useMemo(
    () =>
      pools.map(({ account }) => {
        const key = account.mint.toBase58();
        const m = meta[key];
        return {
          mint: key,
          pool: account,
          name: m?.name ?? "Loading…",
          symbol: m?.symbol ?? "…",
          uri: m?.uri ?? "",
          image: m?.image,
          description: m?.description,
          hue: hueFor(key),
          history: histories[key] ?? [],
        };
      }),
    [pools, meta, histories],
  );

  return {
    mode: "chain",
    ready,
    error,
    tokens,
    feed,
    wallet: { connected: !!wallet.publicKey, address: wallet.publicKey?.toBase58(), lamports },
    holdings,
    now: Math.floor(Date.now() / 1000),
    launch,
    buy,
    sell,
    claim,
    watch,
    connect: () => setVisible(true),
  };
}
