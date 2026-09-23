#!/usr/bin/env node
// Checks every preview source in data/song-sources.js against the Spotify track it stands for, so the
// Songs game only plays the original recording: same length (±4s), same lead artist, same title, and no
// sped-up / slowed / remix / live / cover / karaoke versions (clean edits are fine).
//   node tools/check-song-sources.mjs          report only (details in sources/song-check.json)
//   node tools/check-song-sources.mjs --fix    also swap bad sources for verified originals found by
//                                              searching Deezer and Apple Music; songs with no verified
//                                              original lose their source and drop out of the pool.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const FIX = process.argv.includes("--fix") || process.argv.some(a => a.startsWith("--only="));
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, "data/songs.js"), "utf8"), ctx);
vm.runInNewContext(fs.readFileSync(path.join(root, "data/song-sources.js"), "utf8"), ctx);
const { songs, songSrc } = ctx.window.DLE;

// Spotify's explicit flag isn't in songs.js; read it from the playlist exports when they're around.
const explicit = {};
const plDir = path.join(root, "sources/playlists");
if (fs.existsSync(plDir)) for (const f of fs.readdirSync(plDir).filter(f => f.endsWith(".csv"))) {
  for (const line of fs.readFileSync(path.join(plDir, f), "utf8").split("\n")) {
    const m = line.match(/^spotify:track:([A-Za-z0-9]+),/);
    if (m) { const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || []; explicit[m[1]] = /^true,?$/.test((cells[7] || "").trim()); }
  }
}

/* ---------- matching ---------- */
// Letters and digits of any script survive (Japanese titles, etc.); names made only of symbols ("¥$")
// fall back to their raw lowercase form so they can still be compared.
const norm = s => {
  const raw = String(s || "").normalize("NFKC");
  const t = raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return t || raw.toLowerCase().replace(/\s+/g, " ").trim();
};
// "Song (feat. X) - Remastered 2011" -> "song"
const baseTitle = s => norm(String(s).replace(/\s*[([].*?[)\]]/g, "").replace(/\s+-\s+.*$/, "").replace(/\s+(feat|ft|with)\.?\s.*$/i, ""));
const BAD = /\b(sped[\s-]?up|speed[\s-]?up|slowed|reverb|nightcore|8d|screwed|chopped|remix(ed)?|rmx|live|acoustic|instrumental|karaoke|cover|tribute|originally performed|made famous|in the style of|lo[\s-]?fi|piano version|orchestral|re[\s-]?recorded|extended|a ?cappella|demo|radio edit|clean version|workout|bass boosted)\b/i;
const leadOf = a => norm(String(a).split(/,|;| & | feat\.? | x /i)[0]);
const hasWord = (hay, needle) => !!needle && ` ${hay} `.includes(` ${needle} `);

function judge(song, c, alts = []) {
  const why = [];
  if (!c) return ["missing"];
  if (!c.preview) why.push("no preview");
  const own = `${song.t} ${song.al || ""}`;
  const tag = `${c.title} ${c.version || ""} ${c.album || ""}`;
  const bad = tag.match(BAD);
  if (bad && !BAD.test(own)) why.push(`version: "${bad[0]}"`);
  const want = [baseTitle(song.t), ...alts.map(baseTitle)].filter(Boolean), got = baseTitle(c.title);
  if (!want.some(w => got === w || hasWord(got, w) || hasWord(w, got))) why.push(`title "${c.title}"`);
  const lead = leadOf(song.a), artists = c.artists.map(norm);
  if (!artists.some(x => hasWord(x, lead) || hasWord(lead, x))) why.push(`artist "${c.artists[0]}"`);
  const dd = c.ms - song.d, tol = Math.max(4000, song.d * 0.02);
  if (!c.ms || Math.abs(dd) > tol) why.push(`length ${Math.round(c.ms / 1000)}s vs ${Math.round(song.d / 1000)}s`);
  // A clean edit is the same recording with words muted, so it's allowed; rank() still prefers the
  // explicit original when the Spotify track is explicit and one exists.
  return why;
}
// Among passing candidates prefer the same album, the same explicitness, then the closest length.
const rank = (song, c) => (norm(c.album) === norm(song.al) ? 100 : 0) + (explicit[song.id] == null || c.explicit === explicit[song.id] ? 20 : 0) - Math.abs(c.ms - song.d) / 1000;

/* ---------- providers ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJSON(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "KamedlesSongCheck/1.0" } });
      if (r.status === 403 || r.status === 429) { await sleep(4000 * (i + 1)); continue; }
      const j = await r.json();
      if (j && j.error && /quota/i.test(j.error.message || "")) { await sleep(3000 * (i + 1)); continue; }
      return j;
    } catch (e) { await sleep(1500 * (i + 1)); }
  }
  return null;
}
const dz = t => t && !t.error && t.id ? { id: t.id, title: t.title, version: t.title_version, album: t.album && t.album.title,
  artists: [t.artist && t.artist.name, ...(t.contributors || []).map(x => x.name)].filter(Boolean), ms: (t.duration || 0) * 1000,
  preview: t.preview, explicit: !!t.explicit_lyrics, cleaned: t.explicit_content_lyrics === 3 } : null;
const it = t => t && t.trackId ? { id: t.trackId, title: t.trackName, version: "", album: t.collectionName, artists: [t.artistName],
  ms: t.trackTimeMillis || 0, preview: t.previewUrl, explicit: t.trackExplicitness === "explicit", cleaned: t.trackExplicitness === "cleaned" } : null;

let dzGate = Promise.resolve(), itGate = Promise.resolve();
const throttle = (gate, ms) => { const p = gate.then(() => sleep(ms)); return [p, p]; };
async function deezer(url) { let p; [dzGate, p] = throttle(dzGate, 130); await p; return getJSON(url); }
async function itunes(url) { let p; [itGate, p] = throttle(itGate, 4000); await p; return getJSON(url); }

async function searchDeezer(song, alts) {
  // Deezer's artist:"…" track:"…" syntax returns nothing now; a plain query works.
  const q = `${String(song.a).split(/,|;/)[0].trim()} ${String(song.t).replace(/\s*[([].*?[)\]]/g, "").replace(/\s+-\s+.*$/, "")}`;
  const j = await deezer(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=50`);
  const ok = ((j && j.data) || []).map(dz).filter(c => c && !judge(song, c, alts).length);
  // search results carry no contributors/explicit detail beyond the basics — re-read the winner in full
  for (const c of ok.sort((a, b) => rank(song, b) - rank(song, a)).slice(0, 3)) {
    const full = dz(await deezer(`https://api.deezer.com/track/${c.id}`));
    if (full && !judge(song, full, alts).length) return full;
  }
  return null;
}
async function searchItunes(song, alts) {
  const term = `${String(song.a).split(/,|;/)[0].trim()} ${String(song.t).replace(/\s*[([].*?[)\]]/g, "").replace(/\s+-\s+.*$/, "")}`;
  const j = await itunes(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=25&country=US`);
  const ok = ((j && j.results) || []).map(it).filter(c => c && !judge(song, c, alts).length);
  return ok.sort((a, b) => rank(song, b) - rank(song, a))[0] || null;
}

/* ---------- run ---------- */
// --fix also searches for songs that have no source yet, so they can join the pool.
// --only=<text> limits the run to songs whose title contains <text> (dry run, nothing is written).
const ONLY = (process.argv.find(a => a.startsWith("--only=")) || "").slice(7).toLowerCase();
const list = (FIX || ONLY ? songs.list.slice() : songs.list.filter(s => songSrc[s.id])).filter(s => !ONLY || s.t.toLowerCase().includes(ONLY));
console.log(`checking ${list.length} songs${FIX ? " (including ones without a source)" : " with preview sources"}…`);
const itIds = [...new Set(list.map(s => (songSrc[s.id] || [])[1]).filter(Boolean))];
const itInfo = {};
for (let i = 0; i < itIds.length; i += 150) {
  const j = await itunes(`https://itunes.apple.com/lookup?id=${itIds.slice(i, i + 150).join(",")}&country=US`);
  for (const r of (j && j.results) || []) itInfo[r.trackId] = it(r);
}
const report = [], out = { ...songSrc };
let done = 0;
async function check(song) {
  const [dId, iId, ...alts] = songSrc[song.id] || [0, 0];
  const d = dId ? dz(await deezer(`https://api.deezer.com/track/${dId}`)) : null;
  const i = iId ? itInfo[iId] || null : null;
  const dWhy = dId ? judge(song, d, alts) : ["none"], iWhy = iId ? judge(song, i, alts) : ["none"];
  const row = { id: song.id, song: `${song.t} — ${song.a}`, deezer: dWhy.length ? dWhy : "ok", itunes: iWhy.length ? iWhy : "ok" };
  if (FIX && (dWhy.length || iWhy.length)) {
    let nd = dWhy.length ? 0 : dId, ni = iWhy.length ? 0 : iId;
    if (!nd) { const c = await searchDeezer(song, alts); if (c) { nd = c.id; row.newDeezer = `${c.title} | ${c.album} | ${Math.round(c.ms / 1000)}s`; } }
    if (!nd && !ni) { const c = await searchItunes(song, alts); if (c) { ni = c.id; row.newItunes = `${c.title} | ${c.album} | ${Math.round(c.ms / 1000)}s`; } }
    if (nd || ni) { out[song.id] = [nd, ni, ...alts]; if (!songSrc[song.id]) row.added = true; }
    else { if (songSrc[song.id]) row.dropped = true; delete out[song.id]; }
  }
  report.push(row);
  if (++done % 100 === 0) console.log(`  ${done}/${list.length}`);
}
const queue = list.slice();
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await check(queue.shift()); }));

const bad = report.filter(r => r.deezer !== "ok" && r.deezer[0] !== "none" || r.itunes !== "ok" && r.itunes[0] !== "none");
const noGood = report.filter(r => r.deezer !== "ok" && r.itunes !== "ok");
console.log(`\n${list.length} songs: ${bad.length} with at least one wrong source, ${noGood.length} with no correct source`);
for (const r of bad.slice(0, 40)) console.log(`  ${r.song}\n     deezer: ${[].concat(r.deezer).join("; ")} | apple: ${[].concat(r.itunes).join("; ")}${r.newDeezer ? `\n     -> deezer ${r.newDeezer}` : ""}${r.newItunes ? `\n     -> apple ${r.newItunes}` : ""}${r.dropped ? "\n     -> dropped (no original found)" : ""}`);
if (bad.length > 40) console.log(`  … ${bad.length - 40} more in sources/song-check.json`);
fs.mkdirSync(path.join(root, "sources"), { recursive: true });
fs.writeFileSync(path.join(root, "sources/song-check.json"), JSON.stringify(report, null, 1));
if (FIX && !ONLY) {
  fs.writeFileSync(path.join(root, "data/song-sources.js"), "// Preview sources per Spotify track id: [deezerTrackId, itunesTrackId, altTitle?]. 0 = none.\n" +
    "// Generated by tools/merge-song-sources.mjs, checked by tools/check-song-sources.mjs.\nwindow.DLE = window.DLE || {};\nwindow.DLE.songSrc = " + JSON.stringify(out) + ";\n");
  const kept = songs.list.filter(s => out[s.id]).length;
  console.log(`\nwrote data/song-sources.js: ${kept}/${songs.list.length} songs have a verified source (${report.filter(r => r.added).length} newly found, ${report.filter(r => r.dropped).length} dropped)`);
}
