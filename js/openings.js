/* Kamedles — Openings tab: name the show from its opening theme. */
(() => {
"use strict";
const X = window.SHD, O = window.DLE && window.DLE.openings;
if (!X || !O) return;
const { h, toast, openModal, dayIndex, fmtDay, fmtCountdown, msToMidnight, seededShuffle, cyrb53, norm, plural, setAccent, setHash, topBar, registerTab, app } = X;
const STEPS = [1, 2, 4, 7, 11, 16];
const MAX = STEPS[STEPS.length - 1];
const ACCENT = "#ff5fa2";

/* ---------- data ---------- */
const SHOWS = O.shows.map((s, i) => ({ ...s, i, key: i, terms: [norm(s.name), ...s.aliases.map(norm)], sort: i }));
const THEMES = O.themes.map((t, i) => ({ ...t, i, id: `op${i}`, show: SHOWS[t.s] }));
// The daily sticks to shows one of you rated plus openings a fair share of anime-quiz players
// recognise (AnisongDB's difficulty score); Unlimited uses everything.
const DAILY = THEMES.filter(t => t.show.rated || t.diff == null || t.diff >= 25);
function dailyTheme(day) {
  const n = DAILY.length, cycle = Math.floor(day / n), idx = ((day % n) + n) % n;
  return seededShuffle(DAILY, cyrb53(`op|${cycle}`) >>> 0)[idx];
}
const recKey = day => `op:${day}`;

/* ---------- clip lookup (Deezer JSONP first, then Apple) ----------
   Kept here rather than shared with the Songs tab: right after a deploy a browser can still hold the
   old songs.js for a few minutes, and this tab shouldn't break when it does. */
let jsonpSeq = 0;
function jsonp(url, ms = 9000) {
  return new Promise((resolve, reject) => {
    const cb = "__opdz" + (++jsonpSeq), sc = document.createElement("script");
    const done = (fn, v) => { clearTimeout(t); delete window[cb]; sc.remove(); fn(v); };
    const t = setTimeout(() => done(reject, new Error("timeout")), ms);
    window[cb] = d => done(resolve, d);
    sc.onerror = () => done(reject, new Error("blocked"));
    sc.src = `${url}${url.includes("?") ? "&" : "?"}output=jsonp&callback=${cb}`;
    document.head.append(sc);
  });
}
const clipCache = {};
async function lookup(t) {
  if (clipCache[t.i]) return clipCache[t.i];
  let info = null;
  if (t.dz) {
    try { const d = await jsonp(`https://api.deezer.com/track/${t.dz}`); if (d && d.preview) info = { url: d.preview, art: (d.album && (d.album.cover_xl || d.album.cover_big)) || "", link: d.link, via: "Deezer" }; }
    catch (e) { /* fall through to Apple */ }
  }
  if (!info && t.it) {
    try {
      const j = await (await fetch(`https://itunes.apple.com/lookup?id=${t.it}&country=US`)).json(), r = j.results && j.results[0];
      if (r && r.previewUrl) info = { url: r.previewUrl, art: (r.artworkUrl100 || "").replace("100x100bb", "600x600bb"), link: r.trackViewUrl, via: "Apple Music" };
    } catch (e) { /* no clip */ }
  }
  if (info) clipCache[t.i] = info;
  return info;
}
const HINTS = [
  { after: 2, label: "Aired", value: t => t.show.year },
  { after: 4, label: "Studio", value: t => t.show.studio },
];

/* ---------- state ---------- */
let game = null, ui = {}, audio = null, raf = 0, ticker = null, playing = false;
const prefs = () => X.S.prefs;
function start(opts = {}) {
  stopAudio(); audio = null;
  const unlimited = opts.unlimited != null ? opts.unlimited : !!(game && game.unlimited);
  const day = dayIndex();
  let answer, saved = null;
  if (unlimited) { do { answer = THEMES[Math.floor(Math.random() * THEMES.length)]; } while (THEMES.length > 1 && opts.avoid === answer.i); }
  else { saved = X.S.games[recKey(day)]; answer = (saved && THEMES[saved.answer]) || dailyTheme(day); }
  game = { unlimited, day, answer, steps: saved ? saved.steps.slice() : [], solved: !!(saved && saved.solved), gaveUp: !!(saved && saved.gaveUp), info: null, failed: false };
  setAccent(null); document.documentElement.style.setProperty("--accent", ACCENT);
  setHash("openings");
  render();
  const want = answer;
  lookup(answer).then(info => { if (game && game.answer === want) { game.info = info; game.failed = !info; renderPlayer(); if (over()) showResult(false); } });
}
const over = () => game.solved || game.gaveUp;
const wrong = () => game.steps.filter(st => st.k === "guess" && st.show !== game.answer.s).length + game.steps.filter(st => st.k === "skip").length;
const clipLen = () => over() ? 30 : STEPS[Math.min(game.steps.length, STEPS.length - 1)];
function persist(outcome) {
  if (game.unlimited) return;
  const S = X.S;
  S.games[recKey(game.day)] = { answer: game.answer.i, steps: game.steps, solved: game.solved, gaveUp: game.gaveUp };
  if (outcome) {
    const k = "op";
    const st = S.stats[k] || (S.stats[k] = { played: 0, won: 0, streak: 0, max: 0, lastDay: null, dist: {} });
    st.played++;
    if (outcome === "win") { st.won++; st.streak = st.lastDay === game.day - 1 ? st.streak + 1 : 1; st.max = Math.max(st.max, st.streak); const n = game.steps.length; st.dist[n] = (st.dist[n] || 0) + 1; }
    else st.streak = 0;
    st.lastDay = game.day;
  }
  X.saveState();
}

/* ---------- audio (same behaviour as the Songs tab) ---------- */
const pad = n => String(Math.floor(n)).padStart(2, "0");
function setPlaying(on) {
  playing = on;
  if (ui.playBtn) { ui.playBtn.classList.toggle("playing", on); ui.playBtn.setAttribute("aria-label", on ? "Pause" : `Play ${clipLen()} second${clipLen() === 1 ? "" : "s"}`); }
}
function stopAudio() { cancelAnimationFrame(raf); if (audio) audio.pause(); setPlaying(false); }
const position = () => (audio && game.info && audio.dataset.src === game.info.url ? audio.currentTime : 0);
function drawProgress(t) {
  const lim = clipLen(), scale = over() ? 30 : MAX;
  if (ui.fill) ui.fill.style.width = `${Math.min(100, (Math.min(t, lim) / scale) * 100)}%`;
  if (ui.time) ui.time.textContent = `0:${pad(Math.min(t, lim))} / 0:${pad(lim)}`;
}
async function play(fromStart) {
  if (!game.info) return toast(game.failed ? "No clip for this one" : "Still loading the clip…");
  if (!audio || audio.dataset.src !== game.info.url) { if (audio) audio.pause(); audio = new Audio(game.info.url); audio.dataset.src = game.info.url; audio.preload = "auto"; }
  audio.volume = prefs().songVol != null ? prefs().songVol : 0.7;
  cancelAnimationFrame(raf);
  if (fromStart || audio.ended || audio.currentTime >= clipLen() - 0.05) audio.currentTime = 0;
  try { await audio.play(); } catch (e) { setPlaying(false); return toast("Tap play again — the browser blocked autoplay"); }
  setPlaying(true);
  const tick = () => {
    if (!ui.player || !ui.player.isConnected) { stopAudio(); return; }
    drawProgress(audio.currentTime);
    if (audio.currentTime >= clipLen() || audio.ended) { audio.pause(); setPlaying(false); drawProgress(clipLen()); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
const togglePlay = () => { if (playing) stopAudio(); else play(false); };

/* ---------- render ---------- */
function render() {
  X.stopTicker(); stopTicker();
  ui = {};
  const head = h("div", { class: "play-head" },
    h("div", null,
      h("h1", { class: "series-title" }, "Name that opening"),
      h("p", { class: "cutoff" }, `${plural(THEMES.length, "opening")} from ${plural(SHOWS.length, "show")}: popular anime, everything one of you rated on AniList, and your western shows' themes. Guess the show; the clip grows with every miss.`)),
    h("div", { class: "daybadge" }, game.unlimited ? "Unlimited · practice" : `Daily #${game.day + 1} · ${fmtDay(game.day)}`));
  const dayToggle = h("div", { class: "seg small", role: "tablist", "aria-label": "Daily or unlimited" },
    h("button", { role: "tab", "aria-selected": String(!game.unlimited), onclick: () => start({ unlimited: false }) }, "Daily"),
    h("button", { role: "tab", "aria-selected": String(game.unlimited), onclick: () => start({ unlimited: true }) }, "Unlimited"));
  const vol = h("input", { type: "range", min: "0", max: "1", step: "0.05", value: String(prefs().songVol != null ? prefs().songVol : 0.7), "aria-label": "Volume",
    oninput: e => { prefs().songVol = +e.target.value; if (audio) audio.volume = +e.target.value; X.saveState(); } });
  ui.player = h("div", { class: "player" });
  ui.form = X.searchBox({
    placeholder: "Type a show…",
    items: () => SHOWS,
    exclude: () => new Set(game.steps.filter(st => st.k === "guess").map(st => st.show)),
    render: s => h("span", { class: "sug-name" }, h("span", null, s.name), s.year ? h("span", { class: "alias" }, `${s.year}${s.studio ? ` · ${s.studio}` : ""}`) : null),
    onPick: s => guess(s),
    empty: "No show matches that.",
  });
  ui.hints = h("div", { class: "hints" });
  ui.attempts = h("div", { class: "attempts" });
  ui.result = h("div", { class: "result-host" });
  app.replaceChildren(topBar({ tab: "openings", stats: openStats, help: openHelp }), head,
    h("div", { class: "controls" }, h("label", { class: "vol" }, "🔊", vol), dayToggle),
    h("section", { class: "board song-board", "aria-live": "polite" }, ui.player, ui.form, ui.result, ui.hints, ui.attempts));
  renderPlayer(); renderAttempts(); renderHints();
  if (over()) showResult(false); else setTimeout(() => ui.form.input.focus({ preventScroll: true }), 50);
  startTicker();
}
function renderPlayer() {
  if (!ui.player) return;
  const len = clipLen(), n = game.steps.length;
  ui.fill = h("div", { class: "bar-fill" });
  ui.time = h("span", { class: "bar-time" });
  const marks = over() ? [] : STEPS.map(s => h("i", { class: `bar-mark${s <= len ? " on" : ""}`, style: { left: `${(s / MAX) * 100}%` } }));
  const unlocked = h("div", { class: "bar-unlocked", style: { width: `${over() ? 100 : (len / MAX) * 100}%` } });
  ui.playBtn = h("button", { class: "play-btn", onclick: togglePlay, disabled: !game.info }, h("span", { class: "tri" }));
  setPlaying(playing);
  drawProgress(position());
  const next = STEPS[Math.min(n + 1, STEPS.length - 1)] - STEPS[Math.min(n, STEPS.length - 1)];
  const skip = !over() && h("button", { class: "btn small", onclick: skipStep }, n >= STEPS.length - 1 ? "Give up" : `Skip (+${next}s)`);
  const status = game.failed ? h("p", { class: "player-note" }, "Couldn't load this clip. Try Unlimited for another one.")
    : !game.info ? h("p", { class: "player-note" }, "Loading clip…") : null;
  ui.player.replaceChildren(
    h("div", { class: "player-row" }, ui.playBtn, h("div", { class: "bar" }, unlocked, ui.fill, ...marks), ui.time),
    h("div", { class: "player-actions" }, h("span", { class: "clip-label" }, over() ? "Full 30-second clip" : `Clip: ${len} second${len === 1 ? "" : "s"} · try ${Math.min(n + 1, 6)} of 6`), skip || ""),
    ...(status ? [status] : []));
}
function renderAttempts() {
  ui.attempts.replaceChildren(...Array.from({ length: 6 }, (_, i) => {
    const st = game.steps[i];
    if (!st) return h("div", { class: "att empty" }, h("span", { class: "att-n" }, i + 1), h("span", null, i === game.steps.length && !over() ? "…" : ""));
    if (st.k === "skip") return h("div", { class: "att skip" }, h("span", { class: "att-n" }, i + 1), h("span", null, "Skipped"));
    const s = SHOWS[st.show], a = game.answer.show;
    const cls = st.show === game.answer.s ? "ok" : s && a.studio && s.studio === a.studio ? "part" : "bad";
    return h("div", { class: `att ${cls}` }, h("span", { class: "att-n" }, i + 1),
      h("span", { class: "att-name" }, s ? s.name : "?"),
      h("span", { class: "att-tag" }, cls === "ok" ? "✓" : cls === "part" ? "same studio" : "✕"));
  }));
}
function renderHints() {
  const w = wrong(), t = game.answer;
  ui.hints.replaceChildren(...HINTS.filter(hn => hn.value(t)).map(hn => (over() || w >= hn.after)
    ? h("div", { class: "hint open" }, h("span", { class: "hl" }, hn.label), h("span", { class: "hv" }, hn.value(t)))
    : h("div", { class: "hint locked" }, h("span", { class: "hl" }, hn.label), h("span", { class: "hv" }, `Unlocks after ${plural(hn.after, "miss")}`))));
}
function guess(s) {
  if (!game || over()) return;
  game.steps.push({ k: "guess", show: s.i });
  const win = s.i === game.answer.s;
  if (win) game.solved = true; else if (game.steps.length >= 6) game.gaveUp = true;
  persist(win ? "win" : game.gaveUp ? "loss" : null);
  if (over()) stopAudio(); // a wrong guess mid-play just unlocks more and keeps it going
  renderPlayer(); renderAttempts(); renderHints();
  if (over()) showResult(true); else ui.form.input.focus({ preventScroll: true });
}
function skipStep() {
  if (!game || over()) return;
  game.steps.push({ k: "skip" });
  if (game.steps.length >= 6) game.gaveUp = true;
  persist(game.gaveUp ? "loss" : null);
  if (over()) { stopAudio(); renderPlayer(); renderAttempts(); renderHints(); showResult(true); return; }
  renderPlayer(); renderAttempts(); renderHints();
  if (!playing) play(true);
}
function showResult(animate) {
  if (!ui.result) return;
  const t = game.answer, s = t.show, n = game.steps.length, info = game.info;
  ui.form.hidden = true;
  const actions = h("div", { class: "result-actions" });
  if (!game.unlimited) {
    actions.append(h("button", { class: "btn primary", onclick: share }, "Share result"), h("button", { class: "btn", onclick: () => start({ unlimited: true }) }, "Unlimited"));
    ui.countdown = h("span", { class: "countdown" }, "Next opening in ", h("b", null, fmtCountdown(msToMidnight())));
    actions.append(ui.countdown);
  } else {
    actions.append(h("button", { class: "btn primary", onclick: () => start({ unlimited: true, avoid: t.i }) }, "Next opening"),
      h("button", { class: "btn", onclick: () => start({ unlimited: false }) }, "Back to daily"));
  }
  const art = s.cover || (info && info.art);
  ui.result.replaceChildren(h("div", { class: "result", style: animate ? null : { animation: "none" } },
    h("h2", null, game.solved ? (n === 1 ? "One second. Wow." : n <= 3 ? "Called it." : "Got it!") : "It was…"),
    h("p", { class: "sub" }, game.solved ? `Solved on try ${n}${game.unlimited ? "" : ` · Daily #${game.day + 1}`}` : "Out of tries"),
    h("div", { class: "answer song-answer" },
      art ? h("img", { class: "album-art", src: art, alt: "", referrerpolicy: "no-referrer" }) : h("span", { class: "album-art blank" }, "♪"),
      h("div", null,
        h("div", { class: "answer-name" }, s.name),
        h("div", { class: "answer-hint" }, s.western ? "Theme song" : `${t.entry} · Opening ${t.n}`),
        h("div", { class: "answer-hint" }, `“${t.song}”${t.artist ? ` — ${t.artist}` : ""}`),
        info && info.link && h("div", { class: "song-links" }, h("a", { href: info.link, target: "_blank", rel: "noopener" }, `Open on ${info.via}`)))),
    actions));
}
function share() {
  const row = Array.from({ length: 6 }, (_, i) => {
    const st = game.steps[i];
    if (!st) return "⬜";
    if (st.k === "skip") return "⬛";
    if (st.show === game.answer.s) return "🟩";
    return SHOWS[st.show] && game.answer.show.studio && SHOWS[st.show].studio === game.answer.show.studio ? "🟨" : "🟥";
  }).join("");
  const lines = [`${X.APP.name} Openings #${game.day + 1}`, `🔊${row}`];
  if (/^https?:/.test(location.protocol)) lines.push(location.href.split("#")[0] + "#openings");
  const text = lines.join("\n"), done = () => toast("Copied to clipboard");
  const fallback = () => { const ta = h("textarea", { style: { position: "fixed", opacity: 0 } }, text); document.body.append(ta); ta.select(); try { document.execCommand("copy"); done(); } catch (e) { toast("Couldn't copy"); } ta.remove(); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
}

/* ---------- ticker / modals ---------- */
function startTicker() {
  stopTicker();
  ticker = setInterval(() => {
    if (!game || !ui.player || !ui.player.isConnected) return stopTicker();
    if (ui.countdown && ui.countdown.isConnected) ui.countdown.querySelector("b").textContent = fmtCountdown(msToMidnight());
    if (!game.unlimited && dayIndex() !== game.day) { toast("A new opening just dropped"); start({ unlimited: false }); }
  }, 1000);
}
function stopTicker() { if (ticker) clearInterval(ticker); ticker = null; }
function openHelp() {
  openModal("Openings",
    h("p", null, "Press play and name the show the opening comes from. The first clip is one second; every wrong guess or skip unlocks more (1, 2, 4, 7, 11, then 16 seconds). Six tries."),
    h("p", null, "Yellow means you picked a show from the same studio. After two misses the year it aired unlocks, after four the studio."),
    h("p", null, "The pool is AniList's most popular anime plus everything one of you has rated there, and the theme songs of your cartoons and live-action shows. Sequels count as the same show, so Naruto Shippuden is just Naruto. The daily leans on songs most people recognise; Unlimited can pull anything."),
    h("p", null, "Opening lists come from AnisongDB; clips are Deezer and Apple Music previews of the full songs, so they can start partway into a song."));
}
function openStats() {
  const st = X.S.stats.op || { played: 0, won: 0, streak: 0, max: 0, dist: {} };
  const pct = st.played ? Math.round(100 * st.won / st.played) : 0;
  const maxN = Math.max(1, ...Object.values(st.dist));
  openModal("Opening stats",
    h("div", { class: "stat-grid" }, [["Played", st.played], ["Win %", pct], ["Streak", st.streak], ["Best", st.max]].map(([a, b]) => h("div", { class: "stat" }, h("b", null, b), h("span", null, a)))),
    h("h3", null, "Solved on try"),
    h("div", { class: "dist" }, STEPS.map((sec, i) => { const v = st.dist[i + 1] || 0; return h("div", { class: "drow" }, h("span", null, `${sec}s`), h("div", { class: "dbar" }, v ? h("i", { style: { width: `${Math.max(8, 100 * v / maxN)}%` } }, v) : null)); })));
}

registerTab({
  id: "openings", label: "Openings", help: openHelp,
  home: () => start({ unlimited: false }),
  route: id => { if (id === "openings") { if (!game || !ui.player || !ui.player.isConnected) start({ unlimited: false }); return true; } return false; },
});
window.KAMEDLES_OP = { get game() { return game; }, THEMES, SHOWS };
})();
