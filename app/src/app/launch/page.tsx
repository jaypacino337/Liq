"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LAUNCH_PARAMS, MAX_URI_LEN, applyBuy, buyCost, quoteBuy, validateLaunchMetadata, type PoolAccount } from "@liq/sdk";
import { PublicKey } from "@solana/web3.js";
import { useMarket } from "@/components/Providers";
import { Vessel } from "@/components/Vessel";
import { TokenOrb } from "@/components/TokenOrb";
import { CurveChart } from "@/components/Charts";
import { fmtCompact, fmtSol, friendlyError, hueFor, lamportsToSol, solToLamports, tokensToUi } from "@/lib/format";
import { packedUri } from "@/lib/metadata";
import { VANITY_EXPECTED, VANITY_SUFFIX, useVanity } from "@/lib/useVanity";

function previewPool(): PoolAccount {
  const p = DEFAULT_LAUNCH_PARAMS;
  return {
    mint: PublicKey.default,
    creator: PublicKey.default,
    phase: "curve",
    params: p,
    virtualSol: p.initialVirtualSol,
    virtualTokens: p.initialVirtualTokens,
    realSol: 0n,
    realTokens: p.curveSupply,
    reserveTokens: p.totalSupply - p.curveSupply,
    creatorFeesUnclaimed: 0n,
    creatorFeesTotal: 0n,
    volumeLamports: 0n,
    tradeCount: 0n,
    launchIndex: 0n,
    launchedAt: 0n,
    graduatedAt: 0n,
    bump: 0,
  };
}

export default function LaunchPage() {
  const market = useMarket();
  const router = useRouter();
  const vanity = useVanity();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [image, setImage] = useState("");
  const [description, setDescription] = useState("");
  const [customUri, setCustomUri] = useState("");
  const [devBuy, setDevBuy] = useState(0.5);
  const [useVanityMint, setUseVanityMint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [origin, setOrigin] = useState("https://liq.app");
  useEffect(() => setOrigin(window.location.origin), []);

  const hue = useMemo(() => hueFor(vanity.result?.address ?? (name + symbol || "liq")), [name, symbol, vanity.result]);
  const packed = useMemo(() => packedUri(origin, { n: name, s: symbol, i: image || undefined, d: description || undefined }), [origin, name, symbol, image, description]);
  const uri = customUri.trim() || packed.uri;
  const uriBytes = new TextEncoder().encode(uri).length;
  const metaProblem = validateLaunchMetadata(name, symbol, uri);

  const calmCap = lamportsToSol(DEFAULT_LAUNCH_PARAMS.calmMaxBuyLamports);
  const dev = useMemo(() => {
    if (devBuy <= 0) return null;
    const pool = previewPool();
    const o = quoteBuy(pool, solToLamports(devBuy));
    const after = applyBuy(pool, o);
    const pct = Number(o.tokens) / Number(DEFAULT_LAUNCH_PARAMS.totalSupply);
    return { o, after, pct };
  }, [devBuy]);

  async function launch() {
    setBusy(true);
    setErr(undefined);
    try {
      if (metaProblem) throw new Error(metaProblem);
      if (!customUri && !packed.fits) throw new Error(`Metadata is too long to pack into ${MAX_URI_LEN} bytes. Shorten the description or image URL, or host your own JSON.`);
      const mint = await market.launch({
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        uri,
        image: image || undefined,
        description: description || undefined,
        devBuyLamports: solToLamports(devBuy),
        mintSecret: useVanityMint ? vanity.result?.secret : undefined,
      });
      router.push(`/t/${mint}`);
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const waitingVanity = useVanityMint && !vanity.result;

  return (
    <div className="launch-layout" style={{ "--hue": hue } as CSSProperties}>
      <div>
        <h1>
          Launch a <span className="grad-text">drop</span>
        </h1>
        <p className="muted" style={{ marginTop: 0, lineHeight: 1.6, maxWidth: 560 }}>
          Fixed 1B supply. Mint authority renounced in the same transaction. No freeze authority. When the curve fills, it overflows into a
          permanent pool that nobody can drain. You earn {DEFAULT_LAUNCH_PARAMS.creatorFeeBps / 100}% of every trade, forever.
        </p>

        <div className="panel form-grid" style={{ marginTop: 20 }}>
          <div className="two">
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" className="input" maxLength={32} placeholder="Mercury Cat" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="symbol">Ticker</label>
              <input
                id="symbol"
                className="input mono"
                maxLength={10}
                placeholder="MERC"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/\s/g, ""))}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="image">Image URL</label>
            <input id="image" className="input" placeholder="https://… (png, jpg, gif)" value={image} onChange={(e) => setImage(e.target.value.trim())} />
          </div>
          <div className="field">
            <label htmlFor="desc">Description</label>
            <textarea id="desc" className="input" maxLength={140} placeholder="What's in the vessel?" value={description} onChange={(e) => setDescription(e.target.value)} />
            <span className="hint">
              Metadata is packed into the token URI itself, so there&apos;s nothing to host.{" "}
              <span className="mono" style={{ color: packed.fits ? "var(--faint)" : "var(--drain)" }}>
                {packed.bytes}/{MAX_URI_LEN} bytes
              </span>
            </span>
          </div>
          <details>
            <summary className="hint" style={{ cursor: "pointer" }}>
              Advanced: use your own metadata URI (IPFS / Arweave)
            </summary>
            <input className="input" style={{ marginTop: 10 }} placeholder="https://arweave.net/…" value={customUri} onChange={(e) => setCustomUri(e.target.value.trim())} />
            {customUri && (
              <span className="hint mono" style={{ color: uriBytes > MAX_URI_LEN ? "var(--drain)" : undefined }}>
                {uriBytes}/{MAX_URI_LEN} bytes
              </span>
            )}
          </details>

          <div className="field">
            <label htmlFor="dev">
              First pour (optional) · <span className="mono">{fmtSol(devBuy)} SOL</span>
            </label>
            <input id="dev" className="range" type="range" min={0} max={calmCap * 0.98} step={0.05} value={devBuy} onChange={(e) => setDevBuy(Number(e.target.value))} />
            <span className="hint">
              Buy in the same transaction as the launch, so no bot gets in first. Capped by calm waters at {fmtSol(calmCap)} SOL.
              {dev && (
                <>
                  {" "}
                  You&apos;d receive <b className="mono">{fmtCompact(tokensToUi(dev.o.tokens))}</b> tokens ({(dev.pct * 100).toFixed(2)}% of supply).
                </>
              )}
            </span>
          </div>

          <label className="toggle">
            <input
              type="checkbox"
              checked={useVanityMint}
              onChange={(e) => {
                setUseVanityMint(e.target.checked);
                if (e.target.checked && !vanity.result && !vanity.running) vanity.start();
                if (!e.target.checked) vanity.stop();
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>
                Vanity mint ending in <span className="mono grad-text">…{VANITY_SUFFIX}</span>
              </div>
              <div className="hint">
                {vanity.result ? (
                  <span className="mono" style={{ color: "var(--liq)" }}>
                    Found {vanity.result.address.slice(0, 6)}…{vanity.result.address.slice(-6)}
                  </span>
                ) : vanity.running ? (
                  <span className="mono">
                    Grinding in your browser: {fmtCompact(vanity.tries)} tries · {fmtCompact(vanity.rate)}/s · ~
                    {vanity.rate ? Math.max(1, Math.round((VANITY_EXPECTED - vanity.tries) / vanity.rate)) : "…"}s
                  </span>
                ) : (
                  "Ground locally with web workers. The key never leaves your browser."
                )}
              </div>
            </div>
          </label>

          {err && <div className="notice notice-err">{err}</div>}

          <button className="btn btn-primary btn-block" style={{ padding: 16, fontSize: 16 }} disabled={busy || !!metaProblem || waitingVanity} onClick={launch}>
            {busy
              ? "Launching…"
              : waitingVanity
                ? "Grinding vanity mint…"
                : !market.wallet.connected
                  ? "Connect wallet to launch"
                  : `Launch${devBuy > 0 && dev ? ` + pour ${fmtSol(lamportsToSol(buyCost(dev.o)), 3)} SOL` : ""}`}
          </button>
          <span className="hint" style={{ textAlign: "center" }}>
            Network rent for the mint, pool and vault is ~0.02 SOL. {market.mode === "sandbox" && "Sandbox launches use simulated SOL."}
          </span>
        </div>
      </div>

      <div className="preview-card">
        <div className="panel" style={{ display: "grid", justifyItems: "center", gap: 14, textAlign: "center" }}>
          <span className="stat-label">Preview</span>
          <Vessel fill={dev ? Number(DEFAULT_LAUNCH_PARAMS.curveSupply - dev.after.realTokens) / Number(DEFAULT_LAUNCH_PARAMS.curveSupply) : 0} hue={hue} size={150} />
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <TokenOrb hue={hue} image={image || undefined} symbol={symbol || "?"} size={36} />
            <div style={{ textAlign: "left" }}>
              <div style={{ fontWeight: 700 }}>{name || "Your token"}</div>
              <div className="ticker" style={{ color: `hsl(${hue} 90% 72%)` }}>
                ${symbol || "TICKER"}
              </div>
            </div>
          </div>
          {description && <p className="muted" style={{ margin: 0, fontSize: 13 }}>{description}</p>}
        </div>
        <div className="panel" style={{ marginTop: 16 }}>
          <h3 className="panel-title">The curve</h3>
          <CurveChart devBuySol={dev ? lamportsToSol(dev.o.sol) : 0} hue={hue} />
          <p className="hint" style={{ marginBottom: 0 }}>
            Price follows a constant-product curve on 30 SOL of virtual liquidity. When ~{fmtCompact(tokensToUi(DEFAULT_LAUNCH_PARAMS.curveSupply))} tokens are
            sold, the vessel overflows into a permanent pool at the exact same price.
          </p>
        </div>
      </div>
    </div>
  );
}
