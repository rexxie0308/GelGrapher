/* Minimal ZIP writer (stored, no compression) and reader (stored + deflate).
 * Used to hand over files whose type a host does not accept directly (TIFF, project files) and to
 * open them again. UTF-8 file names. */
(function (G) {
  'use strict';
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  async function bytesOf(d) {
    if (d instanceof Uint8Array) return d;
    if (d instanceof ArrayBuffer) return new Uint8Array(d);
    if (typeof d === 'string') return new TextEncoder().encode(d);
    return new Uint8Array(await d.arrayBuffer());
  }
  function dosTime(dt) {
    return { time: (dt.getHours() << 11) | (dt.getMinutes() << 5) | (dt.getSeconds() >> 1), date: ((dt.getFullYear() - 1980) << 9) | ((dt.getMonth() + 1) << 5) | dt.getDate() };
  }
  // files: [{name, data: Blob | ArrayBuffer | Uint8Array | string}] -> Blob (application/zip)
  async function make(files) {
    const parts = [], central = [], { time, date } = dosTime(new Date());
    let off = 0;
    for (const f of files) {
      const data = await bytesOf(f.data), name = new TextEncoder().encode(f.name), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, off, true);
      central.push(new Uint8Array(ch.buffer), name);
      off += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }
  function isZip(buffer) { const u = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength)); return u[0] === 0x50 && u[1] === 0x4b && u[2] === 3 && u[3] === 4; }
  async function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack this ZIP');
    return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  }
  // -> [{name, data: ArrayBuffer}]
  async function read(buffer) {
    const dv = new DataView(buffer), u8 = new Uint8Array(buffer);
    let e = -1;
    for (let p = buffer.byteLength - 22; p >= Math.max(0, buffer.byteLength - 65557); p--) if (dv.getUint32(p, true) === 0x06054b50) { e = p; break; }
    if (e < 0) throw new Error('Not a valid ZIP file');
    const n = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const out = [];
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + xl + cl;
      if (name.endsWith('/')) continue;
      const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
      const raw = u8.subarray(start, start + csize);
      if (method !== 0 && method !== 8) continue;
      const data = method === 0 ? raw.slice() : await inflateRaw(raw);
      out.push({ name: name.split('/').pop(), data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) });
    }
    return out;
  }
  G.Zip = { make, read, isZip, crc32 };
})(window);
