/* Kamedles — Connections tab: sort 16 tiles into four groups of four. */
(() => {
"use strict";

/* ---------- puzzle generator (also run by tools/build-connections.mjs) ---------- */
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function shuffle(arr, rng) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const seedFor = (slug, day) => cyrb53(`conn|${slug}|${day}`) >>> 0;

// Picks 4 groups and 4 members of each. A member who also belongs to another chosen group is never
// dealt, so every tile has exactly one home, and groups listed in each other's `no` (two slices of one
// list, like a show's main and recurring cast) never share a board. Attempts alternate between one
// group per difficulty level and any four groups, so small banks with lots of overlap still get
// varied boards. Colours follow difficulty order within the board (yellow → purple), never repeating.
function makePuzzle(set, seed) {
  const rng = mulberry32(seed);
  const pick = arr => arr[Math.floor(rng() * arr.length)];
  const groups = set.groups.map((g, i) => ({ g, i, keys: new Set(g.members.map(norm)) }));
  const fits = (x, chosen) => !chosen.includes(x) && !(x.g.no && chosen.some(o => x.g.no.includes(o.i)));
  if (groups.length < 4) return null;
  for (let attempt = 0; attempt < 400; attempt++) {
    const chosen = [];
    if (attempt % 2 === 0) for (const level of shuffle([1, 2, 3, 4], rng)) {
      const bucket = groups.filter(x => x.g.level === level && fits(x, chosen));
      if (bucket.length) chosen.push(pick(bucket));
    }
    for (let tries = 0; chosen.length < 4 && tries < 60; tries++) { const x = pick(groups); if (fits(x, chosen)) chosen.push(x); }
    if (chosen.length < 4) continue;
    const pools = chosen.map(x => x.g.members.filter(m => chosen.every(o => o === x || !o.keys.has(norm(m)))));
    if (pools.some(p => p.length < 4)) continue;
    const picks = pools.map(p => shuffle(p, rng).slice(0, 4));
    if (new Set(picks.flat().map(norm)).size !== 16) continue;
    const out = chosen.map((x, i) => ({ title: x.g.title, level: x.g.level, members: picks[i] }))
      .sort((a, b) => a.level - b.level || rng() - 0.5).map((g, i) => ({ ...g, color: i + 1 }));
    return { groups: out, tiles: shuffle(picks.flat(), rng) };
  }
  return null;
}
window.KConnGen = { makePuzzle, seedFor, norm };

const X = window.SHD, C = window.DLE && window.DLE.connections;
if (!X || !C) return;
const { h, toast, openModal, dayIndex, fmtDay, fmtCountdown, msToMidnight, plural, setAccent, setHash, topBar, registerTab, app } = X;
const META = (window.DLE && window.DLE.meta) || {};
const MISTAKES = 4;
const SQUARE = ["", "🟨", "🟩", "🟦", "🟪"]; // by colour (difficulty order on the board)
const recKey = (slug, day) => `conn:${slug}:${day}`;
const accentOf = slug => (META[slug] && META[slug].accent) || "#ff8a3d";

/* ---------- state ---------- */
let game = null, ui = {}, ticker = null;
function start(slug, opts = {}) {
  const set = C.sets[slug], day = dayIndex(), unlimited = !!opts.unlimited;
  // A saved daily keeps the board it was played with, even if the group bank changed since.
  const saved = unlimited ? null : X.S.games[recKey(slug, day)];
  const puzzle = (saved && saved.puzzle) || makePuzzle(set, unlimited ? (Math.random() * 4294967296) >>> 0 : seedFor(slug, day));
  game = { slug, set, day, unlimited, puzzle,
    tiles: saved ? saved.tiles.slice() : puzzle ? puzzle.tiles.slice() : [],
    solved: saved ? saved.solved.slice() : [], guesses: saved ? saved.guesses.slice() : [], mistakes: saved ? saved.mistakes : 0, selected: [] };
  setAccent(slug === "music" ? null : slug); if (slug === "music") document.documentElement.style.setProperty("--accent", "#1ed760");
  setHash(`conn-${slug}`);
  render();
}
const won = () => game.solved.length === 4;
const lost = () => game.mistakes >= MISTAKES && !won();
const over = () => won() || lost();
function persist(outcome) {
  if (game.unlimited) return;
  const S = X.S;
  S.games[recKey(game.slug, game.day)] = { puzzle: game.puzzle, tiles: game.tiles, solved: game.solved, guesses: game.guesses, mistakes: game.mistakes };
  if (outcome) {
    const k = `conn:${game.slug}`;
    const st = S.stats[k] || (S.stats[k] = { played: 0, won: 0, streak: 0, max: 0, lastDay: null, dist: {} });
    st.played++;
    if (outcome === "win") { st.won++; st.streak = st.lastDay === game.day - 1 ? st.streak + 1 : 1; st.max = Math.max(st.max, st.streak); st.dist[game.mistakes] = (st.dist[game.mistakes] || 0) + 1; }
    else st.streak = 0;
    st.lastDay = game.day;
  }
  X.saveState();
}

/* ---------- home ---------- */
function renderHome() {
  X.stopTicker(); stopTicker(); game = null; setAccent(null); setHash("connections");
  const day = dayIndex();
  app.replaceChildren(
    topBar({ tab: "connections", help: openHelp }),
    h("section", { class: "hero" },
      h("h1", { class: "hero-title" }, "Find the ", h("em", null, "connections"), "."),
      h("p", { class: "hero-sub" }, "Sixteen names, four hidden groups of four. One puzzle per show every day, plus one built from your playlists."),
      h("p", { class: "hero-day" }, `Daily #${day + 1} · ${fmtDay(day)}`)),
    h("section", { class: "series-grid", "aria-label": "Choose a puzzle" }, C.order.map(slug => {
      const s = C.sets[slug], r = X.S.games[recKey(slug, day)];
      const state = r ? (r.solved.length === 4 ? "done" : r.mistakes >= MISTAKES ? "lost" : r.guesses.length ? "live" : "") : "";
      return h("button", { class: "scard", style: { "--accent": slug === "music" ? "#1ed760" : accentOf(slug) }, onclick: () => start(slug) },
        h("div", null, h("div", { class: "scard-big" }, s.label), h("div", { class: "scard-meta" }, slug === "music" ? "from your playlists" : `${s.groups.length} groups in the bank`)),
        h("div", { class: "pills" }, h("span", { class: `pill ${state}` }, state === "done" ? "Solved today" : state === "lost" ? "Out of tries" : state === "live" ? "In progress" : "Today's puzzle")));
    })));
}

/* ---------- play ---------- */
function render() {
  X.stopTicker(); stopTicker();
  ui = {};
  const head = h("div", { class: "play-head" },
    h("div", null,
      h("button", { class: "crumb", onclick: renderHome }, "← All puzzles"),
      h("h1", { class: "series-title" }, game.set.label),
      h("p", { class: "cutoff" }, "Find four groups of four. Pick four tiles and submit; you can make four mistakes.")),
    h("div", { class: "daybadge" }, game.unlimited ? "Unlimited · practice" : `Daily #${game.day + 1} · ${fmtDay(game.day)}`));
  const dailyToggle = h("div", { class: "seg small", role: "tablist", "aria-label": "Daily or unlimited" },
    h("button", { role: "tab", "aria-selected": String(!game.unlimited), onclick: () => start(game.slug) }, "Daily"),
    h("button", { role: "tab", "aria-selected": String(game.unlimited), onclick: () => start(game.slug, { unlimited: true }) }, "Unlimited"));
  ui.board = h("div", { class: "conn-board" });
  ui.result = h("div", { class: "result-host" });
  app.replaceChildren(topBar({ tab: "connections", stats: openStats, help: openHelp }), head, h("div", { class: "controls" }, h("span", { class: "controls-note" }, `${plural(game.set.groups.length, "group")} in the bank`), dailyToggle),
    h("section", { class: "board", "aria-live": "polite" }, game.puzzle ? ui.board : h("p", { class: "player-note" }, "Not enough groups to build a puzzle for this one yet."), ui.result));
  if (!game.puzzle) return;
  drawBoard();
  if (over()) showResult(false);
  startTicker();
}
function groupRow(gi, cls = "") {
  const g = game.puzzle.groups[gi];
  return h("div", { class: `conn-row lv${g.color || g.level}${cls ? " " + cls : ""}` }, h("b", null, g.title), h("span", null, g.members.join(", ")));
}
function drawBoard(fresh = -1) {
  const rows = game.solved.map(gi => groupRow(gi, gi === fresh ? "fresh" : ""));
  // Out of mistakes: show what was left, marked as revealed rather than solved.
  if (lost()) game.puzzle.groups.forEach((g, gi) => { if (!game.solved.includes(gi)) rows.push(groupRow(gi, "revealed")); });
  const tiles = over() ? [] : game.tiles.map(t => h("button", { type: "button", class: `conn-tile${game.selected.includes(t) ? " on" : ""}${t.length > 11 ? " long" : ""}`, "aria-pressed": String(game.selected.includes(t)), onclick: () => toggle(t) }, t));
  const left = MISTAKES - game.mistakes;
  const controls = over() ? null : h("div", { class: "conn-controls" },
    h("div", { class: "conn-mistakes", "aria-label": `${plural(left, "mistake")} left` }, "Mistakes left: ", ...Array.from({ length: MISTAKES }, (_, i) => h("i", { class: i < left ? "on" : "" }))),
    h("div", { class: "conn-buttons" },
      h("button", { class: "btn small", onclick: () => { game.tiles = shuffle(game.tiles, Math.random); drawBoard(); } }, "Shuffle"),
      h("button", { class: "btn small", disabled: !game.selected.length, onclick: () => { game.selected = []; drawBoard(); } }, "Deselect all"),
      h("button", { class: "btn small primary", disabled: game.selected.length !== 4, onclick: submit }, "Submit")));
  ui.grid = tiles.length ? h("div", { class: "conn-grid" }, tiles) : null;
  ui.board.replaceChildren(...rows, ...(ui.grid ? [ui.grid] : []), ...(controls ? [controls] : []));
}
function toggle(t) {
  if (over()) return;
  const i = game.selected.indexOf(t);
  if (i >= 0) game.selected.splice(i, 1); else if (game.selected.length < 4) game.selected.push(t);
  drawBoard();
}
function submit() {
  if (over() || game.selected.length !== 4) return;
  const key = game.selected.slice().sort().join("|");
  if (game.guesses.some(g => g.slice().sort().join("|") === key)) return toast("Already guessed");
  game.guesses.push(game.selected.slice());
  const gi = game.puzzle.groups.findIndex(g => game.selected.every(t => g.members.includes(t)));
  if (gi >= 0) {
    game.solved.push(gi);
    game.tiles = game.tiles.filter(t => !game.selected.includes(t));
    game.selected = [];
    persist(won() ? "win" : null);
    drawBoard(gi);
    if (won()) setTimeout(() => showResult(true), 500);
    return;
  }
  game.mistakes++;
  const best = Math.max(...game.puzzle.groups.map(g => game.selected.filter(t => g.members.includes(t)).length));
  persist(lost() ? "loss" : null);
  if (lost()) { game.selected = []; drawBoard(); return setTimeout(() => showResult(true), 400); }
  if (best === 3) toast("One away…");
  if (ui.grid) for (const el of ui.grid.querySelectorAll(".conn-tile.on")) { el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake"); }
  drawBoardSoon();
}
let redraw = 0;
function drawBoardSoon() { clearTimeout(redraw); redraw = setTimeout(() => { if (ui.board && ui.board.isConnected) drawBoard(); }, 450); }

/* ---------- result ---------- */
function showResult(animate) {
  const n = game.mistakes, actions = h("div", { class: "result-actions" });
  if (!game.unlimited) {
    actions.append(h("button", { class: "btn primary", onclick: share }, "Share result"),
      h("button", { class: "btn", onclick: () => start(game.slug, { unlimited: true }) }, "Unlimited"),
      h("button", { class: "btn", onclick: renderHome }, "Other puzzles →"));
    ui.countdown = h("span", { class: "countdown" }, "Next puzzle in ", h("b", null, fmtCountdown(msToMidnight())));
    actions.append(ui.countdown);
  } else {
    actions.append(h("button", { class: "btn primary", onclick: () => start(game.slug, { unlimited: true }) }, "Next puzzle"),
      h("button", { class: "btn", onclick: () => start(game.slug) }, "Back to daily"));
  }
  ui.result.replaceChildren(h("div", { class: "result", style: animate ? null : { animation: "none" } },
    h("h2", null, won() ? (n === 0 ? "Perfect!" : n === 1 ? "Nice." : "Got there!") : "Next time!"),
    h("p", { class: "sub" }, won() ? `Solved with ${plural(n, "mistake")}${game.unlimited ? "" : ` · Daily #${game.day + 1}`}` : `Out of mistakes · ${game.solved.length} of 4 groups found`),
    h("div", { class: "conn-share-grid", "aria-hidden": "true" }, shareRows().join("\n")),
    actions));
}
function shareRows() {
  const colorOf = t => { const g = game.puzzle.groups.find(g => g.members.includes(t)) || {}; return g.color || g.level || 0; };
  return game.guesses.map(g => g.map(t => SQUARE[colorOf(t)]).join(""));
}
function share() {
  const lines = [`${X.APP.name} Connections #${game.day + 1} · ${game.set.label}`, ...shareRows()];
  if (/^https?:/.test(location.protocol)) lines.push(location.href.split("#")[0] + `#conn-${game.slug}`);
  const text = lines.join("\n"), done = () => toast("Copied to clipboard");
  const fallback = () => { const ta = h("textarea", { style: { position: "fixed", opacity: 0 } }, text); document.body.append(ta); ta.select(); try { document.execCommand("copy"); done(); } catch (e) { toast("Couldn't copy"); } ta.remove(); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
}

/* ---------- ticker / modals ---------- */
function startTicker() {
  stopTicker();
  ticker = setInterval(() => {
    if (!game || !ui.board || !ui.board.isConnected) return stopTicker();
    if (ui.countdown && ui.countdown.isConnected) ui.countdown.querySelector("b").textContent = fmtCountdown(msToMidnight());
    if (!game.unlimited && dayIndex() !== game.day) { toast("A new puzzle just dropped"); start(game.slug); }
  }, 1000);
}
function stopTicker() { if (ticker) clearInterval(ticker); ticker = null; }
function openHelp() {
  openModal("Connections",
    h("p", null, "Sixteen tiles hide four groups of four: a crew, a family, a power type, a sneaky shared trait. Pick four tiles you think belong together and press Submit."),
    h("p", null, "Right groups lock in with their colour, from yellow (easiest) through green and blue to purple (trickiest). You can make four mistakes; \"One away…\" means three of your four were right."),
    h("p", null, "Every tile fits exactly one group, even when it looks like it could fit two. Each show gets its own daily puzzle, and the Music one is built from the songs in your playlists. Unlimited deals a fresh board every time."));
}
function openStats() {
  const st = X.S.stats[`conn:${game ? game.slug : ""}`] || { played: 0, won: 0, streak: 0, max: 0, dist: {} };
  const pct = st.played ? Math.round(100 * st.won / st.played) : 0;
  const maxN = Math.max(1, ...Object.values(st.dist));
  openModal(`${game ? game.set.label : ""} Connections stats`,
    h("div", { class: "stat-grid" }, [["Played", st.played], ["Win %", pct], ["Streak", st.streak], ["Best", st.max]].map(([a, b]) => h("div", { class: "stat" }, h("b", null, b), h("span", null, a)))),
    h("h3", null, "Mistakes in solved puzzles"),
    h("div", { class: "dist" }, [0, 1, 2, 3].map(k => { const v = st.dist[k] || 0; return h("div", { class: "drow" }, h("span", null, k), h("div", { class: "dbar" }, v ? h("i", { style: { width: `${Math.max(8, 100 * v / maxN)}%` } }, v) : null)); })));
}

registerTab({
  id: "connections", label: "Connections", home: renderHome, help: openHelp,
  route: id => {
    if (id === "connections") { renderHome(); return true; }
    const m = /^conn-([a-z0-9]+)$/.exec(id || "");
    if (m && C.sets[m[1]]) { if (!game || game.slug !== m[1]) start(m[1]); return true; }
    return false;
  },
});
window.KAMEDLES_CONN = { get game() { return game; } };
})();
