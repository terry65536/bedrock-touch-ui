// Produce the deliverable: the unmodified official client with only the touch
// layer injected, so every game payload stays byte-identical.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const base = fs.readFileSync(process.argv[2]);
const out = process.argv[3];

const parts = ["options.js", "sprites.js", "bridge.js", "credits.js", "overlay.js"]
  .map((f) => "<script>" + fs.readFileSync(path.join(here, f), "utf8") + "</script>")
  .join("\n");
const i = base.indexOf(Buffer.from("<head>", "latin1"));
if (i < 0) throw new Error("no <head>");
const block = Buffer.from(
  "\n<!-- Bedrock-style touch layer: options seed + sprites + input bridge + credits + HUD.\n     The game itself is unmodified. (c) 2026 terry65536, MIT - see LICENSE/NOTICE -->\n" +
  parts + "\n", "utf8");
fs.writeFileSync(out, Buffer.concat([base.subarray(0, i + 6), block, base.subarray(i + 6)]));
console.log(`wrote ${out}: ${fs.statSync(out).size} bytes (base ${base.length}, injected ${block.length})`);
