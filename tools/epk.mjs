// EPK v2.0 reader/writer, per EPKCompiler.java (EAGPKG$$ header, HEAD/FILE records,
// optional gzip body, :::YEE:> trailer).
import fs from "node:fs";
import zlib from "node:zlib";

const MAGIC = "EAGPKG$$";

function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; ++n) {
      c = n;
      for (let k = 0; k < 8; ++k) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = -1;
  for (let i = 0; i < buf.length; ++i) c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

export function readEpk(file) {
  const buf = typeof file === "string" ? fs.readFileSync(file) : file;
  if (buf.subarray(0, 8).toString("latin1") !== MAGIC) throw new Error("not an EPK: " + buf.subarray(0, 8));
  let p = 8;
  const verLen = buf[p++];
  const version = buf.subarray(p, p + verLen).toString("latin1"); p += verLen;
  const nameLen = buf[p++];
  const fileName = buf.subarray(p, p + nameLen).toString("latin1"); p += nameLen;
  const commentLen = (buf[p] << 8) | buf[p + 1]; p += 2;
  const comment = buf.subarray(p, p + commentLen).toString("utf8"); p += commentLen;
  const timestamp = Number(buf.readBigUInt64BE(p)); p += 8;
  const declaredCount = buf.readInt32BE(p); p += 4;
  const comp = String.fromCharCode(buf[p++]);
  let trailer;
  let bodyBytes;
  if (comp === "G") {
    const tail = buf.subarray(buf.length - 8).toString("latin1");
    if (tail !== ":::YEE:>") throw new Error("missing trailer: " + JSON.stringify(tail));
    bodyBytes = zlib.gunzipSync(buf.subarray(p, buf.length - 8));
    trailer = tail;
  } else if (comp === "0") {
    const tail = buf.subarray(buf.length - 8).toString("latin1");
    bodyBytes = buf.subarray(p, buf.length - 8);
    trailer = tail;
  } else throw new Error("unknown compression: " + comp);

  const entries = [];
  let q = 0;
  while (q < bodyBytes.length) {
    const tag = bodyBytes.subarray(q, q + 4).toString("latin1"); q += 4;
    if (tag === "END$") break;
    const nlen = bodyBytes[q++];
    const name = bodyBytes.subarray(q, q + nlen).toString("latin1"); q += nlen;
    const field = bodyBytes.readInt32BE(q); q += 4;
    if (tag === "FILE") {
      const crc = bodyBytes.readUInt32BE(q); q += 4;
      const dataLen = field - 5;
      const data = bodyBytes.subarray(q, q + dataLen); q += dataLen;
      const term = bodyBytes.subarray(q, q + 2).toString("latin1"); q += 2;
      if (term !== ":>") throw new Error(`bad terminator after ${name}: ${JSON.stringify(term)}`);
      if (crc32(data) !== crc) throw new Error(`crc mismatch for ${name}`);
      entries.push({ tag, name, crc, data: Buffer.from(data) });
    } else if (tag === "HEAD") {
      const data = bodyBytes.subarray(q, q + field); q += field;
      const term = bodyBytes[q]; q += 1;
      if (term !== 0x3e) throw new Error(`bad HEAD terminator after ${name}: ${term}`);
      entries.push({ tag, name, data: Buffer.from(data) });
    } else throw new Error(`unknown record tag ${JSON.stringify(tag)} at ${q - 20}`);
  }
  return { version, fileName, comment, timestamp, declaredCount, comp, trailer, entries, bodyLength: bodyBytes.length };
}

export function writeEpk(epk, out) {
  const head = [];
  head.push(Buffer.from(MAGIC, "latin1"));
  head.push(Buffer.from([Buffer.byteLength(epk.version, "latin1")]));
  head.push(Buffer.from(epk.version, "latin1"));
  head.push(Buffer.from([Buffer.byteLength(epk.fileName, "latin1")]));
  head.push(Buffer.from(epk.fileName, "latin1"));
  const comment = Buffer.from(epk.comment, "utf8");
  const cl = Buffer.allocUnsafe(2); cl.writeUInt16BE(comment.length); head.push(cl); head.push(comment);
  const ts = Buffer.allocUnsafe(8); ts.writeBigUInt64BE(BigInt(epk.timestamp)); head.push(ts);
  // EPKCompiler counts every HEAD and FILE record written into the body
  const cnt = Buffer.allocUnsafe(4); cnt.writeInt32BE(epk.entries.length); head.push(cnt);
  head.push(Buffer.from([epk.comp.charCodeAt(0)]));
  const body = [];
  for (const e of epk.entries) {
    if (e.tag === "HEAD") {
      body.push(Buffer.from("HEAD", "latin1"));
      body.push(Buffer.from([Buffer.byteLength(e.name, "latin1")]));
      body.push(Buffer.from(e.name, "latin1"));
      const l = Buffer.allocUnsafe(4); l.writeInt32BE(e.data.length); body.push(l);
      body.push(e.data);
      body.push(Buffer.from([0x3e]));
    } else {
      body.push(Buffer.from("FILE", "latin1"));
      body.push(Buffer.from([Buffer.byteLength(e.name, "latin1")]));
      body.push(Buffer.from(e.name, "latin1"));
      const l = Buffer.allocUnsafe(4); l.writeInt32BE(e.data.length + 5); body.push(l);
      const c = Buffer.allocUnsafe(4); c.writeUInt32BE(crc32(e.data)); body.push(c);
      body.push(e.data);
      body.push(Buffer.from(":>", "latin1"));
    }
  }
  body.push(Buffer.from("END$", "latin1"));
  let bodyBuf = Buffer.concat(body);
  if (epk.comp === "G") bodyBuf = zlib.gzipSync(bodyBuf, { level: 9 });
  const headBuf = Buffer.concat(head);
  const all = Buffer.concat([headBuf, bodyBuf, Buffer.from(epk.trailer, "latin1")]);
  if (out) {
    fs.writeFileSync(out, all);
    return { bytes: fs.statSync(out).size, records: epk.entries.length };
  }
  return { bytes: all.length, records: epk.entries.length, buf: all };
}

if (process.argv[2] === "list") {
  const e = readEpk(process.argv[3]);
  console.log(`version=${e.version} name=${e.fileName} comp=${e.comp} count=${e.declaredCount} entries=${e.entries.length}`);
  console.log(`comment=${JSON.stringify(e.comment.slice(0, 120))}`);
  const filt = process.argv[4];
  for (const en of e.entries) {
    if (filt && !en.name.includes(filt)) continue;
    console.log(`  ${en.tag}  ${String(en.data.length).padStart(9)}  ${en.name}${en.tag === "HEAD" ? " = " + en.data.toString("latin1") : ""}`);
  }
} else if (process.argv[2] === "extract") {
  const e = readEpk(process.argv[3]);
  const want = process.argv[4];
  const en = e.entries.find((x) => x.name === want);
  if (!en) throw new Error("no such entry: " + want);
  fs.writeFileSync(process.argv[5], en.data);
  console.log(`extracted ${want} -> ${process.argv[5]} (${en.data.length} bytes)`);
} else if (process.argv[2] === "replace") {
  const e = readEpk(process.argv[3]);
  const want = process.argv[4];
  const en = e.entries.find((x) => x.name === want);
  if (!en) throw new Error("no such entry: " + want);
  en.data = fs.readFileSync(process.argv[5]);
  const r = writeEpk(e, process.argv[6]);
  console.log(`replaced ${want} with ${en.data.length} bytes -> ${process.argv[6]} (${r.bytes} bytes, ${r.records} records, declared ${e.declaredCount})`);
}
