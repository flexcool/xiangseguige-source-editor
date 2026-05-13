/**
 * XXTEA (Corrected Block TEA) implementation for XBS file format
 */

const DELTA = 0x9e3779b9;

const KEY_BYTES = new Uint8Array([
  0xe5, 0x87, 0xbc, 0xe8, 0xa4, 0x86, 0xe6, 0xbb, 0xbf, 0xe9, 0x87, 0x91, 0xe6,
  0xba, 0xa1, 0xe5,
]);

function toU32(bytes: Uint8Array): Uint32Array {
  const arr = new Uint32Array(Math.ceil(bytes.length / 4));
  for (let i = 0; i < bytes.length; i++)
    arr[i >>> 2] |= bytes[i] << ((i & 3) << 3);
  return arr;
}

function toBytes(arr: Uint32Array, len: number): Uint8Array {
  const b = new Uint8Array(len);
  for (let i = 0; i < len; i++) b[i] = (arr[i >>> 2] >>> ((i & 3) << 3)) & 0xff;
  return b;
}

function mx(
  sum: number,
  y: number,
  z: number,
  p: number,
  e: number,
  k: Uint32Array,
): number {
  return (
    ((((z >>> 5) ^ (y << 2)) + ((y >>> 3) ^ (z << 4))) ^
      ((sum ^ y) + (k[(p & 3) ^ e] ^ z))) >>>
    0
  );
}

function xxteaDecrypt(v: Uint32Array, k: Uint32Array): void {
  const n = v.length;
  if (n < 2) return;
  let y = v[0],
    z: number,
    e: number;
  const q = Math.floor(6 + 52 / n);
  let sum = (q * DELTA) >>> 0;
  for (let round = 0; round < q; round++) {
    e = (sum >>> 2) & 3;
    for (let p = n - 1; p > 0; p--) {
      z = v[p - 1];
      v[p] = (v[p] - mx(sum, y, z, p, e, k)) >>> 0;
      y = v[p];
    }
    z = v[n - 1];
    v[0] = (v[0] - mx(sum, y, z, 0, e, k)) >>> 0;
    y = v[0];
    sum = (sum - DELTA) >>> 0;
  }
}

function xxteaEncrypt(v: Uint32Array, k: Uint32Array): void {
  const n = v.length;
  if (n < 2) return;
  let z = v[n - 1],
    y: number,
    e: number,
    sum = 0;
  const q = Math.floor(6 + 52 / n);
  for (let round = 0; round < q; round++) {
    sum = (sum + DELTA) >>> 0;
    e = (sum >>> 2) & 3;
    for (let p = 0; p < n - 1; p++) {
      y = v[p + 1];
      v[p] = (v[p] + mx(sum, y, z, p, e, k)) >>> 0;
      z = v[p];
    }
    y = v[0];
    v[n - 1] = (v[n - 1] + mx(sum, y, z, n - 1, e, k)) >>> 0;
    z = v[n - 1];
  }
}

const KEY = toU32(KEY_BYTES);

/**
 * Decrypt XBS binary → UTF-8 JSON string
 */
export function xbs2json(buffer: ArrayBuffer): string {
  const enc = new Uint8Array(buffer);
  const totalLen = enc.length;

  if (totalLen < 8 || totalLen % 4 !== 0) {
    throw new Error(`文件长度异常 (${totalLen} 字节)，不是有效的 XBS 文件`);
  }

  const v = toU32(enc);
  xxteaDecrypt(v, KEY);
  const dec = toBytes(v, totalLen);

  const n = totalLen - 4;
  const m =
    dec[n] | (dec[n + 1] << 8) | (dec[n + 2] << 16) | (dec[n + 3] << 24);

  if (m < n - 3 || m > n) {
    throw new Error(
      `解密校验失败 (m=${m}, n=${n})，请确认是否为香色闺阁书源文件`,
    );
  }

  return new TextDecoder("utf-8").decode(dec.slice(0, m));
}

/**
 * Encrypt UTF-8 JSON string → XBS binary Uint8Array
 */
export function json2xbs(jsonStr: string): Uint8Array {
  const jsonBytes = new TextEncoder().encode(jsonStr);
  const bufLen = jsonBytes.length;
  const n4 = Math.ceil(bufLen / 4);
  const padded = new Uint8Array(n4 * 4 + 4);
  padded.set(jsonBytes);
  // append original length as uint32 LE
  padded[n4 * 4] = (bufLen >>> 0) & 0xff;
  padded[n4 * 4 + 1] = (bufLen >>> 8) & 0xff;
  padded[n4 * 4 + 2] = (bufLen >>> 16) & 0xff;
  padded[n4 * 4 + 3] = (bufLen >>> 24) & 0xff;

  const v = toU32(padded);
  xxteaEncrypt(v, KEY);
  return toBytes(v, padded.length);
}
