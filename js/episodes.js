/* Kamedles — Episodes tab: guess the episode from a zoomed-in still. */
(() => {
"use strict";
const X = window.SHD, E = window.DLE && window.DLE.episodes;
if (!X || !E) return;
const { h, toast, openModal, dayIndex, fmtDay, fmtCountdown, msToMidnight, seededShuffle, cyrb53, norm, plural, setAccent, setHash, topBar, registerTab, app } = X;
const META = (window.DLE && window.DLE.meta) || {};
const ZOOM = [3.4, 2.6, 2.0, 1.6, 1.28, 1];
const REVEAL_AFTER = 6;
const CLOSE = 3; // episodes away that still count as "close"

/* ---------- search box (shared with the Songs tab) ---------- */
function searchBox({ placeholder, items, exclude, render, onPick, empty }) {
  const input = h("input", { class: "guess-input", id: "guess", type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: "false", placeholder, "aria-label": placeholder, "aria-autocomplete": "list" });
  const submit = h("button", { class: "guess-submit", type: "submit", disabled: true }, "Guess");
  const list = h("div", { class: "suggest", role: "listbox", hidden: true });
  let shown = [], active = -1;
  const close = () => { list.hidden = true; shown = []; active = -1; };
  const draw = () => {
    const q = norm(input.value);
    if (!q) return close();
    const skip = exclude ? exclude() : new Set();
    const scored = [];
    for (const it of items()) {
      if (skip.has(it.key)) continue;
      let best = 0;
      it.terms.forEach((t, k) => {
        const n = t; // already normalised
        let sc = n === q ? 4 : n.startsWith(q) ? 3 : n.split(" ").some(w => w.startsWith(q)) ? 2 : n.includes(q) ? 1 : 0;
        if (sc && k === 0) sc += 0.5;
        if (sc > best) best = sc;
      });
      if (best) scored.push({ it, best });
    }
    scored.sort((a, b) => b.best - a.best || a.it.sort - b.it.sort);
    shown = scored.slice(0, 8).map(x => x.it);
    active = shown.length ? 0 : -1;
    submit.disabled = !shown.length;
    list.replaceChildren(...(shown.length ? shown.map((it, i) => {
      const b = h("button", { type: "button", class: "sug", role: "option", "aria-selected": String(i === active), onmousedown: e => e.preventDefault(), onclick: () => pick(it) }, render(it));
      return b;
    }) : [h("div", { class: "sug-empty" }, empty)]));
    list.hidden = false;
  };
  const setActive = i => { active = (i + shown.length) % shown.length; [...list.children].forEach((n, j) => n.setAttribute("aria-selected", String(j === active))); list.children[active].scrollIntoView({ block: "nearest" }); };
  const pick = it => { close(); input.value = ""; submit.disabled = true; onPick(it); };
  input.addEventListener("input", draw);
  input.addEventListener("focus", draw);
  input.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== input) close(); }, 120));
  input.addEventListener("keydown", e => {
    if (list.hidden || !shown.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
    else if (e.key === "Escape") close();
  });
  const form = h("form", { class: "guess-form", onsubmit: e => { e.preventDefault(); if (shown.length) pick(shown[Math.max(0, active)]); } }, input, submit, list);
  form.input = input;
  return form;
}
X.searchBox = searchBox;

/* ---------- episode picker: choose the season / book / arc, then the episode ---------- */
// Every episode of the chosen group is listed, so nothing gets cut off; typing searches titles across
// all groups instead. Starts on the group of the latest guess, never on anything that hints the answer.
function episodePicker() {
  const s = game.show;
  const last = game.guesses.length ? game.list.find(ep => ep.i === game.guesses[game.guesses.length - 1]) : null;
  let group = last ? last.g : 0, query = "";
  const chips = h("div", { class: "ep-groups", role: "tablist", "aria-label": s.label });
  const search = h("input", { class: "ep-search", type: "search", placeholder: "Search all titles…", "aria-label": "Search episode titles", autocomplete: "off", spellcheck: "false" });
  const list = h("div", { class: "ep-list", "aria-label": "Episodes" });
  const draw = () => {
    chips.replaceChildren(...s.groups.map((name, i) => h("button", { type: "button", role: "tab", class: "ep-group", "aria-selected": String(!query && i === group),
      onclick: () => { group = i; query = ""; search.value = ""; draw(); list.scrollTop = 0; } }, name)));
    const q = norm(query);
    const eps = q ? game.list.filter(ep => ep.terms[0].includes(q)) : game.list.filter(ep => ep.g === group);
    list.replaceChildren(...(eps.length ? eps.map(ep => {
      const used = game.guesses.includes(ep.i);
      return h("button", { type: "button", class: `ep-pick${used ? " used" : ""}`, disabled: used, onclick: () => guess(ep) },
        h("span", { class: "ep-code" }, q ? ep.code : s.label === "Arc" ? `#${ep.e}` : `E${ep.e}`),
        h("span", { class: "ep-title" }, ep.title));
    }) : [h("div", { class: "sug-empty" }, "No episode title matches that.")]));
  };
  search.addEventListener("input", () => { query = search.value; draw(); });
  const box = h("div", { class: "ep-picker" }, h("div", { class: "ep-picker-top" }, chips, search), list);
  box.redraw = draw;
  box.input = search;
  draw();
  return box;
}

/* ---------- data helpers ---------- */
const epsCache = {};
function episodes(slug) {
  if (epsCache[slug]) return epsCache[slug];
  const show = E.shows[slug];
  const list = show.eps.map((r, i) => ({ i, g: r[0], e: r[1], title: r[2], date: r[3], img: r[4] })).filter(x => x.img);
  for (const ep of list) {
    ep.code = epCode(show, ep);
    const g = ep.g + 1, pre = show.label === "Book" ? "b" : "s";
    ep.key = ep.i; ep.sort = ep.i;
    ep.terms = [norm(ep.title), norm(`${pre}${g}e${ep.e}`), norm(`s${g}e${ep.e}`), `${g}x${ep.e}`, norm(`${pre}${g} e${ep.e}`), norm(show.groups[ep.g])];
    if (show.label === "Arc") ep.terms.push(String(ep.e), `ep ${ep.e}`, `episode ${ep.e}`);
  }
  return (epsCache[slug] = list);
}
function epCode(show, ep) { return show.label === "Arc" ? `Ep ${ep.e}` : `${show.label === "Book" ? "B" : "S"}${ep.g + 1} · E${ep.e}`; }
const epUrl = ep => E.base + ep.img;
function dailyEpisode(slug, day) {
  const list = episodes(slug), n = list.length;
  const cycle = Math.floor(day / n), idx = ((day % n) + n) % n;
  return seededShuffle(list, cyrb53(`ep|${slug}|${cycle}`) >>> 0)[idx];
}
function focusFor(seed) { const a = cyrb53(seed), b = cyrb53(seed + "y"); return [0.28 + (a % 1000) / 1000 * 0.44, 0.28 + (b % 1000) / 1000 * 0.44]; }
const recKey = (slug, day) => `ep:${slug}:${day}`;
const record = (slug, day) => X.S.games[recKey(slug, day)] || null;

/* ---------- state ---------- */
let game = null, ui = {}, ticker = null, unlimited = false;
function start(slug, opts = {}) {
  if (opts.unlimited != null) unlimited = opts.unlimited;
  const show = E.shows[slug], list = episodes(slug), day = dayIndex();
  let answer, saved = null, focus;
  if (unlimited) {
    do { answer = list[Math.floor(Math.random() * list.length)]; } while (list.length > 1 && opts.avoid === answer.i);
    focus = [0.28 + Math.random() * 0.44, 0.28 + Math.random() * 0.44];
  } else {
    answer = dailyEpisode(slug, day); saved = record(slug, day); focus = focusFor(`${slug}|${day}`);
  }
  game = { slug, show, list, day, answer, focus, unlimited, guesses: saved ? saved.guesses.slice() : [], solved: !!(saved && saved.solved), gaveUp: !!(saved && saved.gaveUp) };
  setAccent(slug); setHash(`ep-${slug}`);
  render();
}
const over = () => game.solved || game.gaveUp;
const wrong = () => game.guesses.filter(i => i !== game.answer.i).length;
function persist(outcome) {
  if (game.unlimited) return;
  const S = X.S;
  S.games[recKey(game.slug, game.day)] = { guesses: game.guesses, solved: game.solved, gaveUp: game.gaveUp };
  if (outcome) {
    const k = `ep:${game.slug}`;
    const st = S.stats[k] || (S.stats[k] = { played: 0, won: 0, streak: 0, max: 0, lastDay: null, dist: {} });
    st.played++;
    if (outcome === "win") { st.won++; st.streak = st.lastDay === game.day - 1 ? st.streak + 1 : 1; st.max = Math.max(st.max, st.streak); const n = game.guesses.length; st.dist[n] = (st.dist[n] || 0) + 1; }
    else st.streak = 0;
    st.lastDay = game.day;
  }
  X.saveState();
}
function compare(g, a) {
  const grp = g.g === a.g ? { state: "ok" } : { state: "bad", arrow: a.g > g.g ? "up" : "down" };
  const d = a.i - g.i;
  const ep = d === 0 ? { state: "ok" } : { state: Math.abs(d) <= CLOSE ? "part" : "bad", arrow: d > 0 ? "up" : "down" };
  return { grp, ep };
}

/* ---------- home ---------- */
function renderHome() {
  X.stopTicker(); stopTicker(); game = null; setAccent(null); setHash("episodes");
  const day = dayIndex();
  app.replaceChildren(
    topBar({ tab: "episodes", help: openHelp }),
    h("section", { class: "hero" },
      h("h1", { class: "hero-title" }, "Name the ", h("em", null, "episode"), "."),
      h("p", { class: "hero-sub" }, `One still, zoomed way in. Every miss pulls the camera back. ${E.order.length} shows, a new frame at midnight.`),
      h("p", { class: "hero-day" }, `Daily #${day + 1} · ${fmtDay(day)}`)),
    h("section", { class: "series-grid", "aria-label": "Choose a show" }, E.order.map(slug => {
      const s = E.shows[slug], r = record(slug, day), accent = (META[slug] && META[slug].accent) || "#ff8a3d";
      const state = r ? (r.solved ? "done" : r.gaveUp ? "lost" : r.guesses.length ? "live" : "") : "";
      return h("button", { class: "scard", style: { "--accent": accent }, onclick: () => start(slug, { unlimited: false }) },
        h("div", null, h("div", { class: "scard-big" }, s.short), s.short !== s.title && h("div", { class: "scard-title" }, s.title),
          h("div", { class: "scard-meta" }, `${episodes(slug).length} episodes · ${s.groups.length} ${s.label.toLowerCase()}${s.groups.length === 1 ? "" : "s"}`)),
        h("div", { class: "pills" }, h("span", { class: `pill ${state}` }, state === "done" ? "Solved today" : state === "lost" ? "Revealed" : state === "live" ? "In progress" : "Today's still")));
    })),
    h("footer", { class: "foot" }, "Left out on purpose: One Piece, Naruto, Black Clover, Dragon Ball, SpongeBob and Power Rangers — too many episodes to be fair. Episode lists and stills come from TVmaze (tvmaze.com)."));
}

/* ---------- play ---------- */
function render() {
  X.stopTicker(); stopTicker();
  const s = game.show;
  ui = {};
  const head = h("div", { class: "play-head" },
    h("div", null,
      h("button", { class: "crumb", onclick: renderHome }, "← All shows"),
      h("h1", { class: "series-title" }, s.title),
      h("p", { class: "cutoff" }, `${game.list.length} episodes across ${s.groups.length} ${s.label.toLowerCase()}${s.groups.length === 1 ? "" : "s"}. Pick the ${s.label.toLowerCase()}, then the episode — or search by title.`)),
    h("div", { class: "daybadge" }, game.unlimited ? "Unlimited · practice" : `Daily #${game.day + 1} · ${fmtDay(game.day)}`));
  const toggle = h("div", { class: "seg small", role: "tablist", "aria-label": "Daily or unlimited" },
    h("button", { role: "tab", "aria-selected": String(!game.unlimited), onclick: () => start(game.slug, { unlimited: false }) }, "Daily"),
    h("button", { role: "tab", "aria-selected": String(game.unlimited), onclick: () => start(game.slug, { unlimited: true }) }, "Unlimited"));

  ui.img = h("img", { class: "ep-img", alt: "Episode still", src: epUrl(game.answer), referrerpolicy: "no-referrer", decoding: "async",
    onerror: () => { ui.frame.classList.add("broken"); ui.frame.append(h("div", { class: "ep-broken" }, "Couldn't load this still. The claude.ai preview blocks outside images — open the site from your folder instead.")); } });
  ui.zoom = h("div", { class: "zoom-note" });
  ui.frame = h("div", { class: "ep-frame" }, ui.img, ui.zoom);
  ui.form = episodePicker();
  ui.result = h("div", { class: "result-host" });
  ui.rows = h("div", { class: "rows" });
  const grid = h("div", { class: "grid ep-grid", role: "table" },
    h("div", { class: "gh", role: "columnheader" }, "Episode"), h("div", { class: "gh", role: "columnheader" }, s.label), h("div", { class: "gh", role: "columnheader" }, "Order"), ui.rows);
  ui.reveal = h("div", { class: "reveal-row" });
  const board = h("section", { class: "board", "aria-live": "polite" }, ui.frame, ui.form, ui.result, h("div", { class: "grid-wrap" }, grid),
    h("div", { class: "legend" },
      h("span", null, h("i", { style: { background: "var(--ok)" } }), "right"),
      h("span", null, h("i", { style: { background: "var(--part)" } }), `within ${CLOSE} episodes`),
      h("span", null, h("i", { style: { background: "var(--bad)" } }), "off"),
      h("span", null, "▲ ▼ the answer is later / earlier")), ui.reveal);
  app.replaceChildren(topBar({ tab: "episodes", stats: openStats, help: openHelp }), head, h("div", { class: "controls" }, h("span", { class: "controls-note" }, "Stills: TVmaze"), toggle), board);
  for (const i of game.guesses.slice().reverse()) ui.rows.append(row(game.list.find(ep => ep.i === i), false));
  applyZoom(false);
  updateReveal();
  if (over()) showResult(false);
  startTicker();
}
function applyZoom(animate) {
  const z = over() ? 1 : ZOOM[Math.min(wrong(), ZOOM.length - 1)];
  ui.img.style.transformOrigin = `${game.focus[0] * 100}% ${game.focus[1] * 100}%`;
  ui.img.style.transition = animate ? "transform .6s cubic-bezier(.2,.7,.2,1)" : "none";
  ui.img.style.transform = `scale(${z})`;
  ui.zoom.textContent = z > 1 ? `${z.toFixed(1)}× zoom · a miss zooms out` : over() ? "Full frame" : "Full frame — last look";
}
function row(ep, animate) {
  const c = compare(ep, game.answer), s = game.show;
  const cls = st => `tile ${st.state}${animate ? " anim" : ""}`;
  const arrow = st => st.arrow ? h("span", { class: "arrow" }, st.arrow === "up" ? "▲ later" : "▼ earlier") : null;
  return h("div", { class: "grow", role: "row" },
    h("div", { class: `tile name ep-name${animate ? " anim" : ""}`, role: "cell", style: { "--i": 0 } }, h("span", { class: "ep-code" }, ep.code), h("span", null, ep.title)),
    h("div", { class: cls(c.grp), role: "cell", style: { "--i": 1 } }, h("span", { class: "val" }, s.groups[ep.g]), arrow(c.grp)),
    h("div", { class: cls(c.ep), role: "cell", style: { "--i": 2 } }, h("span", { class: "val big" }, ep.code.replace(/^.*E/, "E").replace(/^Ep /, "#")), arrow(c.ep)));
}
function guess(ep) {
  if (!game || over() || game.guesses.includes(ep.i)) return;
  game.guesses.push(ep.i);
  const win = ep.i === game.answer.i;
  if (win) game.solved = true;
  persist(win ? "win" : null);
  ui.rows.prepend(row(ep, true));
  applyZoom(true);
  updateReveal();
  ui.form.redraw();
  if (win) setTimeout(() => showResult(true), 3 * 110 + 450);
}
function updateReveal() {
  ui.reveal.replaceChildren();
  if (over()) return;
  const n = game.guesses.length;
  if (game.unlimited || n >= REVEAL_AFTER) {
    ui.reveal.append(h("span", null, `${plural(n, "guess")} so far`), h("button", { class: "link-btn", onclick: () => {
      ui.reveal.replaceChildren(h("span", null, game.unlimited ? "Reveal the episode?" : "This counts as a loss for today."),
        h("button", { class: "btn small", onclick: updateReveal }, "Keep going"),
        h("button", { class: "btn small primary", onclick: giveUp }, "Reveal"));
    } }, "Reveal answer"));
  } else if (n) ui.reveal.append(h("span", null, `${plural(n, "guess")} so far`));
}
function giveUp() { if (!game || over()) return; game.gaveUp = true; persist("loss"); applyZoom(true); updateReveal(); showResult(true); }
function showResult(animate) {
  const a = game.answer, s = game.show, n = game.guesses.length;
  ui.form.hidden = true;
  applyZoom(animate);
  const actions = h("div", { class: "result-actions" });
  if (!game.unlimited) {
    actions.append(h("button", { class: "btn primary", onclick: share }, "Share result"),
      h("button", { class: "btn", onclick: () => start(game.slug, { unlimited: true }) }, "Unlimited"),
      h("button", { class: "btn", onclick: renderHome }, "Other shows →"));
    ui.countdown = h("span", { class: "countdown" }, "Next still in ", h("b", null, fmtCountdown(msToMidnight())));
    actions.append(ui.countdown);
  } else {
    actions.append(h("button", { class: "btn primary", onclick: () => start(game.slug, { unlimited: true, avoid: a.i }) }, "Next still"),
      h("button", { class: "btn", onclick: () => start(game.slug, { unlimited: false }) }, "Back to daily"));
  }
  const panel = h("div", { class: "result", style: animate ? null : { animation: "none" } },
    h("h2", null, game.solved ? (n === 1 ? "First try!" : n <= 3 ? "Sharp eyes." : "Got it!") : "It was…"),
    h("p", { class: "sub" }, game.solved ? `Solved in ${plural(n, "guess")}${game.unlimited ? "" : ` · Daily #${game.day + 1}`}` : `Revealed after ${plural(n, "guess")}`),
    h("div", { class: "answer" }, h("span", { class: "ep-code big" }, a.code), h("div", null, h("div", { class: "answer-name" }, a.title), h("div", { class: "answer-hint" }, `${s.groups[a.g]}${a.date ? " · aired " + a.date : ""}`))),
    actions);
  ui.result.replaceChildren(panel);
}
function share() {
  const s = game.show, n = game.guesses.length;
  const lines = [`${X.APP.name} Episodes #${game.day + 1} · ${s.short}`, game.solved ? `Solved in ${plural(n, "guess")}` : `Gave up after ${plural(n, "guess")}`];
  for (const i of game.guesses) {
    const c = compare(game.list.find(ep => ep.i === i), game.answer);
    const e = st => st.state === "ok" ? "🟩" : st.state === "part" ? "🟨" : st.arrow === "up" ? "🔼" : "🔽";
    lines.push(e(c.grp) + e(c.ep));
  }
  if (/^https?:/.test(location.protocol)) lines.push(location.href.split("#")[0]);
  const text = lines.join("\n");
  const done = () => toast("Copied to clipboard");
  const fallback = () => { const ta = h("textarea", { style: { position: "fixed", opacity: 0 } }, text); document.body.append(ta); ta.select(); try { document.execCommand("copy"); done(); } catch (e) { toast("Couldn't copy"); } ta.remove(); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
}
function startTicker() {
  stopTicker();
  ticker = setInterval(() => {
    if (!game || !ui.frame || !ui.frame.isConnected) return stopTicker();
    if (ui.countdown && ui.countdown.isConnected) ui.countdown.querySelector("b").textContent = fmtCountdown(msToMidnight());
    if (!game.unlimited && dayIndex() !== game.day) { toast("A new still just dropped"); start(game.slug, { unlimited: false }); }
  }, 1000);
}
function stopTicker() { if (ticker) clearInterval(ticker); ticker = null; }

/* ---------- modals ---------- */
function openHelp() {
  openModal("Episodes",
    h("p", null, "You get one still from an episode, zoomed way in. Pick the season (book, or arc for Hunter x Hunter) and then the episode, or search by title. Every miss zooms the picture out a step; after five misses you see the whole frame."),
    h("p", null, `Each guess tells you whether you picked the right ${"season / book / arc"} and whether the answer comes earlier or later. Yellow means you're within ${CLOSE} episodes.`),
    h("p", null, "One daily still per show, the same for everyone, resetting at midnight. Unlimited hands out random stills and doesn't touch your stats."),
    h("p", null, "Episode titles and stills come from TVmaze."));
}
function openStats() {
  const k = `ep:${game ? game.slug : ""}`;
  const st = X.S.stats[k] || { played: 0, won: 0, streak: 0, max: 0, dist: {} };
  const pct = st.played ? Math.round(100 * st.won / st.played) : 0;
  openModal(`${game ? game.show.short : ""} episode stats`,
    h("div", { class: "stat-grid" }, [["Played", st.played], ["Win %", pct], ["Streak", st.streak], ["Best", st.max]].map(([a, b]) => h("div", { class: "stat" }, h("b", null, b), h("span", null, a)))));
}

registerTab({
  id: "episodes", label: "Episodes", home: renderHome, help: openHelp,
  route: id => {
    if (id === "episodes") { renderHome(); return true; }
    const m = /^ep-([a-z0-9]+)$/.exec(id || "");
    if (m && E.shows[m[1]]) { if (!game || game.slug !== m[1]) start(m[1], { unlimited: false }); return true; }
    return false;
  },
});
window.KAMEDLES_EP = { get game() { return game; } };
})();
