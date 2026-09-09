/* Minimal ZIP writer — enough to hand a family a folder they can open.
 *
 * No library, because the album has no build step and nothing here is hard:
 * a local header per file, a central directory at the end, CRC-32 in between.
 * Text is deflated where the browser offers CompressionStream; photos, audio
 * and signatures are stored as they are — they are compressed already, and
 * running them through deflate costs time to save nothing.
 *
 * Blobs are kept as Blobs in the parts list and only read once, to hash them,
 * so a 300 MB album never sits in memory twice.
 */
(function () {
  'use strict';

  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const enc = new TextEncoder();

  // No ZIP64 here: a class album is megabytes, not gigabytes. Say so plainly
  // rather than writing an archive whose offsets have quietly wrapped.
  const LIMIT = 0xFFFFFFFF;

  function buf(n) { const u = new Uint8Array(n); return { u, v: new DataView(u.buffer), p: 0 }; }
  function u16(b, n) { b.v.setUint16(b.p, n, true); b.p += 2; }
  function u32(b, n) { b.v.setUint32(b.p, n >>> 0, true); b.p += 4; }

  // DOS timestamp: two-second resolution, no timezone, 1980 epoch.
  function dosTime(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }

  const canDeflate = typeof CompressionStream === 'function';
  async function deflateRaw(u8) {
    const cs = new CompressionStream('deflate-raw');
    const stream = new Blob([u8]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  class Zip {
    constructor() {
      this.parts = [];     // Blob | Uint8Array, in file order
      this.entries = [];   // one per file, for the central directory
      this.offset = 0;
      this.stamp = dosTime(new Date());
    }

    /* name: forward-slash path inside the archive.
     * data: string | Uint8Array | ArrayBuffer | Blob
     * compress: deflate it (only worth it for text) */
    async add(name, data, compress) {
      const nameBytes = enc.encode(name);
      let blob = null, bytes = null;

      if (typeof data === 'string') bytes = enc.encode(data);
      else if (data instanceof Uint8Array) bytes = data;
      else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
      else blob = data;

      const raw = bytes || new Uint8Array(await blob.arrayBuffer());
      const size = raw.length;
      const crc = crc32(raw);

      let method = 0, body = blob || raw, csize = size;
      if (compress && canDeflate && size > 256) {
        try {
          const packed = await deflateRaw(raw);
          // Deflate can grow already-dense bytes; keep the smaller of the two.
          if (packed.length < size) { method = 8; body = packed; csize = packed.length; }
        } catch { /* stored is always a valid fallback */ }
      }

      if (this.offset + 30 + nameBytes.length + csize > LIMIT) {
        throw new Error('Albumul e prea mare pentru un singur fișier zip.');
      }

      const h = buf(30 + nameBytes.length);
      u32(h, 0x04034B50);
      u16(h, method ? 20 : 10);      // version needed
      u16(h, 0x0800);                // UTF-8 names
      u16(h, method);
      u16(h, this.stamp.time); u16(h, this.stamp.date);
      u32(h, crc); u32(h, csize); u32(h, size);
      u16(h, nameBytes.length); u16(h, 0);
      h.u.set(nameBytes, h.p);

      this.entries.push({ nameBytes, method, crc, csize, size, offset: this.offset });
      this.parts.push(h.u, body);
      this.offset += h.u.length + csize;
    }

    blob(mime) {
      const cd = [];
      let cdSize = 0;
      for (const e of this.entries) {
        const b = buf(46 + e.nameBytes.length);
        u32(b, 0x02014B50);
        u16(b, 20); u16(b, e.method ? 20 : 10);
        u16(b, 0x0800);
        u16(b, e.method);
        u16(b, this.stamp.time); u16(b, this.stamp.date);
        u32(b, e.crc); u32(b, e.csize); u32(b, e.size);
        u16(b, e.nameBytes.length); u16(b, 0); u16(b, 0); // name, extra, comment
        u16(b, 0); u16(b, 0);                             // disk, internal attrs
        u32(b, 0);                                        // external attrs
        u32(b, e.offset);
        b.u.set(e.nameBytes, b.p);
        cd.push(b.u); cdSize += b.u.length;
      }
      const end = buf(22);
      u32(end, 0x06054B50);
      u16(end, 0); u16(end, 0);
      u16(end, this.entries.length); u16(end, this.entries.length);
      u32(end, cdSize); u32(end, this.offset);
      u16(end, 0);
      return new Blob([...this.parts, ...cd, end.u], { type: mime || 'application/zip' });
    }
  }

  window.Zip = Zip;
})();
