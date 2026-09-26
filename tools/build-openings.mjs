#!/usr/bin/env node
// Builds data/openings.js for the Openings tab (name the show from its opening theme).
//   node tools/build-openings.mjs
// Shows:  the most popular anime on AniList, plus every anime at least one of you has rated there
//         (sequels folded into one show), plus theme songs for the group's western shows (below).
//         Usernames go in sources/anilist-users.txt (one per line, profile links are fine) — it's
//         git-ignored, and only the combined show list is published.
// Songs:  TV / ONA openings from AnisongDB (anisongdb.com) that Anime News Network's encyclopedia also
//         lists as an opening theme. AnisongDB counts anything played over the opening slot, so insert
//         songs and one-episode specials are dropped here, and the numbering is corrected to match.
// Clips:  each opening is matched to the original recording by the credited artist on Deezer (Apple
//         Music as a fallback). The only other versions allowed are TV-size / opening edits — live,
//         remix, cover, re-recorded and other versions are rejected — and the earliest recording wins.
// Every lookup is cached in sources/openings-cache.json, so a re-run only fetches what's new.
// sources/openings-review.txt lists every match and every dropped opening, for a manual look.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const TOP = 500;
// Until the AniList usernames are in, the site's own anime stand in for "rated by one of you".
const FALLBACK_RATED = [21, 20, 16498, 113415, 21459, 11061, 223, 97940, 127230, 154587];
// Theme songs for the group's western shows (not on AniList), pinned to the original TV recordings:
// search finds the Broadway cast album for SpongeBob and the 2023 Once & Always soundtrack for Power
// Rangers, for example. Zoey 101 isn't here: its original theme isn't on Deezer or Apple Music, only a
// 2020 remake.
const WESTERN = [
  ["SpongeBob SquarePants", "SpongeBob SquarePants Theme", { dz: 2958441, it: 255390766 }],
  ["Avatar: The Last Airbender", "Avatar: The Last Airbender Main Title", { dz: 0, it: 6784503685 }],
  ["Power Rangers", "Go Go Power Rangers", { dz: 0, it: 1444118093 }], // Ron Wasserman's original
  ["iCarly", "Leave It All to Me", { dz: 0, it: 269886466 }],
  ["Victorious", "Make It Shine", { dz: 0, it: 452203430 }],
  ["Drake & Josh", "Found a Way", { dz: 914388672, it: 0 }],
  ["Big Time Rush", "Big Time Rush", { dz: 0, it: 395957106 }],
  ["Game of Thrones", "Main Title Game of Thrones", { dz: 117729426, it: 0 }],
];
// ANN lists a single episode for these, but each was an arc's regular opening.
const KEEP_ONE_EPISODE = new Set(["Kaerimichi", "ambivalent world", "Renai Circulation", "marshmallow justice", "Platinum Disco", "decent black"]);
// AniList entries the site leaves out on purpose: Frieren is first season only, and Boruto isn't Naruto
// (AniList links it as a sequel, which would file its openings under Naruto).
const SKIP_ENTRIES = new Set([182255, 97938]);
// Manual clip fixes after listening, keyed by the song name as AnisongDB spells it:
// { dz: <Deezer track id> } or { it: <Apple track id> } to pin a recording, null to leave the song out.
const CLIP_FIXES = {
  "Ao no Sumika": { dz: 2332722735 },       // Tatsuya Kitani's own release, under its English title "Where Our Blue Is"
  "Renai Circulation": { it: 1439324904 },  // the Bakemonogatari soundtrack's original, credited to "MONOGATARI Series"
  "Hohoemi no Bakudan": { it: 1457287222 }, // the 1992 single; search found Matsuko Mawatari's 2005 self-cover
  "Zankoku na Tenshi no Thesis": { it: 1656737698 }, // the TV-size original; search found a 2015 re-recording
  "OVERLAP": null,                          // only Kimeru's later re-recordings are out there
};

const usersFile = path.join(root, "sources/anilist-users.txt");
const USERS = fs.existsSync(usersFile)
  ? fs.readFileSync(usersFile, "utf8").split(/\r?\n/).map(l => l.trim().replace(/^.*anilist\.co\/user\//i, "").replace(/\/.*$/, "")).filter(Boolean)
  : [];

const cacheFile = path.join(root, "sources/openings-cache.json");
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {};
for (const k of Object.keys(cache)) if (k.startsWith("src:") || k.startsWith("anilist:")) delete cache[k]; // older formats
let dirty = 0;
const saveCache = (force) => { if (force || ++dirty % 25 === 0) { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(cache)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function http(url, opts = {}, tries = 5, text = false) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...opts, headers: { "User-Agent": "KamedlesBuild/1.0", ...(opts.headers || {}) } });
      if (r.status === 429 || r.status === 403 || r.status >= 500) { await sleep(3000 * (i + 1)); continue; }
      if (text) return await r.text();
      const j = await r.json();
      if (j && j.error && /quota/i.test(j.error.message || "")) { await sleep(3000 * (i + 1)); continue; }
      return j;
    } catch (e) { await sleep(1500 * (i + 1)); }
  }
  return null;
}
const cached = async (key, fn) => { if (!(key in cache)) { cache[key] = await fn(); saveCache(); } return cache[key]; };

/* ---------- 1. popular anime from AniList, folded into franchises ---------- */
const MEDIA = `id idMal format season seasonYear startDate { year } endDate { year } popularity synonyms title { english romaji } coverImage { large } studios(isMain: true) { nodes { name } } relations { edges { relationType node { id } } }`;
const anilist = (query, variables) => http("https://graphql.anilist.co", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
const media = new Map();
for (let page = 1; page <= TOP / 50; page++) {
  const j = await cached(`al:top:${page}`, () => anilist(`query($p:Int){Page(page:$p,perPage:50){media(type:ANIME,sort:POPULARITY_DESC,format_in:[TV,TV_SHORT,ONA]){${MEDIA}}}}`, { p: page }));
  for (const m of (j && j.data && j.data.Page.media) || []) if (!SKIP_ENTRIES.has(m.id)) media.set(m.id, m);
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
const missing = [...rated].filter(id => !media.has(id) && !SKIP_ENTRIES.has(id));
for (let i = 0; i < missing.length; i += 50) {
  const ids = missing.slice(i, i + 50);
  const j = await cached(`al:ids:${ids.join(",")}`, () => anilist(`query($ids:[Int]){Page(perPage:50){media(id_in:$ids,type:ANIME){${MEDIA}}}}`, { ids }));
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
const thisYear = new Date().getFullYear();
const shows = [];
for (const [rootId, entries] of franchises) {
  entries.sort((a, b) => (a.seasonYear || 9999) - (b.seasonYear || 9999));
  const first = entries[0];
  const aliases = [...new Set(entries.flatMap(m => [m.title.english, m.title.romaji, ...(m.synonyms || [])]).filter(t => t && /[a-z]/i.test(t) && t.length <= 60))];
  shows.push({ key: `a${rootId}`, name: titleOf(first), aliases: aliases.filter(t => t !== titleOf(first)), year: first.seasonYear, studio: (first.studios.nodes[0] || {}).name || "",
    cover: first.coverImage.large, rated: entries.some(m => rated.has(m.id)),
    entries: entries.map(m => ({ id: m.id, mal: m.idMal, title: titleOf(m), from: m.startDate.year || m.seasonYear || null, to: m.endDate.year || (m.startDate.year ? thisYear : null) })),
    popularity: Math.max(...entries.map(m => m.popularity)) });
}
console.log(`${media.size} anime entries -> ${shows.length} shows (${shows.filter(s => s.rated).length} rated by one of you)`);

/* ---------- 2. openings from AnisongDB, checked against Anime News Network ---------- */
const malToShow = new Map();
for (const s of shows) for (const e of s.entries) if (e.mal) malToShow.set(e.mal, { s, e });
const mals = [...malToShow.keys()];
const amq = new Map();
for (let i = 0; i < mals.length; i += 40) {
  const batch = mals.slice(i, i + 40);
  const key = `anisongdb:${batch.join(",")}`;
  const had = key in cache;
  const rows = await cached(key, () => http("https://anisongdb.com/api/mal_ids_request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mal_ids: batch }) }));
  for (const r of rows || []) {
    const hit = /^Opening \d+/.test(r.songType || "") && malToShow.get(r.linked_ids && r.linked_ids.myanimelist);
    if (!hit || r.isDub || r.isRebroadcast || !/^(TV|ONA)$/.test(r.animeType || "")) continue;
    amq.set(`${r.annId}|${r.annSongId}|${r.songType}`, { ...r, hit });
  }
  if (!had) await sleep(1000);
}
console.log(`${amq.size} openings on AnisongDB`);

const decode = s => s.replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const annIds = [...new Set([...amq.values()].map(r => r.annId))].filter(id => !(`ann:${id}` in cache));
for (let i = 0; i < annIds.length; i += 50) {
  const batch = annIds.slice(i, i + 50);
  const xml = await http(`https://cdn.animenewsnetwork.com/encyclopedia/api.xml?anime=${batch.join("/")}`, {}, 5, true);
  if (!xml) { console.log("  ANN didn't answer — try again later"); continue; }
  const seen = new Set();
  for (const a of xml.split(/<anime /).slice(1)) {
    const id = +/\bid="(\d+)"/.exec(a)[1]; seen.add(id);
    const eps = +((/<info[^>]*type="Number of episodes"[^>]*>(\d+)</.exec(a) || [])[1] || 0) || [...a.matchAll(/<episode num="/g)].length || null;
    const themes = [...a.matchAll(/<info[^>]*type="(Opening Theme|Ending Theme|Insert song)"[^>]*>([^<]*)<\/info>/g)].map(m => [m[1][0], decode(m[2])]);
    cache[`ann:${id}`] = { name: decode((/\bname="([^"]*)"/.exec(a) || [])[1] || ""), eps, themes };
  }
  for (const id of batch) if (!seen.has(id)) cache[`ann:${id}`] = { missing: true };
  saveCache(true);
  await sleep(1200);
}

// Title / name comparison helpers
// Hiragana / katakana -> Hepburn romaji, so "キタニタツヤ" can match "Tatsuya Kitani"
const KANA = Object.fromEntries("あa いi うu えe おo かka きki くku けke こko さsa しshi すsu せse そso たta ちchi つtsu てte とto なna にni ぬnu ねne のno はha ひhi ふfu へhe ほho まma みmi むmu めme もmo やya ゆyu よyo らra りri るru れre ろro わwa ゐi ゑe をo んn がga ぎgi ぐgu げge ごgo ざza じji ずzu ぜze ぞzo だda ぢji づzu でde どdo ばba びbi ぶbu べbe ぼbo ぱpa ぴpi ぷpu ぺpe ぽpo ゔvu"
  .split(" ").map(p => [p[0], p.slice(1)]));
const SMALL = { "ゃ": "ya", "ゅ": "yu", "ょ": "yo", "ぁ": "a", "ぃ": "i", "ぅ": "u", "ぇ": "e", "ぉ": "o", "ゎ": "wa" };
function kana(s) {
  let out = "", double = false;
  for (let ch of s) {
    const c = ch.codePointAt(0);
    if (c >= 0x30a1 && c <= 0x30f6) ch = String.fromCodePoint(c - 0x60); // katakana -> hiragana
    if (ch === "っ") { double = true; continue; }
    if (ch === "ー") continue;
    const small = SMALL[ch];
    if (small && /[a-z]$/.test(out)) {
      out = small[0] === "y" ? (/(sh|ch|j)i$/.test(out) ? out.slice(0, -1) + small[1] : out.slice(0, -1) + small) : out.replace(/[aiueo]$/, "") + small;
      continue;
    }
    const r = KANA[ch];
    if (r && double) out += r[0] === "c" ? "t" : r[0];
    double = false;
    out += r || ch;
  }
  return out;
}
const fold = s => kana(String(s || "").normalize("NFKC")).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/●/g, "o").replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\bver\b/g, "version").replace(/\s+/g, " ").trim();
// romanization differences: Kyousoukyoku = Kyosokyoku, seisyun = seishun, Ootani = Otani
const roma = s => fold(s).replace(/\bwo\b/g, "o").replace(/ou/g, "o").replace(/uu/g, "u").replace(/oo/g, "o")
  .replace(/sy/g, "sh").replace(/ty/g, "ch").replace(/zy/g, "j").replace(/si/g, "shi").replace(/ti/g, "chi").replace(/(?<![st])tu/g, "tsu").replace(/(?<![sc])hu/g, "fu").replace(/zi/g, "ji");
// every reasonable way of writing a title: as given, without bracketed extras / "feat." credits,
// the part before a "~" or " -" subtitle, and the part inside "~ ~"
function variants(t) {
  const out = new Set([t]);
  const noFeat = t.replace(/\s*[(\[]?\s*(feat\.?|ft\.?|featuring|produced by|prod\.)\s[^)\]]*[)\]]?/gi, " ");
  const noParen = noFeat.replace(/\s*[(\[（【][^)\]）】]*[)\]）】]/g, " ");
  const noVer = noParen.replace(/[-~～]\s*[^-~～]*\b(ver|version|edit|size)\.?\s*[-~～]?\s*$/i, " ").replace(/\b(japanese|tv|anime)\s+(ver|version|size)\.?/gi, " ");
  for (const x of [noFeat, noParen, noVer]) out.add(x);
  const head = noParen.split(/\s*[~～]|\s+-\s*|\s-/)[0]; if (roma(head).length >= 3) out.add(head);
  const tilde = /[~～]([^~～]+)[~～]?/.exec(t); if (tilde && roma(tilde[1]).length >= 4) out.add(tilde[1]);
  return [...out].map(roma).filter(Boolean);
}
function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[b.length];
}
const sim = (a, b) => { const A = a.replace(/ /g, ""), B = b.replace(/ /g, ""); return A === B ? 1 : 1 - lev(A, B) / Math.max(A.length, B.length); };
const titleSim = (a, keys) => { let best = 0; for (const x of variants(a)) for (const y of keys) best = Math.max(best, sim(x, y)); return best; };
const nameWords = s => new Set(fold(s).split(" ").filter(w => w.length > 1 && !/^(and|feat|ft|with|by|the|from|x|cv|vo)$/.test(w)));
const artistSim = (a, b) => { const A = nameWords(a), B = nameWords(b); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size); };

// '#2: "Galaxy Anthem" (ギャラクシー) by Kairi Yagi (eps 7-8)' -> number, title, other titles, artist, episode count
function parseTheme(raw) {
  let s = raw.trim(), num = null;
  const m1 = /^#\s*(\d+)\s*[:.]?\s*/.exec(s) || /^(\d+)\s*[:.]\s*/.exec(s);
  if (m1) { num = +m1[1]; s = s.slice(m1[0].length); }
  let title = null, alts = [];
  const q = /^["“]([^"”]+)["”]/.exec(s);
  if (q) { title = q[1]; s = s.slice(q[0].length); }
  const alt = /^\s*\(([^)]*)\)/.exec(s);
  if (q && alt && !/\bby\b/.test(alt[1])) { alts = alt[1].split(/;/).map(x => x.replace(/["“”]/g, "").trim()).filter(Boolean); s = s.slice(alt[0].length); }
  if (!title) { const b = /^(.*?)\s+by\s+/i.exec(s); title = b ? b[1].replace(/["“”]/g, "") : s; s = b ? s.slice(b[1].length) : ""; }
  const inner = /\(([^)]*)\)/.exec(title); if (inner) alts.push(...inner[1].split(/;/).map(x => x.replace(/["“”]/g, "").trim()).filter(Boolean));
  const by = /\bby\s+(.*)$/i.exec(s);
  let artist = by ? by[1] : "", eps = null;
  const epm = /\(([^()]*\beps?\.?\s*\d[^()]*)\)/i.exec(artist) || /\(([^()]*\beps?\.?\s*\d[^()]*)\)/i.exec(s);
  if (epm) {
    artist = artist.replace(epm[0], "").trim();
    let n = 0;
    for (const part of epm[1].replace(/^.*?\beps?\.?\s*/i, "").split(/,|&|\band\b/)) {
      const r = /(\d+)\s*(?:-\s*(\d*))?/.exec(part); if (!r) continue;
      n += r[2] === "" ? 99 : r[2] ? Math.max(1, +r[2] - +r[1] + 1) : 1;
    }
    eps = n || null;
  }
  return { num, title: title.trim(), alts, keys: [...variants(title), ...alts.flatMap(variants)], artist: artist.replace(/["“”]\s*$/, "").trim(), eps, dub: /\bdub\b|english ver|\(english\)/i.test(raw), raw };
}

const byAnn = new Map();
for (const r of amq.values()) { if (!byAnn.has(r.annId)) byAnn.set(r.annId, []); byAnn.get(r.annId).push(r); }
const songs = [], dropped = [];
for (const [id, list] of byAnn) {
  list.sort((a, b) => +/\d+/.exec(a.songType)[0] - +/\d+/.exec(b.songType)[0]);
  const ann = cache[`ann:${id}`] || {};
  const themes = (ann.themes || []).filter(t => t[0] === "O").map(t => parseTheme(t[1])).filter(t => !t.dub);
  const keep = new Map(); // AnisongDB row -> ANN theme it matched (null = kept without one)
  if (!themes.length) {
    // ANN has no theme info for a handful of shows: trust AnisongDB only when it lists a single, ordinary opening
    if (list.length === 1 && list[0].songCategory === "Standard") keep.set(list[0], null);
    else for (const r of list) dropped.push([r, "ANN has no opening list for this show"]);
  } else {
    const pairs = [];
    for (const r of list) for (const t of themes) {
      const ts = titleSim(r.songName, t.keys), as = artistSim(r.songArtist, t.artist), n = +/\d+/.exec(r.songType)[0];
      const soleArtist = as >= 0.5 && list.filter(o => artistSim(o.songArtist, t.artist) >= 0.5).length === 1 && themes.filter(o => artistSim(r.songArtist, o.artist) >= 0.5).length === 1;
      if (ts >= 0.8 || (ts >= 0.45 && as >= 0.5) || soleArtist || (t.num === n && as >= 0.5)) pairs.push({ r, t, score: ts + (as >= 0.5 ? 0.25 : 0) + (t.num === n ? 0.1 : 0) });
    }
    pairs.sort((a, b) => b.score - a.score);
    const usedT = new Set();
    for (const p of pairs) if (!keep.has(p.r) && !usedT.has(p.t)) { keep.set(p.r, p.t); usedT.add(p.t); }
    // ANN hasn't caught up with the newest openings of long runners whose numbering matches AnisongDB's exactly
    const matched = [...keep].filter(([, t]) => t);
    const aligned = matched.length >= 3 && matched.every(([r, t]) => t.num === +/\d+/.exec(r.songType)[0]);
    const maxNum = Math.max(0, ...themes.map(t => t.num || 0));
    for (const r of list) if (!keep.has(r) && aligned && +/\d+/.exec(r.songType)[0] > maxNum) keep.set(r, null);
    for (const r of list) {
      const t = keep.get(r);
      if (!keep.has(r)) dropped.push([r, pairs.some(p => p.r === r) ? "another version of an opening that's already in" : `not an opening per ANN (${themes.map(x => x.title).join(" / ")})`]);
      else if (t && t.eps === 1 && (ann.eps || 99) > 2 && !KEEP_ONE_EPISODE.has(r.songName)) { keep.delete(r); dropped.push([r, `one-episode special (${t.raw})`]); }
    }
  }
  // AnisongDB numbers every song used as an opening; the real numbering skips the ones dropped above
  let skipped = 0;
  for (const r of list) {
    if (!keep.has(r)) { skipped++; continue; }
    const t = keep.get(r), { s, e } = r.hit;
    songs.push({ show: s, entry: e.title, from: e.from, to: e.to, n: +/\d+/.exec(r.songType)[0] - skipped, song: r.songName, artist: r.songArtist,
      names: (r.artists || []).flatMap(a => a.names || []), titles: t ? [t.title, ...t.alts] : [], annArtist: t ? t.artist : "",
      diff: r.songDifficulty == null ? null : Math.round(r.songDifficulty), len: r.songLength || null });
  }
}
console.log(`${songs.length} checked openings (${dropped.length} dropped as specials, insert songs or duplicates)`);

/* ---------- 3. match each opening to the original recording on Deezer / Apple Music ---------- */
// Anything in brackets or after a dash that isn't one of these means a different recording or edit
const HARMFUL = /\b(live|remix\w*|rmx|cover\w*|self ?cover|karaoke|instrumental|inst|off ?vocal|acoustic|unplugged|piano|orchestr\w*|symphon\w*|8 ?bit|lo ?fi|music ?box|lullaby|sped|slowed|nightcore|demo|re ?arrange\w*|re ?record\w*|new|remake|band|rock|jazz|dance|trap|english|korean|chinese|spanish|french|cappella|chorus|duet|solo|club|extended|reprise|vocaloid|guitar|bootleg|session|studio|dj|anniversary|celebration|christmas|ballad|\d+th|rearrange\w*|first ?take|another)\b|\b(19|20)\d\d\b|years?\s*later|セルフカバー|カバー|ライブ|リミックス/i;
const HARMLESS = /\b(tv|anime|animation|op|opening|intro|short|single|theme|main title|from|feat|ft|featuring|with|prod|produced|original|remaster\w*|explicit|clean|size|edit|edition)\b|アニメ|サイズ|オープニング|主題歌/i;
const BAD_ALBUM = /\b(live|tour|arena|dome|budokan|concert|bootleg|remix\w*|self ?cover\w*|re ?record\w*|acoustic|unplugged|symphon\w*|orchestr\w*|piano|instrumental|karaoke|off vocal|lullaby|music box|8 ?bit|covers?|tribute|nightcore|lo ?fi|sped up|slowed|chill|relax\w*|jazz|guitar|kids|baby|workout|party|hits)\b|セルフカバー|ライブ|カバー/i;
const TVISH = /\b(tv|anime|animation|op|opening|intro|short)\b|アニメ|サイズ|オープニング/i;
function decorations(title) {
  let base = String(title); const decos = [];
  base = base.replace(/\s*[(\[（【「]([^)\]）】」]*)[)\]）】」]/g, (m, d) => { decos.push(d); return " "; });
  base = base.replace(/\s+((?:tv|anime|op|opening)[\s-]*(?:size|ver\.?|version|edit|edition|mix)(?:\s*ver(?:sion)?\.?)?)\s*$/i, (m, d) => { decos.push(d); return ""; });
  for (let guard = 0; guard < 3; guard++) {
    const m = /\s+[-–—~～:]\s*([^-–—~～:]+?)\s*[-–—~～]?\s*$/.exec(base) || /\s*[~～]\s*([^~～]+?)\s*[~～]?\s*$/.exec(base);
    if (!m || fold(base.slice(0, m.index)).length < 2) break;
    decos.push(m[1]); base = base.slice(0, m.index);
  }
  return { base, decos: decos.map(d => d.trim()).filter(Boolean) };
}
function titleCheck(candTitle, want) {
  const keys = new Set([...variants(want.song), ...want.titles.flatMap(variants)]);
  const loose = s => roma(s).replace(/ /g, "");
  const looseKeys = new Set([...keys].map(k => k.replace(/ /g, "")));
  // the real title's own qualifier ("departure! -second version-", "We Are!~7-nin no ...") has to be there too
  for (const q of decorations(want.song).decos) {
    if (/\b(ver|version|mix|remix|edit|arrange\w*|style|take|band|acoustic|live)\b|\d/i.test(q) && !HARMLESS.test(q) && !loose(candTitle).includes(loose(q))) return { ok: false };
  }
  if (looseKeys.has(loose(candTitle))) return { ok: true, tv: false, plain: true };
  const { base, decos } = decorations(candTitle);
  if (!looseKeys.has(loose(base))) return { ok: false };
  const wantWords = new Set([...keys].join(" ").split(" "));
  const showWords = new Set([want.show.name, ...want.show.aliases, want.entry].flatMap(x => fold(x).split(" ")).filter(w => w.length >= 4));
  for (const d of decos) {
    const f = fold(d);
    if (f && f.split(" ").every(w => wantWords.has(w))) continue; // part of the real title
    if (HARMFUL.test(d) || HARMFUL.test(f)) return { ok: false };
    if (/\bmix\b/.test(f) && !TVISH.test(d)) return { ok: false };
    if (!HARMLESS.test(d) && !HARMLESS.test(f) && !f.split(" ").some(w => showWords.has(w))) return { ok: false };
  }
  return { ok: true, tv: decos.some(d => TVISH.test(d) || /\bsize|edit\b/i.test(d)), plain: false };
}
// performer names: "Vivy (CV: Kairi Yagi)" -> Vivy, Kairi Yagi; "MAN WITH A MISSION × milet" -> both
const SPLIT = /\s*(?:,|、|&|＆|\+|×|\/|\bx\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\band\b)\s*/i;
function performerNames(list) {
  const out = new Set();
  for (const raw of list) for (const part of String(raw || "").split(SPLIT)) {
    const inner = [...part.matchAll(/[(\[（]([^)\]）]*)[)\]）]/g)].map(m => m[1].replace(/^(cv|vo|from)[.:]?\s*/i, ""));
    for (const x of [part.replace(/[(\[（][^)\]）]*[)\]）]/g, " "), ...inner]) { const f = roma(x); if (f && !/^(cv|vo)$/.test(f)) out.add(f); }
  }
  return [...out];
}
function sameName(a, b) {
  if (a === b || a.replace(/ /g, "") === b.replace(/ /g, "")) return true;
  const A = a.split(" "), B = b.split(" ");
  if (A.length > 1 && A.length === B.length && A.every(w => B.includes(w))) return true; // "Yonezu Kenshi"
  if ((B.length === 2 && B[1] + B[0] === A.join("")) || (A.length === 2 && A[1] + A[0] === B.join(""))) return true; // "キタニタツヤ"
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return (s.includes(" ") || s.length >= 5) && ` ${l} `.includes(` ${s} `);
}
function artistCheck(candArtists, want) {
  const credited = performerNames([want.artist, ...want.names, want.annArtist]);
  const lead = performerNames([String(want.artist).split(SPLIT)[0]]);
  const got = performerNames(candArtists);
  return { ok: got.some(g => credited.some(c => sameName(g, c))), lead: got.some(g => lead.some(c => sameName(g, c))) };
}
const isrcYear = isrc => { const m = /^[A-Z]{2}[A-Z0-9]{3}(\d\d)/.exec(isrc || ""); return m ? (+m[1] > 50 ? 1900 : 2000) + +m[1] : null; };

let dzGate = Promise.resolve(), itGate = Promise.resolve();
const gate = (g, ms) => { const p = g.then(() => sleep(ms)); return [p, p]; };
const deezerSearch = q => cached(`dz:q:${q}`, async () => {
  let p; [dzGate, p] = gate(dzGate, 130); await p;
  const d = await http(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=25`);
  return ((d && d.data) || []).filter(t => t.preview).map(t => ({ id: t.id, title: t.title_version && !t.title.includes(t.title_version) ? `${t.title} ${t.title_version}` : t.title, artist: t.artist && t.artist.name, album: t.album && t.album.title, sec: t.duration, rank: t.rank || 0 }));
});
const deezerTrack = id => cached(`dz:t:${id}`, async () => {
  let p; [dzGate, p] = gate(dzGate, 130); await p;
  const t = await http(`https://api.deezer.com/track/${id}`);
  return t && t.id ? { isrc: t.isrc || "", people: (t.contributors || []).map(c => c.name), released: (t.release_date || "").slice(0, 4) } : null;
});
const appleSearch = q => cached(`it:q:${q}`, async () => {
  let p; [itGate, p] = gate(itGate, 4000); await p;
  const d = await http(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=25&country=US`);
  return ((d && d.results) || []).filter(t => t.previewUrl).map(t => ({ id: t.trackId, title: t.trackName, artist: t.artistName, album: t.collectionName, sec: Math.round((t.trackTimeMillis || 0) / 1000), year: +(t.releaseDate || "").slice(0, 4) || null }));
});
function screen(list, want, extraArtists = () => []) {
  const out = [];
  for (const c of list) {
    const tc = titleCheck(c.title, want); if (!tc.ok) continue;
    const albumRest = fold(c.album).replace(new RegExp(`\\b(${[...new Set([...variants(want.song)])].map(k => k.replace(/[^\p{L}\p{N} ]/gu, "")).filter(Boolean).join("|")})\\b`, "gu"), " ");
    if (BAD_ALBUM.test(albumRest) || /セルフカバー|ライブ|カバー/.test(c.album || "")) continue;
    const ac = artistCheck([c.artist, ...extraArtists(c)], want); if (!ac.ok) continue;
    const tvLength = want.len && c.sec && Math.abs(c.sec - want.len) <= 5;
    out.push({ ...c, lead: ac.lead, tv: tc.tv || tvLength, plain: tc.plain });
  }
  return out;
}
// credited lead artist first, then anything released well after the show ran loses (re-recordings),
// then TV-size edits, then the earliest recording
async function resolve(want) {
  const late = c => (c.year && want.to && c.year > want.to + 1 ? 1 : 0);
  const byPreference = (a, b) => (b.lead - a.lead) || (late(a) - late(b)) || ((b.tv ? 1 : 0) - (a.tv ? 1 : 0)) || ((a.year || 9999) - (b.year || 9999)) || (b.plain - a.plain) || (b.rank || 0) - (a.rank || 0);
  const lead = String(want.artist).split(SPLIT)[0].replace(/[(\[（][^)\]）]*[)\]）]/g, " ").trim();
  // the title as AnisongDB spells it, then the other titles ANN lists (Japanese script, English)
  const others = want.titles.filter(t => roma(t).replace(/ /g, "") !== roma(want.song).replace(/ /g, "")).slice(0, 2);
  for (const q of [`${lead} ${want.song}`, want.song, ...others.map(t => `${lead} ${t}`)]) {
    let found = screen(await deezerSearch(q), want);
    if (!found.length) continue;
    // contributor lists, and the ISRC year so re-recordings lose to the original
    found = found.sort(byPreference).slice(0, 4);
    for (const c of found) { const t = await deezerTrack(c.id); if (t) { c.people = t.people; c.year = isrcYear(t.isrc) || +t.released || null; } }
    const best = found.filter(c => artistCheck([c.artist, ...(c.people || [])], want).ok).sort(byPreference)[0];
    if (best) return { dz: best.id, it: 0, pick: best };
  }
  for (const q of [`${lead} ${want.song}`, ...others.slice(0, 1).map(t => `${lead} ${t}`)]) {
    const best = screen(await appleSearch(q), want, c => String(c.artist).split(SPLIT)).sort(byPreference)[0];
    if (best) return { dz: 0, it: best.id, pick: best };
  }
  return null;
}

const themes = [], noClip = [];
let done = 0;
const queue = songs.slice();
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const s = queue.shift();
    const fix = CLIP_FIXES[s.song];
    const src = fix === null ? null : fix ? { dz: fix.dz || 0, it: fix.it || 0, pick: { title: "(pinned)", artist: "", album: "" } } : await resolve(s);
    if (src) themes.push({ ...s, ...src }); else noClip.push(s);
    if (++done % 100 === 0) console.log(`  ${done}/${songs.length} checked, ${themes.length} with an original recording`);
  }
}));
saveCache(true);
for (const [name, song, src] of WESTERN) {
  const show = { name, aliases: [], year: null, studio: "", cover: "", rated: true, western: true, entries: [], popularity: 0 };
  shows.push(show);
  themes.push({ show, entry: name, n: 1, song, artist: "", diff: null, ...src, pick: { title: "(pinned)", artist: "", album: "" } });
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
  "// Generated by tools/build-openings.mjs — shows from AniList, opening lists from AnisongDB checked against\n" +
  "// Anime News Network, clips are Deezer / Apple Music previews of the original recordings.\n" +
  "window.DLE = window.DLE || {};\nwindow.DLE.openings = " + JSON.stringify(out) + ";\n");

const late = t => t.pick && t.pick.year && t.to && t.pick.year > t.to + 1;
const line = t => `${t.show.name} · ${t.entry} · Opening ${t.n} "${t.song}" — ${t.artist}`;
fs.writeFileSync(path.join(root, "sources/openings-review.txt"), [
  `KEPT (${themes.length}) — ! marks a recording released well after the show aired`,
  ...themes.slice().sort((a, b) => line(a).localeCompare(line(b))).map(t => `${late(t) ? "!" : " "} ${line(t)}\n      ${t.dz ? `DZ ${t.dz}` : `IT ${t.it}`} "${t.pick.title}" by ${t.pick.artist}${t.pick.people && t.pick.people.length > 1 ? ` (${t.pick.people.join(", ")})` : ""} | ${t.pick.album} | ${t.pick.sec || "?"}s | ${t.pick.year || "?"}`),
  "", `NO ORIGINAL RECORDING FOUND (${noClip.length})`, ...noClip.map(t => `  ${line(t)}`).sort(),
  "", `DROPPED (${dropped.length})`, ...dropped.map(([r, why]) => `  ${r.animeENName} · ${r.songType} "${r.songName}" — ${r.songArtist}: ${why}`).sort(),
].join("\n") + "\n");
console.log(`wrote data/openings.js: ${out.shows.length} shows, ${out.themes.length} openings (${out.themes.filter(t => used[t.s].rated).length} from shows one of you rated); ${themes.filter(late).length} flagged late in sources/openings-review.txt`);
