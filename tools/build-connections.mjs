#!/usr/bin/env node
// Builds data/connections.js for the Connections tab from the group banks in tools/connections/*.json
// (rules: docs/CONNECTIONS_SPEC.md) plus a Music set generated from data/songs.js.
//   node tools/build-connections.mjs            validate + write data/connections.js
//   node tools/build-connections.mjs --check    validate only
// Every set is test-driven through the same puzzle generator the site uses (js/connections.js).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const CHECK = process.argv.includes("--check");
const load = (file, ctx = { window: {} }) => { vm.runInNewContext(fs.readFileSync(path.join(root, file), "utf8"), ctx); return ctx.window; };

// The generator lives in js/connections.js; without the site's helpers it only exports KConnGen.
const gen = load("js/connections.js").KConnGen;
const { norm } = gen;

/* ---------- show banks ---------- */
const dir = path.join(root, "tools/connections");
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort() : [];
const series = {};
for (const f of fs.readdirSync(path.join(root, "data")).filter(f => f.endsWith(".js") && !/^(index|images|episodes|songs|song-sources|connections|openings|bodies)\.js$/.test(f))) {
  Object.assign(series, load(`data/${f}`).DLE.series);
}
const sets = {};
let errors = 0;
const err = (where, msg) => { errors++; console.log(`  ERROR ${where}: ${msg}`); };
const warn = (where, msg) => console.log(`  warn  ${where}: ${msg}`);

for (const f of files) {
  const slug = f.replace(/\.json$/, "");
  console.log(`${slug}:`);
  let bank;
  try { bank = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch (e) { err(f, `bad JSON: ${e.message}`); continue; }
  if (bank.show !== slug) err(f, `"show" is "${bank.show}", expected "${slug}"`);
  if (!series[slug]) warn(f, `no data/${slug}.js — label will fall back to the slug`);
  const groups = Array.isArray(bank.groups) ? bank.groups : [];
  if (groups.length < 10) err(f, `${groups.length} groups (need at least 10)`);
  const titles = new Set();
  for (const [i, g] of groups.entries()) {
    const where = `${slug} #${i + 1} "${g.title}"`;
    if (typeof g.title !== "string" || !g.title.trim()) err(where, "missing title");
    if (titles.has(norm(g.title))) err(where, "duplicate title"); titles.add(norm(g.title));
    if (![1, 2, 3, 4].includes(g.level)) err(where, `level must be 1-4 (got ${g.level})`);
    if (typeof g.def !== "string" || g.def.length < 12) err(where, "missing def");
    if (typeof g.source !== "string" || !/^https?:\/\//.test(g.source)) err(where, "missing source URL");
    if (!Array.isArray(g.members) || g.members.length < 4) { err(where, "needs at least 4 members"); continue; }
    if (g.members.length > 14) warn(where, `${g.members.length} members (max 14 recommended)`);
    const seen = new Set();
    for (const m of g.members) {
      if (typeof m !== "string" || !m.trim()) { err(where, "empty member"); continue; }
      if (seen.has(norm(m))) err(where, `duplicate member "${m}"`); seen.add(norm(m));
      if (m.length > 16) warn(where, `long tile name "${m}"`);
    }
  }
  // Same person spelled two ways? ("Luffy" vs "Monkey D. Luffy", "Kakashi" vs "kakashi")
  const names = [...new Set(groups.flatMap(g => g.members || []))];
  const byNorm = new Map();
  for (const n of names) { const k = norm(n); if (byNorm.has(k) && byNorm.get(k) !== n) err(slug, `"${n}" and "${byNorm.get(k)}" differ only in case/punctuation`); byNorm.set(k, n); }
  for (const a of names) for (const b of names) {
    if (a !== b && norm(a).split(" ").length > 1 && ` ${norm(a)} `.includes(` ${norm(b)} `) && norm(b).length >= 4) warn(slug, `"${a}" contains "${b}" — same person? use one spelling`);
  }
  const levels = [1, 2, 3, 4].map(l => groups.filter(g => g.level === l).length);
  if (levels[2] + levels[3] < 3) warn(slug, `only ${levels[2] + levels[3]} level 3-4 groups (want 3+)`);
  // Groups that must never share a board: same `family`, or named in either one's `avoid`
  const no = groups.map(() => new Set());
  const byTitle = new Map(groups.map((g, i) => [norm(g.title), i]));
  for (const [i, g] of groups.entries()) {
    if (g.family != null && (typeof g.family !== "string" || !g.family.trim())) err(`${slug} "${g.title}"`, "family must be a non-empty string");
    for (const [j, o] of groups.entries()) if (i !== j && g.family && g.family === o.family) no[i].add(j);
    for (const t of g.avoid || []) {
      const j = byTitle.get(norm(t));
      if (j == null || j === i) err(`${slug} "${g.title}"`, `avoid names "${t}", which isn't another group in this file`);
      else { no[i].add(j); no[j].add(i); }
    }
  }
  sets[slug] = { label: (series[slug] && series[slug].short) || slug,
    groups: groups.map(({ title, level, members }, i) => ({ title, level, members, ...(no[i].size ? { no: [...no[i]].sort((a, b) => a - b) } : {}) })) };
  console.log(`  ${groups.length} groups (levels ${levels.join("/")}), ${names.length} names`);
}

/* ---------- music set from the shared playlists ---------- */
{
  const { songs } = load("data/songs.js").DLE;
  const clean = t => String(t).replace(/\s*[([](feat|ft|with|from|prod)\.?[^)\]]*[)\]]/gi, "").replace(/\s+-\s+(from|feat|remaster).*$/i, "").trim();
  const tiles = songs.list.map(s => ({ ...s, tile: clean(s.t), artists: String(s.a).split(/,\s*/) })).filter(s => s.tile.length <= 24);
  const groups = [];
  const byArtist = new Map();
  for (const s of tiles) for (const a of s.artists) { if (!byArtist.has(a)) byArtist.set(a, []); byArtist.get(a).push(s); }
  for (const [a, list] of byArtist) {
    const members = [...new Set(list.map(s => s.tile))];
    if (members.length >= 4) groups.push({ title: `${a} songs`, level: members.length >= 20 ? 1 : members.length >= 9 ? 2 : 3, members });
  }
  const byYear = new Map();
  for (const s of tiles) if (s.y) { if (!byYear.has(s.y)) byYear.set(s.y, []); byYear.get(s.y).push(s.tile); }
  for (const [y, list] of byYear) if (list.length >= 4) groups.push({ title: `Released in ${y}`, level: 4, members: [...new Set(list)] });
  const genre = (label, test, level) => { const members = [...new Set(tiles.filter(s => (s.g || []).some(test)).map(s => s.tile))]; if (members.length >= 4) groups.push({ title: label, level, members }); };
  genre("K-pop songs", g => /k-pop/.test(g), 2);
  genre("Anime songs", g => /anime/.test(g), 2);
  genre("Country songs", g => /country/.test(g), 3);
  genre("Emo / pop punk", g => /emo|pop punk/.test(g), 3);
  const shared = [...new Set(tiles.filter(s => s.p.length >= 6).map(s => s.tile))];
  if (shared.length >= 4) groups.push({ title: "Saved by 6+ of you", level: 3, members: shared });
  sets.music = { label: "Music", groups };
  console.log(`music:\n  ${groups.length} groups from ${tiles.length} songs`);
}

/* ---------- can the generator fill a daily puzzle for months? ---------- */
for (const [slug, set] of Object.entries(sets)) {
  let fails = 0; const seen = new Set();
  const apart = new Set(set.groups.flatMap((g, i) => (g.no || []).map(j => `${g.title}|${set.groups[j].title}`)));
  for (let day = 0; day < 300; day++) {
    const p = gen.makePuzzle(set, gen.seedFor(slug, day));
    if (!p) { fails++; continue; }
    seen.add(p.groups.map(g => g.title).sort().join("|"));
    for (const a of p.groups) for (const b of p.groups) if (apart.has(`${a.title}|${b.title}`)) err(slug, `day ${day} put "${a.title}" and "${b.title}" together`);
  }
  const line = `${slug}: ${300 - fails}/300 days filled, ${seen.size} different group combinations`;
  if (fails) err(slug, line); else if (seen.size < 60) warn(slug, `${line} (want 60+)`); else console.log(line);
}

if (errors) { console.log(`\n${errors} error(s) — nothing written.`); process.exit(1); }
if (!CHECK) {
  const order = Object.keys(sets).filter(k => k !== "music").sort((a, b) => a.localeCompare(b)).concat("music");
  fs.writeFileSync(path.join(root, "data/connections.js"),
    "// Generated by tools/build-connections.mjs from tools/connections/*.json and data/songs.js.\n" +
    "window.DLE = window.DLE || {};\nwindow.DLE.connections = " + JSON.stringify({ order, sets }) + ";\n");
  console.log(`\nwrote data/connections.js (${Object.keys(sets).length} sets)`);
}
