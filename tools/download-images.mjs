#!/usr/bin/env node
// Optional: copies every character portrait into img/<series>/<id>.<ext> so the site
// no longer depends on AniList / Fandom hotlinks. Run once from the project folder:
//   node tools/download-images.mjs
// It keeps the original links in data/images.remote.js and rewrites data/images.js
// to point at the local files. Safe to re-run; already-downloaded files are skipped.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const src = fs.existsSync(path.join(root, "data/images.remote.js")) ? "data/images.remote.js" : "data/images.js";
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, src), "utf8"), ctx);
const remote = ctx.window.DLE.img;
if (src === "data/images.js") fs.copyFileSync(path.join(root, "data/images.js"), path.join(root, "data/images.remote.js"));

const local = {};
let ok = 0, fail = 0;
for (const [series, map] of Object.entries(remote)) {
  local[series] = {};
  fs.mkdirSync(path.join(root, "img", series), { recursive: true });
  for (const [id, url] of Object.entries(map)) {
    const ext = (url.match(/\.(png|jpe?g|webp|gif)/i) || [, "jpg"])[1].toLowerCase().replace("jpeg", "jpg");
    const rel = `img/${series}/${id}.${ext}`;
    const out = path.join(root, rel);
    if (!fs.existsSync(out)) {
      try {
        const res = await fetch(url, { headers: { "User-Agent": "Kamedles image cache" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
        await new Promise(r => setTimeout(r, 150));
      } catch (e) { console.log(`skip ${series}/${id}: ${e.message}`); local[series][id] = url; fail++; continue; }
    }
    local[series][id] = rel; ok++;
  }
}
fs.writeFileSync(path.join(root, "data/images.js"),
  "// Character portraits by series and character id (local copies; originals in images.remote.js)\n" +
  "window.DLE = window.DLE || {};\nwindow.DLE.img = " + JSON.stringify(local, null, 1) + ";\n");
console.log(`done: ${ok} local, ${fail} still remote`);
