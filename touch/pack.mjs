// Produce the deliverable: the official single-file client plus the touch layer.
//
//   node touch/pack.mjs <official client.html> <output.html> [--credits]
//
// Without --credits every byte of the input outside the injected block is left
// untouched. With --credits the assets payload additionally gains one section in
// assets/minecraft/texts/credits.json, which the client renders in
// Options -> Credits & Attribution -> Credits.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { patchCredits } from "../tools/credits_patch.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const [inHtml, outHtml, ...flags] = process.argv.slice(2);
if (!inHtml || !outHtml) {
  console.error("usage: node touch/pack.mjs <official client.html> <output.html> [--credits]");
  process.exit(2);
}
const withCredits = flags.includes("--credits");

const parts = ["options.js", "sprites.js", "bridge.js", "credits.js", "overlay.js"]
  .map((f) => "<script>" + fs.readFileSync(path.join(here, f), "utf8") + "</script>")
  .join("\n");

const base = fs.readFileSync(inHtml);
const head = base.indexOf(Buffer.from("<head>", "latin1"));
if (head < 0) throw new Error("no <head> in " + inHtml);
const block = Buffer.from(
  "\n<!-- Bedrock-style touch layer: options seed + sprites + input bridge + credits + HUD.\n" +
  "     The game itself is unmodified. (c) 2026 terry65536, MIT - see LICENSE/NOTICE -->\n" +
  parts + "\n", "utf8");
let out = Buffer.concat([base.subarray(0, head + 6), block, base.subarray(head + 6)]);

// the payload bodies are base64 in 256 KB lines, exactly like payloadTag() in
// wasm-toolchain/build-single-html.js; data-size has to match the raw bytes
const B64_LINE = 256 * 1024;
function payloadRange(buffer, id) {
  const open = Buffer.from(`<script type="application/octet-stream" id="${id}" data-size="`, "latin1");
  const i = buffer.indexOf(open);
  if (i < 0) throw new Error(`payload ${id} not found`);
  const sizeStart = i + open.length;
  const sizeEnd = buffer.indexOf(Buffer.from('"', "latin1"), sizeStart);
  const bodyStart = buffer.indexOf(Buffer.from(">", "latin1"), sizeEnd) + 1;
  const bodyEnd = buffer.indexOf(Buffer.from("</script>", "latin1"), bodyStart);
  return {
    sizeStart, sizeEnd, bodyStart, bodyEnd,
    size: Number(buffer.subarray(sizeStart, sizeEnd).toString("latin1")),
  };
}

function readPayload(buffer, id) {
  const r = payloadRange(buffer, id);
  const b64 = buffer.subarray(r.bodyStart, r.bodyEnd).toString("latin1").replace(/\s+/g, "");
  const raw = Buffer.from(b64, "base64");
  if (raw.length !== r.size) throw new Error(`payload ${id}: ${raw.length} bytes vs data-size ${r.size}`);
  return raw;
}

function writePayload(buffer, id, raw) {
  const r = payloadRange(buffer, id);
  const enc = raw.toString("base64");
  const lines = [];
  for (let i = 0; i < enc.length; i += B64_LINE) lines.push(enc.slice(i, i + B64_LINE));
  const body = Buffer.from("\n" + lines.join("\n") + "\n", "latin1");
  return Buffer.concat([
    buffer.subarray(0, r.sizeStart),
    Buffer.from(String(raw.length), "latin1"),
    buffer.subarray(r.sizeEnd, r.bodyStart),
    body,
    buffer.subarray(r.bodyEnd),
  ]);
}

if (withCredits) {
  const assets = readPayload(out, "eag-inline-assets");
  const patched = patchCredits(assets);
  out = writePayload(out, "eag-inline-assets", patched.buf);
  console.log(`credits: ${patched.sections} sections, assets payload ${assets.length} -> ${patched.buf.length} bytes`);
}

fs.writeFileSync(outHtml, out);
console.log(`wrote ${outHtml}: ${fs.statSync(outHtml).size} bytes (base ${base.length}, injected ${block.length})`);
