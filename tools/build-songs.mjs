#!/usr/bin/env node
// Builds the Songs pool from everyone's Spotify exports (Exportify CSVs).
//   node tools/build-songs.mjs
// Input:  sources/playlists/<Name> Songs[ N].csv   (one or more files per person)
// Output: data/songs.js — every song that shows up in at least MIN_PEOPLE different people's lists.
// Matching: same Spotify track, OR same cleaned title + same lead artist (so a single and the
// album version of one song count as the same song). Duplicates inside one person's lists count once.
import fs from "node:fs";
import path from "node:path";

const MIN_PEOPLE = 2;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const dir = path.join(root, process.argv[2] || "sources/playlists");

function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const deaccent = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function cleanTitle(t) {
  let s = deaccent(t).toLowerCase();
  s = s.replace(/\s*[\(\[][^\)\]]*\b(feat|ft|with|prod|from|remaster|version|edit|mix|explicit|clean|live|mono|stereo|bonus|deluxe|sped|slowed|acoustic|instrumental|op|ed|opening|ending|tv size)\b[^\)\]]*[\)\]]/g, "");
  s = s.replace(/\s+-\s+.*\b(remaster|version|edit|mix|from|live|mono|stereo|feat|with|single|radio|bonus|recorded)\b.*$/g, "");
  s = s.replace(/\bfeat\.?\s.*$|\bft\.?\s.*$/g, "");
  s = s.replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return s || deaccent(t).toLowerCase().trim();
}
const cleanArtist = a => deaccent(a).toLowerCase().replace(/^the\s+/, "").replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// ---------- read files ----------
const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith(".csv")).sort();
if (!files.length) { console.error(`No CSV files in ${dir}`); process.exit(1); }
const people = [];
const rows = [];
for (const f of files) {
  const person = f.replace(/\.csv$/i, "").replace(/\s*songs?\b.*$/i, "").replace(/\s*\d+$/, "").trim() || f;
  if (!people.includes(person)) people.push(person);
  for (const r of parseCSV(fs.readFileSync(path.join(dir, f), "utf8"))) {
    const uri = r["Track URI"] || "";
    const id = (uri.match(/spotify:track:([A-Za-z0-9]+)/) || [])[1];
    const title = r["Track Name"] || "";
    const artists = (r["Artist Name(s)"] || "").split(";").map(s => s.trim()).filter(Boolean);
    if (!id || !title || !artists.length) continue; // local files, podcasts, removed tracks
    rows.push({ person, id, title, artists, album: r["Album Name"] || "", year: (r["Release Date"] || "").slice(0, 4),
      dur: +r["Duration (ms)"] || 0, pop: +r["Popularity"] || 0, genres: (r["Genres"] || "").split(",").map(s => s.trim()).filter(Boolean),
      key: cleanTitle(title) + "|" + cleanArtist(artists[0]) });
  }
}

// ---------- group: union-find over spotify id and title+artist key ----------
const parent = new Map();
const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
const union = (a, b) => { for (const x of [a, b]) if (!parent.has(x)) parent.set(x, x); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
for (const r of rows) union("id:" + r.id, "key:" + r.key);
const groups = new Map();
for (const r of rows) { const g = find("id:" + r.id); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }

const songs = [];
for (const list of groups.values()) {
  const who = [...new Set(list.map(r => r.person))];
  if (who.length < MIN_PEOPLE) continue;
  // representative version: the one most people have, then most popular
  const byId = new Map(); for (const r of list) { const e = byId.get(r.id) || { r, n: new Set() }; e.n.add(r.person); if (r.pop > e.r.pop) e.r = r; byId.set(r.id, e); }
  const rep = [...byId.values()].sort((a, b) => b.n.size - a.n.size || b.r.pop - a.r.pop)[0].r;
  songs.push({
    id: rep.id, t: rep.title, a: rep.artists.join(", "), al: rep.album, y: rep.year, d: rep.dur, pop: Math.max(...list.map(r => r.pop)),
    g: [...new Set(list.flatMap(r => r.genres))].slice(0, 3), p: who.map(w => people.indexOf(w)).sort((x, y) => x - y),
    alt: [...byId.keys()].filter(k => k !== rep.id)
  });
}
songs.sort((a, b) => b.p.length - a.p.length || b.pop - a.pop || a.t.localeCompare(b.t));

const out = "// Generated by tools/build-songs.mjs from sources/playlists — do not edit by hand.\n" +
  `// Songs that appear in at least ${MIN_PEOPLE} people's exported playlists.\n` +
  "window.DLE = window.DLE || {};\nwindow.DLE.songs = " + JSON.stringify({ people, minPeople: MIN_PEOPLE, built: new Date().toISOString().slice(0, 10), list: songs }) + ";\n";
fs.writeFileSync(path.join(root, "data/songs.js"), out);

// ---------- report ----------
const perPerson = people.map(p => `${p} ${new Set(rows.filter(r => r.person === p).map(r => find("id:" + r.id))).size}`);
const hist = {}; for (const s of songs) hist[s.p.length] = (hist[s.p.length] || 0) + 1;
console.log(`people: ${perPerson.join(", ")}`);
console.log(`unique songs overall: ${groups.size}; shared by ${MIN_PEOPLE}+ people: ${songs.length}`);
console.log(`by number of people: ${Object.entries(hist).map(([k, v]) => `${k}→${v}`).join("  ")}`);
console.log(`share of pool per person: ${people.map((p, i) => `${p} ${songs.filter(s => s.p.includes(i)).length}`).join(", ")}`);
console.log(`wrote data/songs.js (${Math.round(out.length / 1024)} KB)`);
