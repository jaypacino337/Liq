"use client";

import { useState } from "react";

/** Token avatar: the creator's image, or a generative liquid orb from the mint hue. */
export function TokenOrb({ hue, image, symbol, size = 36 }: { hue: number; image?: string; symbol: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = {
    width: size,
    height: size,
    borderRadius: "50%",
    flex: "none",
    border: `1px solid hsla(${hue}, 90%, 70%, 0.45)`,
    boxShadow: `0 0 18px -4px hsla(${hue}, 90%, 60%, 0.6)`,
  } as const;
  if (image && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt={symbol} style={{ ...style, objectFit: "cover" }} onError={() => setBroken(true)} />;
  }
  return (
    <div
      aria-hidden
      style={{
        ...style,
        display: "grid",
        placeItems: "center",
        fontFamily: "var(--display)",
        fontWeight: 800,
        fontSize: size * 0.36,
        color: "rgba(0,0,0,0.65)",
        background: `radial-gradient(circle at 30% 28%, hsl(${hue} 100% 85%), hsl(${hue} 90% 58%) 45%, hsl(${(hue + 50) % 360} 90% 35%))`,
      }}
    >
      {symbol.slice(0, 1)}
    </div>
  );
}
