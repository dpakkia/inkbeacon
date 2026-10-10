/**
 * MD5 and KOReader's document ids, for the browser and the server alike.
 *
 * MD5 is broken for security and is used here only because KOReader's sync
 * protocol identifies books and passwords with it. Web Crypto has no MD5,
 * hence this small implementation (RFC 1321), checked against Node's
 * `crypto` in testing.
 */

const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
  9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
  16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
  21,
];
const K = Array.from(
  { length: 64 },
  (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0,
);

/** Incremental MD5: feed bytes with `update`, read the hex digest with `hex`. */
export class Md5 {
  private state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  private buffer = new Uint8Array(64);
  private buffered = 0;
  private length = 0;

  update(data: Uint8Array) {
    this.length += data.length;
    let offset = 0;
    while (offset < data.length) {
      const take = Math.min(64 - this.buffered, data.length - offset);
      this.buffer.set(data.subarray(offset, offset + take), this.buffered);
      this.buffered += take;
      offset += take;
      if (this.buffered === 64) {
        this.block(this.buffer);
        this.buffered = 0;
      }
    }
    return this;
  }

  hex() {
    const bits = this.length * 8;
    const tail = new Uint8Array(this.buffered < 56 ? 64 : 128);
    tail.set(this.buffer.subarray(0, this.buffered));
    tail[this.buffered] = 0x80;
    const view = new DataView(tail.buffer);
    view.setUint32(tail.length - 8, bits >>> 0, true);
    view.setUint32(tail.length - 4, Math.floor(bits / 2 ** 32), true);
    for (let i = 0; i < tail.length; i += 64)
      this.block(tail.subarray(i, i + 64));
    return this.state
      .map((word) =>
        [0, 8, 16, 24]
          .map((shift) =>
            ((word >>> shift) & 0xff).toString(16).padStart(2, '0'),
          )
          .join(''),
      )
      .join('');
  }

  private block(chunk: Uint8Array) {
    const m = new Uint32Array(16);
    const view = new DataView(chunk.buffer, chunk.byteOffset, 64);
    for (let i = 0; i < 16; i += 1) m[i] = view.getUint32(i * 4, true);
    let [a, b, c, d] = this.state;
    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const sum = (a + f + K[i] + m[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << SHIFTS[i]) | (sum >>> (32 - SHIFTS[i])))) >>> 0;
    }
    this.state = [
      (this.state[0] + a) >>> 0,
      (this.state[1] + b) >>> 0,
      (this.state[2] + c) >>> 0,
      (this.state[3] + d) >>> 0,
    ];
  }
}

export function md5Hex(data: Uint8Array | string) {
  const bytes =
    typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return new Md5().update(bytes).hex();
}

/**
 * KOReader's "binary" document id (`util.partialMD5` in KOReader): MD5 over
 * 1024-byte samples at offsets 1024 << (2*i) for i = -1..10 (0, 1 KB, 4 KB,
 * 16 KB, … 1 GB, with a 32-bit shift), stopping at the end of the file.
 */
export function koreaderPartialMd5(file: Uint8Array) {
  const hash = new Md5();
  for (let i = -1; i <= 10; i += 1) {
    const start = 1024 << (2 * i);
    if (start >= file.length) break;
    hash.update(file.subarray(start, start + 1024));
  }
  return hash.hex();
}

/** KOReader's "filename" document id: MD5 of the file name, without folders. */
export function koreaderFilenameMd5(fileName: string) {
  return md5Hex(fileName.split(/[\\/]/).pop() ?? fileName);
}
