#!/usr/bin/env node
// Builds data/bodies.js (Portrait mode's full-body pictures) from the picks in sources/fullbody/picks/<show>.json.
//   node tools/build-bodies.mjs
// A pick is { "url": "<Fandom image URL>" } or null (no usable full-body picture: the character sits out
// Portrait mode). Candidates come from tools/find-fullbody.mjs; tools/review-fullbody.html shows them.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const series = {};
for (const f of fs.readdirSync(path.join(root, "data")).filter(f => f.endsWith(".js") && !/^(index|images|episodes|songs|song-sources|connections|openings|bodies)\.js$/.test(f))) {
  const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(root, "data", f), "utf8"), ctx); Object.assign(series, ctx.window.DLE.series);
}
const dir = path.join(root, "sources/fullbody/picks");
const out = {};
let total = 0, missing = 0;
for (const [slug, s] of Object.entries(series)) {
  const file = path.join(dir, `${slug}.json`);
  const picks = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const map = {};
  for (const c of s.characters) {
    const p = picks[c.id];
    // some wikis (e.g. hero.fandom.com) only serve their images with a ?path-prefix= query, which is kept
    const m = p && p.url && /^https:\/\/static\.wikia\.nocookie\.net\/([^?]+?)(?:\/revision\/[^?]*)?(?:\?(.*))?$/.exec(p.url);
    const prefix = m && new URLSearchParams(m[2] || "").get("path-prefix");
    if (m) map[c.id] = decodeURI(m[1]) + (prefix ? `?path-prefix=${encodeURIComponent(prefix)}` : ""); else missing++;
  }
  total += Object.keys(map).length;
  if (Object.keys(map).length) out[slug] = map;
  console.log(`${slug.padEnd(13)} ${String(Object.keys(map).length).padStart(3)} / ${s.characters.length}`);
}
fs.writeFileSync(path.join(root, "data/bodies.js"),
  "// Full-body pictures for Portrait mode, keyed by series then character id: paths on Fandom's image CDN\n" +
  "// (static.wikia.nocookie.net). Built by tools/build-bodies.mjs from the picks in sources/fullbody/.\n" +
  "window.DLE = window.DLE || {};\nwindow.DLE.bodies = " + JSON.stringify(out) + ";\n");
console.log(`wrote data/bodies.js: ${total} pictures (${missing} characters without one sit out Portrait mode)`);
