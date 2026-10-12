/**
 * Reads the Token-2022 TokenMetadata extension straight from mint account
 * data, plus the off-chain JSON shape the app writes.
 */
import { Reader } from "./codec";

const BASE_ACCOUNT_LEN = 165; // mints with extensions are padded to Account::LEN
const ACCOUNT_TYPE_MINT = 1;
const EXT_TOKEN_METADATA = 19;

export interface MintMetadata {
  name: string;
  symbol: string;
  uri: string;
  supply: bigint;
  decimals: number;
}

export interface OffchainMetadata {
  name?: string;
  symbol?: string;
  image?: string;
  description?: string;
}

export function decodeMintMetadata(data: Uint8Array): MintMetadata | null {
  if (data.length <= BASE_ACCOUNT_LEN || data[BASE_ACCOUNT_LEN] !== ACCOUNT_TYPE_MINT) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const supply = view.getBigUint64(36, true);
  const decimals = data[44]!;
  let off = BASE_ACCOUNT_LEN + 1;
  while (off + 4 <= data.length) {
    const type = view.getUint16(off, true);
    const len = view.getUint16(off + 2, true);
    if (type === 0) break; // uninitialized padding
    if (type === EXT_TOKEN_METADATA) {
      const r = new Reader(data.subarray(off + 4, off + 4 + len)).skip(64); // update authority + mint
      return { name: r.string(), symbol: r.string(), uri: r.string(), supply, decimals };
    }
    off += 4 + len;
  }
  return null;
}
