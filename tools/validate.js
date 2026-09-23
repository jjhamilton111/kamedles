#!/usr/bin/env node
// Validates one or more Animedle series data files against DATA_SPEC.md
const path = require("path");
const HAIR = new Set(["Black","Brown","Blonde","White","Grey","Red","Orange","Pink","Purple","Blue","Green","Bald","Other"]);
const GENDER = new Set(["Male","Female","Other"]);

const MAX_QUOTES = 6;
// Title / common-word tokens that don't give a character away on their own ("Fire Lord Ozai" -> only "ozai").
const NAME_STOP = new Set(("the and of von van der den del des los las san la le da di du el al " +
  "lord lady king queen prince princess emperor empress sir dame master captain general commander chief " +
  "doctor professor uncle aunt mrs miss mister big little old young great grand elder fire earth water air " +
  "red blue green yellow pink black white gold silver purple orange first second third one two three " +
  "man woman girl boy kid baby mad team devil fiend hero pirate principal maester sister mom dad").split(" "));
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const hasPhrase = (text, phrase) => !!phrase && ` ${text} `.includes(` ${phrase} `);
// Does a quote/hint give away whose it is? Errors: the name, a name word, or an alias appears verbatim.
// Warning: every word of a multi-word alias appears somewhere (e.g. "Zeo Ranger One, Pink!" vs "Pink Zeo Ranger").
function selfNameHits(text, c) {
  const t = norm(text), hits = [];
  const name = norm(c.name);
  // a one-letter name (Naruto's "A") can't be told apart from the word "a"
  if (name.length > 1 && hasPhrase(t, name)) return [["error", `contains their name "${c.name}"`]];
  for (const w of name.split(" ")) if (w.length >= 3 && !NAME_STOP.has(w) && hasPhrase(t, w)) hits.push(["error", `contains part of their name ("${w}")`]);
  for (const a of c.aliases || []) {
    const na = norm(a);
    if (na.length < 2) continue;
    if (hasPhrase(t, na)) { hits.push(["error", `contains their alias "${a}"`]); continue; }
    const ws = na.split(" ").filter(w => !["the", "of", "a"].includes(w));
    if (ws.length > 1 && ws.every(w => hasPhrase(t, w))) hits.push(["warn", `contains every word of their alias "${a}"`]);
  }
  return hits;
}

function countEmoji(s) {
  // count grapheme clusters
  const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
  return [...seg.segment(s)].length;
}

let totalErrors = 0;
for (const file of process.argv.slice(2)) {
  const errors = [], warns = [];
  global.window = {};
  try { require(path.resolve(file)); } catch (e) { console.log(`${file}: FAILED TO LOAD: ${e.message}`); totalErrors++; continue; }
  const series = window.DLE && window.DLE.series ? Object.values(window.DLE.series) : [];
  if (series.length !== 1) { console.log(`${file}: expected exactly 1 series, found ${series.length}`); totalErrors++; continue; }
  const s = series[0];
  const slug = path.basename(file).replace(/\.js$/, "");
  if (s.id !== slug) errors.push(`id "${s.id}" != filename slug "${slug}"`);
  for (const k of ["title","short","cutoff","affiliationLabel","powerLabel"]) if (typeof s[k] !== "string" || !s[k]) errors.push(`missing string field ${k}`);
  for (const k of ["affiliations","powers","arcs","characters"]) if (!Array.isArray(s[k]) || !s[k].length) errors.push(`missing array field ${k}`);
  if (errors.length) { console.log(`${file}:\n  - ` + errors.join("\n  - ")); totalErrors += errors.length; continue; }
  const aff = new Set(s.affiliations), pow = new Set(s.powers), arcs = new Set(s.arcs);
  const hairSet = Array.isArray(s.hairVocab) && s.hairVocab.length ? new Set(s.hairVocab) : HAIR;
  const maxPower = Number.isInteger(s.maxPower) ? s.maxPower : 2;
  const ids = new Set(), names = new Set();
  const usedAff = new Set(), usedPow = new Set(), usedArc = new Set();
  let quotes = 0, quoted = 0, nullAges = 0;
  const seenQuotes = new Map();
  for (const c of s.characters) {
    const tag = c.id || c.name || "?";
    if (!c.id || !/^[a-z0-9-]+$/.test(c.id)) errors.push(`${tag}: bad id`);
    if (ids.has(c.id)) errors.push(`${tag}: duplicate id`); ids.add(c.id);
    if (!c.name) errors.push(`${tag}: missing name`);
    if (names.has((c.name||"").toLowerCase())) errors.push(`${tag}: duplicate name`); names.add((c.name||"").toLowerCase());
    if (!Array.isArray(c.aliases)) errors.push(`${tag}: aliases must be array`);
    if (!GENDER.has(c.gender)) errors.push(`${tag}: bad gender "${c.gender}"`);
    if (!hairSet.has(c.hair)) errors.push(`${tag}: bad ${s.hairLabel || "hair"} "${c.hair}"`);
    if (c.img != null && typeof c.img !== "string") errors.push(`${tag}: img must be a string URL/path or absent`);
    if (c.wiki != null && typeof c.wiki !== "string") errors.push(`${tag}: wiki must be a string`);
    if (!Array.isArray(c.affiliation) || c.affiliation.length < 1 || c.affiliation.length > 3) errors.push(`${tag}: affiliation must have 1-3 entries`);
    else for (const a of c.affiliation) { if (!aff.has(a)) errors.push(`${tag}: affiliation "${a}" not in vocab`); usedAff.add(a); }
    if (!(c.age === null || (Number.isInteger(c.age) && c.age >= 0))) errors.push(`${tag}: age must be integer or null`);
    if (c.age === null) nullAges++;
    if (!Array.isArray(c.power) || c.power.length < 1 || c.power.length > maxPower) errors.push(`${tag}: power must have 1-${maxPower} entries`);
    else for (const p of c.power) { if (!pow.has(p)) errors.push(`${tag}: power "${p}" not in vocab`); usedPow.add(p); }
    if (!arcs.has(c.debut)) errors.push(`${tag}: debut "${c.debut}" not in arcs`); usedArc.add(c.debut);
    if ("quote" in c) errors.push(`${tag}: "quote" was replaced by "quotes" (an array)`);
    if (!Array.isArray(c.quotes)) errors.push(`${tag}: quotes must be an array (may be empty)`);
    else {
      if (c.quotes.length) quoted++;
      if (c.quotes.length > MAX_QUOTES) errors.push(`${tag}: ${c.quotes.length} quotes (max ${MAX_QUOTES})`);
      const own = new Set();
      for (const q of c.quotes) {
        if (typeof q !== "string" || !q.trim()) { errors.push(`${tag}: every quote must be a non-empty string`); continue; }
        quotes++;
        const words = q.trim().split(/\s+/).length;
        if (words > 15) errors.push(`${tag}: quote is ${words} words (max 15): "${q}"`);
        const key = norm(q);
        if (own.has(key)) errors.push(`${tag}: duplicate quote "${q}"`); own.add(key);
        if (seenQuotes.has(key) && seenQuotes.get(key) !== c.id) errors.push(`${tag}: quote also used by ${seenQuotes.get(key)}: "${q}"`);
        seenQuotes.set(key, c.id);
        for (const [level, msg] of selfNameHits(q, c)) (level === "error" ? errors : warns).push(`${tag}: quote ${msg}: "${q}"`);
      }
    }
    if (typeof c.hint === "string") for (const [, msg] of selfNameHits(c.hint, c)) warns.push(`${tag}: hint ${msg}`);
    if (!Array.isArray(c.emojis) || c.emojis.length !== 5) errors.push(`${tag}: emojis must have exactly 5`);
    else for (const e of c.emojis) {
      if (typeof e !== "string" || countEmoji(e) !== 1) errors.push(`${tag}: emoji entry "${e}" is not a single emoji`);
      if (/[A-Za-z0-9]/.test(e)) errors.push(`${tag}: emoji entry "${e}" contains letters/digits`);
    }
    if (typeof c.hint !== "string" || !c.hint.trim()) errors.push(`${tag}: missing hint`);
    const lower = JSON.stringify([c.hint, ...(c.quotes || [])]).toLowerCase();
    if (/\b(dead|dies|died|killed|deceased|alive)\b/.test(lower)) warns.push(`${tag}: hint/quote mentions death/alive status`);
  }
  const n = s.characters.length;
  if (n < 30) errors.push(`only ${n} characters (need 36-48)`);
  if (n > 70) warns.push(`${n} characters (large cast)`);
  for (const a of s.affiliations) if (!usedAff.has(a)) warns.push(`unused affiliation vocab "${a}"`);
  for (const p of s.powers) if (!usedPow.has(p)) warns.push(`unused power vocab "${p}"`);
  for (const a of s.arcs) if (!usedArc.has(a)) warns.push(`no character debuts in arc "${a}"`);
  if (quoted / n < 0.6) warns.push(`quote coverage ${quoted}/${n} is low (aim >= 70%)`);
  console.log(`${file}: ${n} characters, ${quoted} with quotes (${quotes} quotes total), ${nullAges} null ages, ${errors.length} errors, ${warns.length} warnings`);
  if (errors.length) console.log("  ERRORS:\n  - " + errors.join("\n  - "));
  if (warns.length) console.log("  WARNINGS:\n  - " + warns.join("\n  - "));
  totalErrors += errors.length;
}
process.exit(totalErrors ? 1 : 0);
