#!/usr/bin/env node
// Collects full-body picture candidates for Portrait mode from each show's Fandom wiki.
//   node tools/find-fullbody.mjs [show ...]
// For every character it finds the wiki page (plus any Gallery subpage), lists the images there and
// scores them: tall, single-character art ("anime profile", "full", renders, infobox art) ranks high;
// manga panels, episode screenshots and close-ups rank low. The top candidates are saved per character
// in sources/fullbody/<show>.json, which tools/review-fullbody.html shows side by side so the best one
// can be picked into sources/fullbody/picks/<show>.json (then tools/build-bodies.mjs). Re-runs skip
// characters that are already done.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const WIKI = { aot: "attackontitan", avatar: "avatar", blackclover: "blackclover", csm: "chainsaw-man", dragonball: "dragonball", frieren: "frieren",
  got: "gameofthrones", hxh: "hunterxhunter", jjk: "jujutsu-kaisen", korra: "avatar", mha: "myheroacademia", naruto: "naruto", onepiece: "onepiece",
  powerrangers: "powerrangers", spongebob: "spongebob" };
const TEENNICK = { "iCarly": "icarly", "Victorious": "victorious", "Drake & Josh": "drakeandjosh", "Zoey 101": "zoey101", "Big Time Rush": "bigtimerush" };

const series = {};
for (const f of fs.readdirSync(path.join(root, "data")).filter(f => f.endsWith(".js") && !/^(index|images|episodes|songs|song-sources|connections|openings|bodies)\.js$/.test(f))) {
  const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(root, "data", f), "utf8"), ctx); Object.assign(series, ctx.window.DLE.series);
}
const only = process.argv.slice(2);
const outDir = path.join(root, "sources/fullbody");
fs.mkdirSync(outDir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(wiki, params) {
  const url = `https://${wiki}.fandom.com/api.php?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;
  for (let i = 0; i < 5; i++) {
    try { const r = await fetch(url, { headers: { "User-Agent": "KamedlesBuild/1.0" } }); if (r.ok) return await r.json(); } catch {}
    await sleep(1500 * (i + 1));
  }
  return null;
}
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function findPage(wiki, c, slug) {
  const tries = [...(slug === "aot" ? [`${c.name} (Anime)`] : []), c.name, ...(c.aliases || [])].slice(0, 6);
  const j = await api(wiki, { action: "query", titles: tries.join("|"), redirects: "1" });
  const pages = ((j && j.query && j.query.pages) || []).filter(p => !p.missing && !p.invalid);
  for (const t of tries) { // keep the preference order above
    const redirect = ((j && j.query && j.query.redirects) || []).find(r => r.from === t);
    const title = redirect ? redirect.to : t;
    const p = pages.find(p => p.title === title || norm(p.title) === norm(title));
    if (p) return p.title;
  }
  const s = await api(wiki, { action: "query", list: "search", srsearch: c.name, srlimit: "5", srnamespace: "0" });
  const first = norm(c.name).split(" ")[0];
  const hit = ((s && s.query && s.query.search) || []).find(r => norm(r.title).split(" ").includes(first));
  return hit ? hit.title : null;
}

function score(file, w, h, c) {
  const f = norm(file.replace(/\.[a-z0-9]+$/i, ""));
  const nameWords = norm([c.name, ...(c.aliases || [])].join(" ")).split(" ").filter(x => x.length >= 3);
  const a = h / w;
  let s = 0;
  if (nameWords.some(x => ` ${f} `.includes(` ${x} `))) s += 2;
  if (/\b(anime|profile|full|fullbody|full body|render|design|infobox|model|stock art|character image|concept|reference|legacy wars|bcm|appearance)\b/.test(f)) s += 3;
  if (/\b(manga|chapter|chap|volume|vol|colored|coloured|cover|panel|page|databook|novel)\b/.test(f)) s -= 5;
  if (/\bep\s?\d+|\bepisode\b|\bs\d+e\d+\b|\b\d+x\d+\b|screenshot|\bscene\b/.test(f)) s -= 2;
  if (/\b(portrait|face|mugshot|headshot|close up|closeup|eyes|icon|avatar|chibi|sprite|card|sticker|funko|figure|plush|toy|key|zord|megazord|weapon|sword|mask|helmet)\b/.test(f)) s -= 3;
  if (/\b(vs|and|with|meets|team|group|family)\b/.test(f)) s -= 2;
  if (/\b(the last|boruto|new era|movie|film|mobile|game|kid|young|younger|child|baby)\b/.test(f)) s -= 2; // prefer the series look
  if (a >= 1.8) s += 3; else if (a >= 1.4) s += 1; else if (a < 1.1) s -= 3;
  if (h < 450) s -= 1;
  return s;
}

const BAD_FILE = /\.(svg|gif)$|logo|symbol|flag|emblem|crest|signature|kanji|\bmap\b|heraldry|sigil|seal|title card|titlecard/i;
for (const [slug, s] of Object.entries(series)) {
  if (only.length && !only.includes(slug)) continue;
  const file = path.join(outDir, `${slug}.json`);
  const done = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  let n = 0;
  for (const c of s.characters) {
    if (done[c.id]) continue;
    const wiki = slug === "teennick" ? TEENNICK[(c.affiliation || []).find(a => TEENNICK[a])] : WIKI[slug];
    if (!wiki) { done[c.id] = { page: null, cands: [], note: "no wiki" }; continue; }
    const page = await findPage(wiki, c, slug);
    if (!page) { done[c.id] = { wiki, page: null, cands: [] }; continue; }
    const j = await api(wiki, { action: "query", titles: [page, `${page}/Gallery`, `${page}/Image Gallery`, `${page}/Images`].join("|"), generator: "images", gimlimit: "max", prop: "imageinfo", iiprop: "url|size|mime" });
    const imgs = ((j && j.query && j.query.pages) || []).filter(p => p.imageinfo && p.imageinfo[0]).map(p => ({ file: p.title.replace(/^File:/, ""), url: p.imageinfo[0].url, w: p.imageinfo[0].width, h: p.imageinfo[0].height }));
    const cands = imgs.filter(i => i.h >= 350 && i.w >= 120 && !BAD_FILE.test(i.file))
      .map(i => ({ ...i, url: i.url.replace(/\?.*$/, ""), score: score(i.file, i.w, i.h, c) }))
      .sort((a, b) => b.score - a.score || (b.h / b.w) - (a.h / a.w)).slice(0, 6);
    done[c.id] = { wiki, page, cands };
    if (++n % 10 === 0) { fs.writeFileSync(file, JSON.stringify(done, null, 1)); process.stdout.write(`${slug} ${n} `); }
    await sleep(250);
  }
  fs.writeFileSync(file, JSON.stringify(done, null, 1));
  const empty = s.characters.filter(c => !done[c.id] || !done[c.id].cands.length).length;
  console.log(`\n${slug}: ${s.characters.length} characters, ${empty} without candidates`);
}
