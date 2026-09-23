/* Kamedles — anime character guessing game. Plain JS, no build step. */
(() => {
"use strict";

const APP = { name: "Kamedles", epoch: "2026-09-22", storeKey: "kamedles.v1", emojiStart: 2, revealAfter: 6 };
const D = window.DLE || { series: {} };
D.series = D.series || {};
const META = D.meta || {};
const ORDER = (D.order || Object.keys(D.series)).filter(id => D.series[id]);
const DEFAULT_ACCENT = "#ff8a3d";
const GROUPS = (D.groups && D.groups.length ? D.groups : [{ label: "Series", ids: ORDER }])
  .map(g => ({ label: g.label, ids: g.ids.filter(id => D.series[id]) })).filter(g => g.ids.length);
const MODES = [
  { id: "classic", label: "Classic", blurb: "Guess by attributes" },
  { id: "quote", label: "Quote", blurb: "Who said it?" },
  { id: "emoji", label: "Emoji", blurb: "Five emojis, one character" },
];
const modeById = id => MODES.find(m => m.id === id) || MODES[0];
const HINTS = {
  quote: [
    { after: 2, label: s => s.affiliationLabel, value: c => c.affiliation.join(" · ") },
    { after: 4, label: s => s.powerLabel, value: c => c.power.join(" · ") },
    { after: 6, label: () => "Debut", value: c => c.debut },
    { after: 8, label: () => "Hint", value: c => c.hint },
  ],
  emoji: [
    { after: 4, label: s => s.affiliationLabel, value: c => c.affiliation.join(" · ") },
    { after: 6, label: s => s.powerLabel, value: c => c.power.join(" · ") },
    { after: 8, label: () => "Hint", value: c => c.hint },
  ],
};

/* ---------- helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
function h(tag, attrs, ...children) {
  const n = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "style" && typeof v === "object") { for (const [sk, sv] of Object.entries(v)) sk.startsWith("--") ? n.style.setProperty(sk, sv) : (n.style[sk] = sv); }
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) { if (c == null || c === false) continue; n.append(c instanceof Node ? c : document.createTextNode(String(c))); }
  return n;
}
const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
const IMG = window.DLE && window.DLE.img || {};
function imgSrc(c) { const m = game && IMG[game.seriesId]; return (m && m[c.id]) || c.img || null; }
function avatar(c, extra = "") {
  const src = imgSrc(c), box = h("span", { class: `avatar${extra ? " " + extra : ""}` });
  if (src) {
    const img = h("img", { src, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer", draggable: "false" });
    img.addEventListener("error", () => { box.classList.add("noimg"); box.replaceChildren(initials(c.name)); });
    box.append(img);
  } else { box.classList.add("noimg"); box.append(initials(c.name)); }
  return box;
}
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function seededShuffle(arr, seed) { const rng = mulberry32(seed); const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function dayIndex(date = new Date()) { const start = new Date(APP.epoch + "T00:00:00"); const today = new Date(date.getFullYear(), date.getMonth(), date.getDate()); return Math.round((today - start) / 86400000); }
function fmtDay(day) { const d = new Date(APP.epoch + "T00:00:00"); d.setDate(d.getDate() + day); return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); }
function msToMidnight() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1) - n; }
function fmtCountdown(ms) { const s = Math.max(0, Math.floor(ms / 1000)); const p = x => String(x).padStart(2, "0"); return `${p(Math.floor(s / 3600))}:${p(Math.floor(s % 3600 / 60))}:${p(s % 60)}`; }
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : (w.endsWith("s") ? "es" : "s")}`;

/* ---------- storage ---------- */
let S = loadState();
function loadState() {
  try { const s = JSON.parse(localStorage.getItem(APP.storeKey) || "{}"); return { games: s.games || {}, stats: s.stats || {}, prefs: s.prefs || {} }; }
  catch (e) { return { games: {}, stats: {}, prefs: {} }; }
}
function saveState() { try { localStorage.setItem(APP.storeKey, JSON.stringify(S)); } catch (e) { /* storage unavailable */ } }

/* ---------- game model ---------- */
let game = null;
const view = { seriesId: null, mode: MODES.some(m => m.id === S.prefs.mode) ? S.prefs.mode : "classic", unlimited: false };

function poolFor(series, mode) { return mode === "quote" ? series.characters.filter(c => c.quote) : series.characters; }
function dailyAnswer(series, mode, day) {
  const p = poolFor(series, mode), n = p.length;
  const cycle = Math.floor(day / n), idx = ((day % n) + n) % n;
  return seededShuffle(p, cyrb53(`${series.id}|${mode}|${cycle}`) >>> 0)[idx];
}
const gameKey = (seriesId, mode, day) => `${seriesId}:${mode}:${day}`;
const dailyRecord = (seriesId, mode, day) => S.games[gameKey(seriesId, mode, day)] || null;
const charById = (series, id) => series.characters.find(c => c.id === id);

function startGame(seriesId, mode, unlimited, avoidId) {
  const series = D.series[seriesId], day = dayIndex(), p = poolFor(series, mode);
  let answer, key = null, saved = null;
  if (unlimited) { do { answer = p[Math.floor(Math.random() * p.length)]; } while (p.length > 1 && answer.id === avoidId); }
  else { answer = dailyAnswer(series, mode, day); key = gameKey(seriesId, mode, day); saved = S.games[key]; }
  const ids = new Set(series.characters.map(c => c.id));
  game = { seriesId, series, mode, unlimited, day, answer, key,
    guesses: saved ? saved.guesses.filter(id => ids.has(id)) : [],
    revealed: saved && Array.isArray(saved.hints) ? saved.hints.slice() : [],
    solved: !!(saved && saved.solved), gaveUp: !!(saved && saved.gaveUp), rounds: game && game.unlimited && unlimited ? game.rounds : 0 };
  return game;
}
const wrongCount = () => game.guesses.filter(id => id !== game.answer.id).length;
const isOver = () => game.solved || game.gaveUp;

function persistGame(outcome) {
  if (game.unlimited) return;
  S.games[game.key] = { guesses: game.guesses, solved: game.solved, gaveUp: game.gaveUp, hints: game.revealed };
  if (outcome) {
    const k = `${game.seriesId}:${game.mode}`;
    const st = S.stats[k] || (S.stats[k] = { played: 0, won: 0, streak: 0, max: 0, lastDay: null, dist: {} });
    st.played++;
    if (outcome === "win") {
      st.won++; st.streak = st.lastDay === game.day - 1 ? st.streak + 1 : 1; st.max = Math.max(st.max, st.streak);
      const n = game.guesses.length; st.dist[n] = (st.dist[n] || 0) + 1;
    } else st.streak = 0;
    st.lastDay = game.day;
  }
  saveState();
}

/* ---------- classic comparison ---------- */
function columns(series) {
  return [
    { key: "name", label: "Character", type: "name" },
    { key: "gender", label: "Gender", type: "exact" },
    { key: "hair", label: series.hairLabel || "Hair", type: "exact" },
    { key: "affiliation", label: series.affiliationLabel, type: "set" },
    !series.hideAge && { key: "age", label: "Age", type: "number" },
    { key: "power", label: series.powerLabel, type: "set" },
    { key: "debut", label: "Debut", type: "ordinal" },
  ].filter(Boolean);
}
function compare(col, guess, answer, series) {
  switch (col.type) {
    case "exact": return { state: guess[col.key] === answer[col.key] ? "ok" : "bad" };
    case "set": {
      const g = guess[col.key] || [], a = answer[col.key] || [];
      if (g.length === a.length && g.every(x => a.includes(x))) return { state: "ok" };
      return { state: g.some(x => a.includes(x)) ? "part" : "bad" };
    }
    case "number": {
      const g = guess.age, a = answer.age;
      if (g == null || a == null) return { state: g == null && a == null ? "ok" : "unk" };
      if (g === a) return { state: "ok" };
      return { state: "bad", arrow: a > g ? "up" : "down" };
    }
    case "ordinal": {
      const gi = series.arcs.indexOf(guess.debut), ai = series.arcs.indexOf(answer.debut);
      if (gi === ai) return { state: "ok" };
      return { state: "bad", arrow: ai > gi ? "up" : "down" };
    }
    default: return { state: "name" };
  }
}
const ARROW = { number: { up: "▲ older", down: "▼ younger" }, ordinal: { up: "▲ later", down: "▼ earlier" } };

/* ---------- accent + routing ---------- */
function setAccent(seriesId) {
  document.documentElement.style.setProperty("--accent", (seriesId && META[seriesId] && META[seriesId].accent) || DEFAULT_ACCENT);
}
function setHash(hash) { try { history.replaceState(null, "", hash ? `#${hash}` : location.pathname + location.search); } catch (e) { /* ignore */ } }

/* ---------- top bar ---------- */
const TABS = [{ id: "characters", label: "Characters", home: () => renderHome(), help: () => openHelp() }];
let currentTab = "characters";
function registerTab(tab) { TABS.push(tab); }
function topBar(opts = {}) {
  if (typeof opts === "boolean") opts = { stats: opts ? openStats : null };
  const tabId = opts.tab || "characters";
  currentTab = tabId;
  const tab = TABS.find(t => t.id === tabId) || TABS[0];
  return h("header", { class: "top" },
    h("button", { class: "logo", onclick: () => tab.home(), "aria-label": `${APP.name} home` },
      h("span", { class: "logo-word" }, "Kame", h("em", null, "dles")),
      h("span", { class: "logo-sub" }, "daily guessing games")),
    h("nav", { class: "sitetabs", "aria-label": "Games" }, TABS.map(t =>
      h("button", { class: "sitetab", "aria-current": t.id === tabId ? "page" : null, onclick: () => { stopTicker(); t.home(); } }, t.label))),
    h("div", { class: "top-actions" },
      opts.stats && h("button", { class: "ibtn", title: "Statistics", "aria-label": "Statistics", onclick: opts.stats },
        svg("M4 20V10M10 20V4M16 20v-7M22 20H2")),
      h("button", { class: "ibtn", title: "How to play", "aria-label": "How to play", onclick: opts.help || tab.help || openHelp }, "?")));
}
function svg(d) { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", d); s.append(p); return s; }

/* ---------- home ---------- */
const app = $("#app");
function renderHome() {
  currentTab = "characters"; game = null; view.seriesId = null; setAccent(null); setHash(""); stopTicker();
  const day = dayIndex();
  app.replaceChildren(
    topBar({ tab: "characters" }),
    h("section", { class: "hero" },
      h("h1", { class: "hero-title" }, "Guess the ", h("em", null, "character"), "."),
      h("p", { class: "hero-sub" }, `${ORDER.length} shows, three modes, curated casts only. New puzzles at midnight.`),
      h("p", { class: "hero-day" }, `Daily #${day + 1} · ${fmtDay(day)}`)),
    ...GROUPS.map(g => h("section", { class: "group", "aria-label": g.label },
      h("h2", { class: "group-label" }, g.label, h("span", null, `${g.ids.length}`)),
      h("div", { class: "series-grid" }, g.ids.map(id => seriesCard(id, day))))),
    h("footer", { class: "foot" }, "Casts are hand-picked from the shows themselves: main and supporting characters, nobody who showed up for one scene, nothing manga-only. Age is the latest age the show gives a character (or their age at death)."));
}
function seriesCard(id, day) {
  const s = D.series[id], accent = (META[id] && META[id].accent) || DEFAULT_ACCENT;
  return h("button", { class: "scard", style: { "--accent": accent }, onclick: () => openSeries(id) },
    h("div", null,
      h("div", { class: "scard-big" }, s.short),
      (s.tagline || s.short !== s.title) && h("div", { class: "scard-title" }, s.tagline || s.title),
      h("div", { class: "scard-meta" }, `${s.characters.length} characters`)),
    h("div", { class: "pills" }, MODES.map(m => {
      const r = dailyRecord(id, m.id, day);
      const cls = r ? (r.solved ? "done" : r.gaveUp ? "lost" : r.guesses.length ? "live" : "") : "";
      return h("span", { class: `pill ${cls}` }, m.label);
    })));
}

/* ---------- play ---------- */
function openSeries(id, opts = {}) {
  if (!D.series[id]) return renderHome();
  view.seriesId = id;
  if (opts.mode) view.mode = opts.mode;
  if (opts.unlimited != null) view.unlimited = opts.unlimited;
  S.prefs.mode = view.mode; S.prefs.lastSeries = id; saveState();
  setAccent(id); setHash(id);
  startGame(id, view.mode, view.unlimited, opts.avoidId);
  renderPlay();
}

let ui = {};
function renderPlay() {
  stopTicker();
  const s = game.series, mode = modeById(game.mode), day = game.day;
  ui = {};
  const head = h("div", { class: "play-head" },
    h("div", null,
      h("button", { class: "crumb", onclick: renderHome }, "← All series"),
      h("h1", { class: "series-title" }, s.title),
      h("p", { class: "cutoff" }, s.cutoff)),
    h("div", { class: "daybadge" }, game.unlimited ? "Unlimited · practice" : `Daily #${day + 1} · ${fmtDay(day)}`));

  const tabs = h("div", { class: "seg", role: "tablist", "aria-label": "Mode" }, MODES.map(m =>
    h("button", { role: "tab", "aria-selected": String(m.id === game.mode), onclick: () => openSeries(game.seriesId, { mode: m.id }) }, m.label)));
  const dailyToggle = h("div", { class: "seg small", role: "tablist", "aria-label": "Daily or unlimited" },
    h("button", { role: "tab", "aria-selected": String(!game.unlimited), onclick: () => openSeries(game.seriesId, { unlimited: false }) }, "Daily"),
    h("button", { role: "tab", "aria-selected": String(game.unlimited), onclick: () => openSeries(game.seriesId, { unlimited: true }) }, "Unlimited"));

  ui.prompt = h("div", { class: "prompt" });
  ui.form = guessForm();
  ui.area = h("div", { class: "area" });
  ui.revealRow = h("div", { class: "reveal-row" });
  ui.result = h("div", { class: "result-host" });
  const board = h("section", { class: "board", "aria-live": "polite" }, ui.prompt, ui.form, ui.result, ui.area, ui.revealRow);

  app.replaceChildren(topBar({ tab: "characters", stats: openStats }), head, h("div", { class: "controls" }, tabs, dailyToggle), board);

  renderPrompt();
  if (game.mode === "classic") {
    const cols = columns(s);
    ui.rows = h("div", { class: "rows" });
    ui.grid = h("div", { class: "grid", role: "table", style: { gridTemplateColumns: `minmax(180px, 1.6fr) repeat(${cols.length - 1}, minmax(96px, 1fr))`, minWidth: `${180 + (cols.length - 1) * 102}px` } }, cols.map(c => h("div", { class: "gh", role: "columnheader", title: c.label }, c.label)), ui.rows);
    ui.area.replaceChildren(h("div", { class: "grid-wrap" }, ui.grid),
      h("div", { class: "legend" },
        h("span", null, h("i", { style: { background: "var(--ok)" } }), "match"),
        h("span", null, h("i", { style: { background: "var(--part)" } }), "partial overlap"),
        h("span", null, h("i", { style: { background: "var(--bad)" } }), "miss"),
        h("span", null, s.hideAge ? "▲ ▼ answer debuts later / earlier" : "▲ ▼ answer is older / younger, or debuts later / earlier"),
        h("span", null, h("i", { style: { background: "var(--unk)" } }), "no canon value")));
    for (const id of game.guesses.slice().reverse()) ui.rows.append(classicRow(charById(s, id), false));
  } else {
    ui.list = h("div", { class: "glist" });
    ui.hints = h("div", { class: "hints" });
    ui.area.replaceChildren(ui.list, ui.hints);
    for (const id of game.guesses.slice().reverse()) ui.list.append(listItem(charById(s, id), false));
    renderHints();
  }
  updateRevealRow();
  if (isOver()) showResult(false); else setTimeout(() => ui.input && ui.input.focus({ preventScroll: true }), 50);
  startTicker();
}

function renderPrompt() {
  const s = game.series, a = game.answer, over = isOver();
  if (game.mode === "classic") {
    ui.prompt.replaceChildren(h("p", { class: "lead" }, game.unlimited ? "Practice round. " : "", "Guess the ", h("b", null, s.short), " character. ", `${poolFor(s, "classic").length} possible; every guess lights up the attributes you got right.`));
  } else if (game.mode === "quote") {
    ui.prompt.replaceChildren(h("div", { class: "prompt-quote" },
      h("blockquote", null, a.quote),
      h("div", { class: "who" }, over ? `— ${a.name}` : "— who said it?")));
  } else {
    const shown = over ? 5 : Math.min(5, APP.emojiStart + wrongCount());
    const prev = ui.prompt.dataset.shown ? Number(ui.prompt.dataset.shown) : -1;
    ui.prompt.dataset.shown = String(shown);
    ui.prompt.replaceChildren(
      h("div", { class: "prompt-emoji", "aria-label": "Emoji clues" }, a.emojis.map((e, i) => i < shown
        ? h("div", { class: `emo${i >= prev && prev >= 0 ? " pop" : ""}`, title: `Clue ${i + 1}` }, e)
        : h("div", { class: "emo slot", "aria-label": "Locked clue" }, "?"))),
      !over && h("p", { class: "prompt-note" }, shown < 5 ? "Each miss unlocks one more emoji." : "All five emojis are out. Hints unlock below."));
  }
}

/* ---------- input + suggestions ---------- */
function guessForm() {
  ui.input = h("input", { class: "guess-input", id: "guess", type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: "false", placeholder: "Type a character name…", "aria-label": "Character name", "aria-autocomplete": "list" });
  ui.submit = h("button", { class: "guess-submit", type: "submit", disabled: true }, "Guess");
  ui.suggest = h("div", { class: "suggest", role: "listbox", hidden: true });
  let items = [], active = -1;
  const close = () => { ui.suggest.hidden = true; items = []; active = -1; ui.input.removeAttribute("aria-activedescendant"); };
  const render = () => {
    const q = norm(ui.input.value);
    if (!q) return close();
    const guessed = new Set(game.guesses);
    const scored = [];
    for (const c of game.series.characters) {
      if (guessed.has(c.id)) continue;
      const names = [c.name, ...(c.aliases || [])];
      let best = 0, via = null;
      for (const nm of names) {
        const n = norm(nm);
        let sc = n === q ? 4 : n.startsWith(q) ? 3 : n.split(" ").some(w => w.startsWith(q)) ? 2 : n.includes(q) ? 1 : 0;
        if (sc && nm === c.name) sc += 0.5; // prefer the real name over an alias hit
        if (sc > best) { best = sc; via = nm; }
      }
      if (best) scored.push({ c, best, via });
    }
    scored.sort((a, b) => b.best - a.best || a.c.name.localeCompare(b.c.name));
    items = scored.slice(0, 8);
    active = items.length ? 0 : -1;
    ui.submit.disabled = !items.length;
    ui.suggest.replaceChildren(...(items.length ? items.map(({ c, via }, i) =>
      h("button", { type: "button", class: "sug", role: "option", id: `sug-${i}`, "aria-selected": String(i === active), onmousedown: e => e.preventDefault(), onclick: () => pick(c) },
        avatar(c),
        h("span", { class: "sug-name" }, h("span", null, c.name),
          via !== c.name ? h("span", { class: "alias" }, `matches “${via}”`) : (c.aliases && c.aliases[0] ? h("span", { class: "alias" }, c.aliases[0]) : null))))
      : [h("div", { class: "sug-empty" }, "No character matches that. Only characters who matter to the show are in the pool.")]));
    ui.suggest.hidden = false;
    if (active >= 0) ui.input.setAttribute("aria-activedescendant", `sug-${active}`);
  };
  const setActive = i => { active = (i + items.length) % items.length; [...ui.suggest.children].forEach((n, j) => n.setAttribute("aria-selected", String(j === active))); ui.suggest.children[active].scrollIntoView({ block: "nearest" }); ui.input.setAttribute("aria-activedescendant", `sug-${active}`); };
  const pick = c => { close(); ui.input.value = ""; ui.submit.disabled = true; submitGuess(c); };
  ui.input.addEventListener("input", render);
  ui.input.addEventListener("focus", render);
  ui.input.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== ui.input) close(); }, 120));
  ui.input.addEventListener("keydown", e => {
    if (ui.suggest.hidden || !items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
    else if (e.key === "Escape") close();
  });
  const form = h("form", { class: "guess-form", onsubmit: e => { e.preventDefault(); if (items.length && active >= 0) pick(items[active].c); else if (items.length) pick(items[0].c); } }, ui.input, ui.submit, ui.suggest);
  return form;
}

/* ---------- guesses ---------- */
function submitGuess(c) {
  if (!game || isOver()) return;
  if (game.guesses.includes(c.id)) return toast("Already guessed that one");
  game.guesses.push(c.id);
  const win = c.id === game.answer.id;
  if (win) game.solved = true;
  persistGame(win ? "win" : null);
  if (game.mode === "classic") ui.rows.prepend(classicRow(c, true));
  else { ui.list.prepend(listItem(c, true)); renderPrompt(); renderHints(); }
  updateRevealRow();
  if (win) { ui.input.blur(); setTimeout(() => showResult(true), game.mode === "classic" ? 6 * 110 + 450 : 350); }
  else ui.input.focus({ preventScroll: true });
}
function classicRow(c, animate) {
  const s = game.series, cols = columns(s);
  return h("div", { class: "grow", role: "row" }, cols.map((col, i) => {
    const r = compare(col, c, game.answer, s);
    const cls = `tile ${r.state}${animate ? " anim" : ""}`;
    if (col.type === "name") return h("div", { class: cls + " name", role: "cell", style: { "--i": i } }, avatar(c), h("span", null, c.name));
    let val = c[col.key];
    if (Array.isArray(val)) val = val.join(" · ");
    if (col.type === "number") val = val == null ? "?" : String(val);
    const children = [h("span", { class: `val${col.type === "number" ? " big" : ""}` }, val)];
    if (r.arrow) children.push(h("span", { class: "arrow" }, ARROW[col.type][r.arrow]));
    return h("div", { class: cls, role: "cell", style: { "--i": i }, title: `${col.label}: ${val}` }, children);
  }));
}
function listItem(c, animate) {
  const ok = c.id === game.answer.id;
  return h("div", { class: `gi${ok ? " ok" : ""}${animate ? " anim" : ""}` }, avatar(c), h("span", null, c.name), h("span", { style: { marginLeft: "auto", opacity: .8 } }, ok ? "✓" : "✕"));
}
function renderHints(flipIdx = -1) {
  const sched = HINTS[game.mode] || [], wrong = wrongCount(), over = isOver();
  ui.hints.replaceChildren(...sched.map((hn, i) => {
    const label = hn.label(game.series);
    const unlocked = over || wrong >= hn.after;
    if (over || game.revealed.includes(i)) {
      return h("div", { class: `hint open${i === flipIdx ? " flip" : ""}` }, h("span", { class: "hl" }, label), h("span", { class: "hv" }, hn.value(game.answer)));
    }
    if (unlocked) {
      return h("button", { type: "button", class: "hint ready", onclick: () => revealHint(i), "aria-label": `Reveal hint: ${label}` },
        h("span", { class: "hl" }, label), h("span", { class: "tap" }, "Tap to reveal"));
    }
    return h("div", { class: "hint locked" }, h("span", { class: "hl" }, label),
      h("span", { class: "hv" }, `Unlocks after ${plural(hn.after, "miss")}${wrong ? ` (${hn.after - wrong} to go)` : ""}`));
  }));
}
function revealHint(i) {
  if (!game || game.revealed.includes(i)) return;
  game.revealed.push(i);
  persistGame(null);
  renderHints(i);
}
function updateRevealRow() {
  ui.revealRow.replaceChildren();
  if (isOver()) return;
  const n = game.guesses.length;
  if (game.unlimited || n >= APP.revealAfter) {
    const btn = h("button", { class: "link-btn", onclick: () => {
      ui.revealRow.replaceChildren(
        h("span", null, game.unlimited ? "Reveal the answer?" : "This counts as a loss for today."),
        h("button", { class: "btn small", onclick: updateRevealRow }, "Keep going"),
        h("button", { class: "btn small primary", onclick: giveUp }, "Reveal"));
    } }, "Reveal answer");
    ui.revealRow.replaceChildren(h("span", null, `${plural(n, "guess")} so far`), btn);
  } else ui.revealRow.replaceChildren(h("span", null, n ? `${plural(n, "guess")} so far` : ""));
}
function giveUp() {
  if (!game || isOver()) return;
  game.gaveUp = true; persistGame("loss");
  if (game.mode !== "classic") { renderPrompt(); renderHints(); }
  updateRevealRow(); showResult(true);
}

/* ---------- result ---------- */
function showResult(animate) {
  const s = game.series, a = game.answer, n = game.guesses.length, m = modeById(game.mode);
  ui.form.hidden = true;
  if (game.mode !== "classic") renderPrompt();
  const facts = [["Gender", a.gender], [s.hairLabel || "Hair", a.hair], [s.affiliationLabel, a.affiliation.join(" · ")], !s.hideAge && ["Age", a.age == null ? "unknown" : a.age], [s.powerLabel, a.power.join(" · ")], ["Debut", a.debut]].filter(Boolean);
  if (game.mode !== "quote" && a.quote) facts.push(["Quote", `“${a.quote}”`]);
  if (game.mode !== "emoji") facts.push(["Emoji", a.emojis.join(" ")]);

  const actions = h("div", { class: "result-actions" });
  if (!game.unlimited) {
    actions.append(h("button", { class: "btn primary", onclick: share }, "Share result"));
    const next = MODES.find(mm => mm.id !== game.mode && !(dailyRecord(game.seriesId, mm.id, game.day) || {}).solved && !(dailyRecord(game.seriesId, mm.id, game.day) || {}).gaveUp);
    if (next) actions.append(h("button", { class: "btn", onclick: () => openSeries(game.seriesId, { mode: next.id }) }, `Next: ${next.label} →`));
    else actions.append(h("button", { class: "btn", onclick: renderHome }, "Other series →"));
    actions.append(h("button", { class: "btn", onclick: () => openSeries(game.seriesId, { unlimited: true }) }, "Unlimited"));
    ui.countdown = h("span", { class: "countdown" }, "Next puzzle in ", h("b", null, fmtCountdown(msToMidnight())));
    actions.append(ui.countdown);
  } else {
    actions.append(h("button", { class: "btn primary", onclick: () => { const r = game.rounds + 1; openSeries(game.seriesId, { unlimited: true, avoidId: a.id }); game.rounds = r; } }, "Play again"));
    actions.append(h("button", { class: "btn", onclick: () => openSeries(game.seriesId, { unlimited: false }) }, "Back to daily"));
  }
  const panel = h("div", { class: "result", style: animate ? null : { animation: "none" } },
    h("h2", null, game.solved ? (n === 1 ? "First try!" : n <= 3 ? "Nailed it." : n <= 6 ? "Got it!" : "Finally!") : "The answer was…"),
    h("p", { class: "sub" }, game.solved ? `${m.label} · solved in ${plural(n, "guess")}${game.unlimited ? "" : ` · Daily #${game.day + 1}`}` : `${m.label} · revealed after ${plural(n, "guess")}`),
    h("div", { class: "answer" }, avatar(a, "lg"), h("div", null, h("div", { class: "answer-name" }, a.name), h("div", { class: "answer-hint" }, a.hint))),
    h("div", { class: "facts" }, facts.map(([k, v]) => h("span", { class: "fact" }, h("b", null, k), v))),
    actions);
  ui.result.replaceChildren(panel);
  if (animate) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function shareText() {
  const m = modeById(game.mode), n = game.guesses.length, s = game.series;
  const lines = [`${APP.name} #${game.day + 1} · ${s.short} · ${m.label}`, game.solved ? `Solved in ${plural(n, "guess")}` : `Gave up after ${plural(n, "guess")}`];
  if (game.mode === "classic") {
    const cols = columns(s).filter(c => c.type !== "name");
    for (const id of game.guesses) {
      const c = charById(s, id);
      lines.push(cols.map(col => { const r = compare(col, c, game.answer, s); return r.state === "ok" ? "🟩" : r.state === "part" ? "🟨" : r.state === "unk" ? "⬜" : r.arrow === "up" ? "🔼" : r.arrow === "down" ? "🔽" : "🟥"; }).join(""));
    }
  } else {
    lines.push(game.guesses.map(id => id === game.answer.id ? "🟩" : "🟥").join(""));
    lines.push(game.revealed.length ? `💡 ${plural(game.revealed.length, "hint")} used` : "💡 No hints");
  }
  if (/^https?:/.test(location.protocol)) lines.push(location.href.split("#")[0]);
  return lines.join("\n");
}
function share() {
  const text = shareText();
  const done = () => toast("Copied to clipboard");
  const fallback = () => {
    const ta = h("textarea", { style: { position: "fixed", opacity: 0 } }, text); document.body.append(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { toast("Couldn't copy — select the text manually"); } ta.remove();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
}

/* ---------- ticker (countdown + day rollover) ---------- */
let ticker = null;
function startTicker() {
  stopTicker();
  ticker = setInterval(() => {
    if (!game) return;
    if (ui.countdown) ui.countdown.querySelector("b").textContent = fmtCountdown(msToMidnight());
    if (!game.unlimited && dayIndex() !== game.day) { toast("A new daily puzzle just dropped"); openSeries(game.seriesId); }
  }, 1000);
}
function stopTicker() { if (ticker) clearInterval(ticker); ticker = null; }

/* ---------- modals ---------- */
const modal = $("#modal");
function openModal(title, ...body) {
  modal.replaceChildren(h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div", { class: "dialog-head" }, h("h2", null, title), h("button", { class: "ibtn", "aria-label": "Close", onclick: closeModal }, "✕")),
    body));
  modal.hidden = false;
  modal.querySelector(".ibtn").focus();
}
function closeModal() { modal.hidden = true; modal.replaceChildren(); }
modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) closeModal(); });

function openHelp() {
  const tile = (cls, txt, cap) => h("div", null, h("div", { class: `tile ${cls}` }, h("span", { class: "val" }, txt)), h("div", { class: "cap" }, cap));
  openModal("How to play",
    h("p", null, "Pick a series and a mode, then type character names. Every series gets one puzzle per mode per day, the same for everyone, and it resets at midnight your time. Unlimited mode hands you a random character and never touches your streaks."),
    h("h3", null, "Classic"),
    h("p", null, "Each guess lights up the answer's attributes:"),
    h("div", { class: "legend-tiles" }, tile("ok", "Match", "Exactly the same"), tile("part", "Partial", "Shares at least one entry"), tile("bad", "Miss", "Nothing in common"), tile("bad", "19 ▲ older", "Answer is higher / later"), tile("unk", "?", "No canon value on record")),
    h("p", null, "Age is the latest age the show gives the character (for anyone who dies, their age at death). Debut is the arc or season they first show up in; ▲ later means the answer appears later than your guess. Affiliation and power can list more than one value — yellow means some overlap."),
    h("h3", null, "Quote"),
    h("p", null, "A line the character says in the show. Hint cards unlock after 2, 4, 6 and 8 misses — they stay face-down until you tap one, so using them is up to you."),
    h("h3", null, "Emoji"),
    h("p", null, "Five emojis describe the character. You start with two and each miss reveals another. Hint cards unlock after 4, 6 and 8 misses; tap one to flip it."),
    h("h3", null, "The casts"),
    h("p", null, "Only characters a viewer would actually know: main cast, supporting cast, major villains. Everything comes from the show itself (no manga-only material), up to where each show has aired. No horses."));
}
function openStats() {
  if (!game) return;
  const s = game.series;
  const body = h("div", null);
  const render = modeId => {
    const st = S.stats[`${game.seriesId}:${modeId}`] || { played: 0, won: 0, streak: 0, max: 0, dist: {} };
    const pct = st.played ? Math.round(100 * st.won / st.played) : 0;
    const maxN = Math.max(1, ...Object.values(st.dist));
    const keys = Array.from({ length: 8 }, (_, i) => i + 1);
    const over = Object.entries(st.dist).filter(([k]) => Number(k) > 8).reduce((a, [, v]) => a + v, 0);
    body.replaceChildren(
      h("div", { class: "mode-switch seg small" }, MODES.map(m => h("button", { "aria-selected": String(m.id === modeId), onclick: () => render(m.id) }, m.label))),
      h("div", { class: "stat-grid" }, [["Played", st.played], ["Win %", pct], ["Streak", st.streak], ["Best", st.max]].map(([k, v]) => h("div", { class: "stat" }, h("b", null, v), h("span", null, k)))),
      h("h3", null, "Guess distribution"),
      h("div", { class: "dist" }, [...keys.map(k => [String(k), st.dist[k] || 0]), ["9+", over]].map(([k, v]) =>
        h("div", { class: "drow" }, h("span", null, k), h("div", { class: "dbar" }, v ? h("i", { style: { width: `${Math.max(8, 100 * v / maxN)}%` } }, v) : null)))));
  };
  render(game.mode);
  openModal(`${s.short} stats`, body);
}

/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
}

/* ---------- boot ---------- */
function route() {
  const id = decodeURIComponent(location.hash.slice(1));
  for (const t of TABS) if (t.route && t.route(id)) return;
  if (id && D.series[id]) { if (id !== view.seriesId || !game) openSeries(id); return; }
  renderHome();
}
window.SHD = { APP, D, h, $, svg, toast, openModal, closeModal, get S() { return S; }, saveState, dayIndex, fmtDay, fmtCountdown, msToMidnight,
  seededShuffle, cyrb53, norm, initials, plural, setAccent, setHash, topBar, registerTab, app, stopTicker };
window.KAMEDLES = { get game() { return game; }, dayIndex, version: 2 };
const boot = () => { route(); window.addEventListener("hashchange", route); };
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else setTimeout(boot, 0);
})();
