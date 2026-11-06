// Append this touch layer to the client's own credits list, so attribution lives
// in Options -> Credits & Attribution -> Credits rather than in a bespoke screen.
// Data-driven: it edits one JSON entry inside assets.epk and leaves 19,511 others
// untouched.
import { readEpk, writeEpk } from "./epk.mjs";

const ENTRY = "assets/minecraft/texts/credits.json";

export const CREDIT_SECTION = {
  section: "Web Touch Controls",
  disciplines: [
    {
      discipline: "Bedrock-style touch layer for this client",
      titles: [{ title: "Author", names: ["terry65536"] }],
    },
  ],
};

export function patchCredits(epkBytes) {
  const epk = readEpk(epkBytes);
  const entry = epk.entries.find((e) => e.name === ENTRY && e.tag === "FILE");
  if (!entry) throw new Error(`no ${ENTRY} in this assets payload`);
  const list = JSON.parse(entry.data.toString("utf8"));
  if (!Array.isArray(list)) throw new Error(`${ENTRY} is not a list`);
  if (!list.some((s) => s && s.section === CREDIT_SECTION.section)) list.push(CREDIT_SECTION);
  entry.data = Buffer.from(JSON.stringify(list, null, 4) + "\n", "utf8");
  const out = writeEpk(epk);
  return { buf: out.buf, sections: list.length };
}
