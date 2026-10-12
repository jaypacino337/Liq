import { MAX_URI_LEN } from "@liq/sdk";

/**
 * Zero-infrastructure token metadata: the JSON is packed into the URI itself
 * and served back by /api/metadata. Falls back to a user-hosted URI when the
 * packed form would exceed the on-chain 200-byte limit.
 */
export interface PackedMeta {
  n: string;
  s: string;
  i?: string;
  d?: string;
}

const b64url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function packedUri(origin: string, m: PackedMeta): { uri: string; bytes: number; fits: boolean } {
  const compact: PackedMeta = { n: m.n, s: m.s };
  if (m.i) compact.i = m.i;
  if (m.d) compact.d = m.d;
  const uri = `${origin}/api/metadata?d=${b64url(JSON.stringify(compact))}`;
  const bytes = new TextEncoder().encode(uri).length;
  return { uri, bytes, fits: bytes <= MAX_URI_LEN };
}

export function unpack(d: string): PackedMeta | null {
  try {
    const bin = atob(d.replace(/-/g, "+").replace(/_/g, "/"));
    const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    const m = JSON.parse(json);
    return typeof m?.n === "string" && typeof m?.s === "string" ? m : null;
  } catch {
    return null;
  }
}
