// Embed the Bedrock control sprites as data URLs so the layer stays one file.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));

const SRC = path.resolve(here, "../docs/sprites");
const need = [
  "joystick_frame", "joystick_knob",
  "up", "down", "left", "right", "up_left", "up_right", "down_left", "down_right",
  "up_pressed", "down_pressed", "left_pressed", "right_pressed",
  "up_left_pressed", "up_right_pressed", "down_left_pressed", "down_right_pressed",
  "jump", "jump_pressed", "sneak", "sneak_pressed",
  "large_button", "large_button_pressed",
  "inventory_icon", "pause_icon", "chat_keyboard", "cursor",
];

const out = [];
for (const name of need) {
  const p = path.join(SRC, name + ".png");
  if (!fs.existsSync(p)) throw new Error("missing sprite " + name);
  const b = fs.readFileSync(p);
  out.push(`  ${JSON.stringify(name)}: { w: 0, h: 0, url: "data:image/png;base64,${b.toString("base64")}" }`);
}
const js = `// Bedrock Edition touch-control sprites, taken from Mojang's bedrock-samples
// resource pack (textures/gui/controls and textures/ui). Inlined so the client stays a
// single HTML file; their terms are recorded in NOTICE.
window.__eagSprites = {\n${out.join(",\n")}\n};\n`;
fs.writeFileSync(path.resolve(here, "sprites.js"), js);
console.log(`wrote sprites.js with ${need.length} sprites (${js.length} bytes)`);
