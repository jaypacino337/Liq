"use client";

import { useId } from "react";

/**
 * A glass flask that fills as the bonding curve sells. At overflow the
 * liquid reaches the brim and spills down the sides — the curve has become a
 * permanent pool.
 */
const FLASK =
  "M46,10 H74 V36 C74,44 108,54 108,86 V134 C108,148 98,154 84,154 H36 C22,154 12,148 12,134 V86 C12,54 46,44 46,36 Z";
const BOTTOM = 152;
const NECK = 30; // liquid top when fully overflowed
const SHOULDER = 50; // liquid top at 100% curve fill

// Wave strip twice the vessel width so it can scroll seamlessly.
function wavePath(amp: number, len = 60) {
  let d = `M-120,0`;
  for (let x = -120; x < 240; x += len) {
    d += ` q${len / 4},${-amp} ${len / 2},0 t${len / 2},0`;
  }
  return `${d} V200 H-120 Z`;
}
const WAVE_A = wavePath(5);
const WAVE_B = wavePath(3.5, 40);

export function Vessel({
  fill,
  hue,
  overflowed = false,
  size = 120,
  bubbles = true,
}: {
  fill: number;
  hue: number;
  overflowed?: boolean;
  size?: number;
  bubbles?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const level = overflowed ? NECK : BOTTOM - Math.max(0, Math.min(1, fill)) * (BOTTOM - SHOULDER);
  const c1 = `hsl(${hue} 92% 62%)`;
  const c2 = `hsl(${(hue + 38) % 360} 95% 52%)`;
  const c3 = `hsl(${(hue + 70) % 360} 90% 38%)`;

  return (
    <svg className="vessel" width={size} height={(size * 168) / 120} viewBox="0 -6 120 168" role="img" aria-label={`${Math.round(fill * 100)}% full`}>
      <defs>
        <clipPath id={`clip-${id}`}>
          <path d={FLASK} transform="translate(60 82) scale(0.94) translate(-60 -82)" />
        </clipPath>
        <linearGradient id={`liq-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c1} />
          <stop offset="0.55" stopColor={c2} />
          <stop offset="1" stopColor={c3} />
        </linearGradient>
        <linearGradient id={`glass-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.12" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.35" />
        </linearGradient>
        <radialGradient id={`glow-${id}`} cx="0.5" cy="0.7" r="0.6">
          <stop offset="0" stopColor={c1} stopOpacity={overflowed ? 0.55 : 0.18 + fill * 0.3} />
          <stop offset="1" stopColor={c1} stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="60" cy="110" rx="70" ry="60" fill={`url(#glow-${id})`} />

      {/* glass body */}
      <path d={FLASK} fill="rgba(160,200,255,0.05)" />

      <g clipPath={`url(#clip-${id})`}>
        <g className="liquid" style={{ transform: `translateY(${level}px)` }}>
          <path className="wave-b" d={WAVE_B} fill={c2} opacity="0.45" />
          <path className="wave-a" d={WAVE_A} fill={`url(#liq-${id})`} opacity="0.92" />
        </g>
        {bubbles &&
          fill > 0.02 &&
          [22, 38, 55, 70, 86].map((x, i) => (
            <circle
              key={x}
              className="bubble"
              cx={x + 6}
              cy={BOTTOM - 4}
              r={1.4 + (i % 3) * 0.8}
              fill="#fff"
              fillOpacity="0.55"
              style={{ animationDelay: `${(i * 0.83) % 4}s`, animationDuration: `${3 + (i % 3)}s` }}
            />
          ))}
      </g>

      {/* glass outline + highlight */}
      <path d={FLASK} fill="none" stroke={`url(#glass-${id})`} strokeWidth="2.2" />
      <path d="M22,92 C22,74 30,64 40,58" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="3" strokeLinecap="round" />
      <rect x="42" y="4" width="36" height="8" rx="4" fill="rgba(160,200,255,0.12)" stroke={`url(#glass-${id})`} strokeWidth="1.5" />

      {overflowed && (
        <g>
          <path d="M44,8 C30,8 34,20 40,26" fill="none" stroke={c1} strokeWidth="4" strokeLinecap="round" opacity="0.85" />
          <path d="M76,8 C90,8 86,20 80,26" fill="none" stroke={c1} strokeWidth="4" strokeLinecap="round" opacity="0.85" />
          {[30, 92, 18, 102].map((x, i) => (
            <ellipse key={x} className="drip" cx={x} cy={i < 2 ? 34 : 70} rx="2.6" ry="4" fill={c1} style={{ animationDelay: `${i * 0.65}s` }} />
          ))}
        </g>
      )}
    </svg>
  );
}
