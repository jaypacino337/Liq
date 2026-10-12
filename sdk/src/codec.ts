/** Minimal Borsh reader/writer for the handful of types Liq uses. */
import { PublicKey } from "@solana/web3.js";
import type { LaunchParams } from "./types";

export const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
export const bytesToHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function startsWith(data: Uint8Array, prefix: Uint8Array): boolean {
  if (data.length < prefix.length) return false;
  return prefix.every((b, i) => data[i] === b);
}

export class Reader {
  private view: DataView;
  offset = 0;
  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8() {
    return this.view.getUint8(this.offset++);
  }
  bool() {
    return this.u8() !== 0;
  }
  u16() {
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }
  u32() {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }
  u64() {
    const v = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return v;
  }
  i64() {
    const v = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return v;
  }
  pubkey() {
    const k = new PublicKey(this.bytes.subarray(this.offset, this.offset + 32));
    this.offset += 32;
    return k;
  }
  string() {
    const len = this.u32();
    const s = new TextDecoder().decode(this.bytes.subarray(this.offset, this.offset + len));
    this.offset += len;
    return s;
  }
  skip(n: number) {
    this.offset += n;
    return this;
  }
  launchParams(): LaunchParams {
    return {
      protocolFeeBps: this.u16(),
      creatorFeeBps: this.u16(),
      initialVirtualSol: this.u64(),
      initialVirtualTokens: this.u64(),
      curveSupply: this.u64(),
      totalSupply: this.u64(),
      calmPeriodSecs: this.i64(),
      calmMaxBuyLamports: this.u64(),
      graduationFeeLamports: this.u64(),
    };
  }
}

export class Writer {
  private chunks: number[] = [];
  raw(bytes: Uint8Array) {
    this.chunks.push(...bytes);
    return this;
  }
  u8(v: number) {
    this.chunks.push(v & 0xff);
    return this;
  }
  bool(v: boolean) {
    return this.u8(v ? 1 : 0);
  }
  u16(v: number) {
    return this.u8(v).u8(v >> 8);
  }
  u64(v: bigint) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, v, true);
    return this.raw(b);
  }
  i64(v: bigint) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigInt64(0, v, true);
    return this.raw(b);
  }
  pubkey(k: PublicKey) {
    return this.raw(k.toBytes());
  }
  string(s: string) {
    const enc = new TextEncoder().encode(s);
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, enc.length, true);
    return this.raw(len).raw(enc);
  }
  option<T>(v: T | null | undefined, write: (w: Writer, v: T) => void) {
    if (v === null || v === undefined) return this.u8(0);
    this.u8(1);
    write(this, v);
    return this;
  }
  launchParams(p: LaunchParams) {
    return this.u16(p.protocolFeeBps)
      .u16(p.creatorFeeBps)
      .u64(p.initialVirtualSol)
      .u64(p.initialVirtualTokens)
      .u64(p.curveSupply)
      .u64(p.totalSupply)
      .i64(p.calmPeriodSecs)
      .u64(p.calmMaxBuyLamports)
      .u64(p.graduationFeeLamports);
  }
  toBytes() {
    return Uint8Array.from(this.chunks);
  }
}
