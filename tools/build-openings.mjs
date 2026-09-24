#!/usr/bin/env node
// Builds data/openings.js for the Openings tab (name the show from its opening theme).
//   node tools/build-openings.mjs
// Shows:  the most popular anime on AniList, plus every anime at least one of you has rated there
//         (sequels folded into one show), plus theme songs for the group's western shows (below).
//         Usernames go in sources/anilist-users.txt (one per line, profile links are fine) — it's
//         git-ignored, and only the combined show list is published.
// Songs:  every opening from AnisongDB (anisongdb.com), matched to the original recording on Deezer
//         (Apple Music as a fallback) so clips play the same way the Songs tab does. Covers, karaoke,
//         remixes and the like are rejected; TV-size cuts are preferred when they exist.
// Lookups are cached in sources/openings-cache.json, so a re-run only fetches what's new.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const TOP = 500;
// Until the AniList usernames are in, the site's own anime stand in for "rated by one of you".
const FALLBACK_RATED = [21, 20, 16498, 113415, 21459, 11061, 223, 97940, 127230, 154587];
// Theme songs for the group's western shows (not on AniList): [show name, song, artist words that must
// match, pinned ids when search keeps finding the wrong version]
const WESTERN = [
  // search turns up the Broadway musical's cast recording; these are the original TV theme
  ["SpongeBob SquarePants", "SpongeBob SquarePants Theme", ["spongebob", "pinney", "painty"], { dz: 2958441, it: 255390766 }],
  ["Avatar: The Last Airbender", "Avatar: The Last Airbender Main Title", ["track team", "zuckerman", "wynn", "avatar"]],
  // search turns up the 2023 Once & Always soundtrack; this is Ron Wasserman's original
  ["Power Rangers", "Go Go Power Rangers", ["mighty raw", "wasserman", "power rangers"], { dz: 0, it: 1444118093 }],
  ["iCarly", "Leave It All to Me", ["miranda cosgrove"]],
  ["Victorious", "Make It Shine", ["victorious", "victoria justice"]],
  ["Drake & Josh", "Found a Way", ["drake bell"]],
  ["Zoey 101", "Follow Me", ["jamie lynn spears"]],
  ["Big Time Rush", "Big Time Rush", ["big time rush"]],
  ["Game of Thrones", "Main Title Game of Thrones", ["ramin djawadi"]],
];
const usersFile = path.join(root, "sources/anilist-users.txt");
const USERS = fs.existsSync(usersFile)
  ? fs.readFileSync(usersFile, "utf8").split(/\r?\n/).map(l => l.trim().replace(/^.*anilist\.co\/user\//i, "").replace(/\/.*$/, "")).filter(Boolean)
  : [];

const cacheFile = path.join(root, "sources/openings-cache.json");
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {};
const saveCache = () => { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(cache)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function http(url, opts = {}, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...opts, headers: { "User-Agent": "KamedlesBuild/1.0", ...(opts.headers || {}) } });
      if (r.status === 429 || r.status === 403 || r.status >= 500) { await sleep(3000 * (i + 1)); continue; }
      const j = await r.json();
      if (j && j.error && /quota/i.test(j.error.message || "")) { await sleep(3000 * (i + 1)); continue; }
      return j;
    } catch (e) { await sleep(1500 * (i + 1)); }
  }
  return null;
}
const cached = async (key, fn) => { if (!(key in cache)) { cache[key] = await fn(); saveCache(); } return cache[key]; };

/* ---------- 1. popular anime from AniList, folded into franchises ---------- */
const MEDIA = `id idMal format season seasonYear popularity synonyms title { english romaji } coverImage { large } studios(isMain: true) { nodes { name } } relations { edges { relationType node { id } } }`;
const anilist = (query, variables) => http("https://graphql.anilist.co", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
const media = new Map();
for (let page = 1; page <= TOP / 50; page++) {
  const j = await cached(`anilist:top:${page}`, () => anilist(`query($p:Int){Page(page:$p,perPage:50){media(type:ANIME,sort:POPULARITY_DESC,format_in:[TV,TV_SHORT,ONA]){${MEDIA}}}}`, { p: page }));
  for (const m of (j && j.data && j.data.Page.media) || []) media.set(m.id, m);
  await sleep(800);
}
// Everything at least one of you has rated (lists change, so these aren't cached).
const rated = new Set();
for (const user of USERS) {
  const j = await anilist(`query($u:String){MediaListCollection(userName:$u,type:ANIME){lists{entries{score(format:POINT_100) media{id}}}}}`, { u: user });
  const lists = j && j.data && j.data.MediaListCollection && j.data.MediaListCollection.lists;
  if (!lists) { console.log(`  couldn't read ${user}'s list — is it public?`); continue; }
  const before = rated.size;
  for (const l of lists) for (const e of l.entries) if (e.score > 0) rated.add(e.media.id);
  console.log(`  ${user}: ${rated.size - before} new rated shows`);
  await sleep(800);
}
if (!USERS.length) { console.log("  no sources/anilist-users.txt yet — using the site's anime as the rated shows"); FALLBACK_RATED.forEach(id => rated.add(id)); }
const missing = [...rated].filter(id => !media.has(id));
for (let i = 0; i < missing.length; i += 50) {
  const ids = missing.slice(i, i + 50);
  const j = await cached(`anilist:ids:${ids.join(",")}`, () => anilist(`query($ids:[Int]){Page(perPage:50){media(id_in:$ids,type:ANIME){${MEDIA}}}}`, { ids }));
  for (const m of (j && j.data && j.data.Page.media) || []) media.set(m.id, m);
  await sleep(800);
}
const parent = new Map([...media.keys()].map(id => [id, id]));
const find = id => { while (parent.get(id) !== id) id = parent.get(id); return id; };
for (const m of media.values()) for (const e of m.relations.edges) {
  if ((e.relationType === "SEQUEL" || e.relationType === "PREQUEL") && media.has(e.node.id)) parent.set(find(m.id), find(e.node.id));
}
const franchises = new Map();
for (const m of media.values()) { const r = find(m.id); if (!franchises.has(r)) franchises.set(r, []); franchises.get(r).push(m); }
const titleOf = m => m.title.english || m.title.romaji;
const shows = [];
for (const [rootId, entries] of franchises) {
  entries.sort((a, b) => (a.seasonYear || 9999) - (b.seasonYear || 9999));
  const first = entries[0];
  const aliases = [...new Set(entries.flatMap(m => [m.title.english, m.title.romaji, ...(m.synonyms || [])]).filter(t => t && /[a-z]/i.test(t) && t.length <= 60))];
  shows.push({ key: `a${rootId}`, name: titleOf(first), aliases: aliases.filter(t => t !== titleOf(first)), year: first.seasonYear, studio: (first.studios.nodes[0] || {}).name || "",
    cover: first.coverImage.large, rated: entries.some(m => rated.has(m.id)), entries: entries.map(m => ({ id: m.id, mal: m.idMal, title: titleOf(m) })), popularity: Math.max(...entries.map(m => m.popularity)) });
}
console.log(`${media.size} anime entries -> ${shows.length} shows (${shows.filter(s => s.rated).length} rated by one of you)`);

/* ---------- 2. openings from AnisongDB ---------- */
const malToShow = new Map();
for (const s of shows) for (const e of s.entries) if (e.mal) malToShow.set(e.mal, { s, e });
const mals = [...malToShow.keys()];
const songs = [];
for (let i = 0; i < mals.length; i += 40) {
  const batch = mals.slice(i, i + 40);
  const rows = await cached(`anisongdb:${batch.join(",")}`, () => http("https://anisongdb.com/api/mal_ids_request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mal_ids: batch }) }));
  for (const r of rows || []) {
    const m = /^Opening (\d+)/.exec(r.songType || "");
    const hit = m && malToShow.get(r.linked_ids && r.linked_ids.myanimelist);
    if (!hit || r.isDub || r.isRebroadcast) continue;
    songs.push({ show: hit.s, entry: hit.e.title, n: +m[1], song: r.songName, artist: r.songArtist, diff: r.songDifficulty == null ? null : Math.round(r.songDifficulty), len: r.songLength });
  }
  await sleep(1000);
}
console.log(`${songs.length} openings found`);

/* ---------- 3. match each opening to the original recording on Deezer / Apple Music ---------- */
const norm = s => { const raw = String(s || "").normalize("NFKC"); const t = raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim(); return t || raw.toLowerCase().trim(); };
const hasWord = (hay, needle) => !!needle && ` ${hay} `.includes(` ${needle} `);
const baseTitle = s => norm(String(s).replace(/\s*[([].*?[)\]]/g, "").replace(/\s+-\s+.*$/, ""));
const BAD = /\b(cover|karaoke|instrumental|off vocal|remix|rmx|live|acoustic|piano|8[\s-]?bit|lo[\s-]?fi|orchestral|music box|lullaby|sped[\s-]?up|slowed|nightcore|english ver|english version|made famous|originally performed|tribute|medley|mashup)\b/i;
const TV = /\b(tv[\s-]?(size|ver|version|edit)|tv size)\b/i;
function fits(want, c, artistWords) {
  if (!c || !c.preview) return false;
  if (BAD.test(`${c.title} ${c.album || ""}`) && !BAD.test(want.song)) return false;
  const t = baseTitle(c.title), w = baseTitle(want.song);
  if (!(t === w || hasWord(t, w) || hasWord(w, t))) return false;
  const words = artistWords || [norm(String(want.artist).split(/,| feat\.? | & | x | with /i)[0])];
  return c.artists.map(norm).some(x => words.some(a => hasWord(x, a) || hasWord(a, x)));
}
let dzGate = Promise.resolve(), itGate = Promise.resolve();
const gate = (g, ms) => { const p = g.then(() => sleep(ms)); return [p, p]; };
async function deezer(q) { let p; [dzGate, p] = gate(dzGate, 140); await p; return http(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=25`); }
async function itunes(q) { let p; [itGate, p] = gate(itGate, 4000); await p; return http(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=25&country=US`); }
const pickBest = list => list.sort((a, b) => (TV.test(b.title) ? 1 : 0) - (TV.test(a.title) ? 1 : 0) || b.rank - a.rank)[0] || null;
async function resolve(want, artistWords) {
  return cached(`src:${norm(want.artist)}|${norm(want.song)}`, async () => {
    const q = `${String(want.artist).split(/,| feat\.? /i)[0]} ${want.song}`;
    const d = await deezer(q);
    const dz = pickBest(((d && d.data) || []).map(t => ({ id: t.id, title: t.title, album: t.album && t.album.title, artists: [t.artist && t.artist.name].filter(Boolean), preview: t.preview, rank: t.rank || 0 })).filter(c => fits(want, c, artistWords)));
    if (dz) return { dz: dz.id, it: 0, title: dz.title };
    const i = await itunes(q);
    const it = pickBest(((i && i.results) || []).map(t => ({ id: t.trackId, title: t.trackName, album: t.collectionName, artists: [t.artistName], preview: t.previewUrl, rank: 0 })).filter(c => fits(want, c, artistWords)));
    return it ? { dz: 0, it: it.id, title: it.title } : null;
  });
}
const themes = [];
let done = 0, found = 0;
const queue = songs.slice();
await Promise.all(Array.from({ length: 3 }, async () => {
  while (queue.length) {
    const s = queue.shift();
    const src = await resolve(s);
    if (src) { themes.push({ ...s, ...src }); found++; }
    if (++done % 100 === 0) console.log(`  ${done}/${songs.length} checked, ${found} with an original recording`);
  }
}));
for (const [name, song, words, pinned] of WESTERN) {
  const src = pinned || await resolve({ song, artist: words[0] }, words);
  if (!src) { console.log(`  no original found for the ${name} theme`); continue; }
  const show = { name, aliases: [], year: null, studio: "", cover: "", rated: true, western: true, entries: [], popularity: 0 };
  shows.push(show);
  themes.push({ show, entry: name, n: 1, song, artist: "", diff: null, ...src });
}

/* ---------- 4. write ---------- */
const used = shows.filter(s => themes.some(t => t.show === s)).sort((a, b) => b.popularity - a.popularity);
const idx = new Map(used.map((s, i) => [s, i]));
const out = {
  built: new Date().toISOString().slice(0, 10),
  shows: used.map(({ name, aliases, year, studio, cover, rated, western }) => ({ name, aliases, year, studio, cover, rated, western: !!western })),
  themes: themes.filter(t => idx.has(t.show)).map(t => ({ s: idx.get(t.show), entry: t.entry, n: t.n, song: t.song, artist: t.artist, diff: t.diff, dz: t.dz, it: t.it }))
    .sort((a, b) => a.s - b.s || a.entry.localeCompare(b.entry) || a.n - b.n),
};
fs.writeFileSync(path.join(root, "data/openings.js"),
  "// Generated by tools/build-openings.mjs — shows from AniList, opening lists from AnisongDB,\n" +
  "// clips are Deezer / Apple Music previews of the original recordings.\n" +
  "window.DLE = window.DLE || {};\nwindow.DLE.openings = " + JSON.stringify(out) + ";\n");
console.log(`wrote data/openings.js: ${out.shows.length} shows, ${out.themes.length} openings (${out.themes.filter(t => used[t.s].rated).length} from shows one of you rated)`);
