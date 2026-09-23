/* Kamedles — Songs tab: Heardle-style guess-the-song from the group's shared playlists. */
(() => {
"use strict";
const X = window.SHD, SONGS = window.DLE && window.DLE.songs;
if (!X || !SONGS) return;
const { h, toast, openModal, dayIndex, fmtDay, fmtCountdown, msToMidnight, seededShuffle, cyrb53, norm, plural, setAccent, setHash, topBar, registerTab, app } = X;
const SRC = (window.DLE && window.DLE.songSrc) || {};
const STEPS = [1, 2, 4, 7, 11, 16];
const MAX = STEPS[STEPS.length - 1];
const ACCENT = "#1ed760";
const PEOPLE = SONGS.people;

/* ---------- pool ---------- */
const lead = a => norm(String(a).split(",")[0]);
const POOL = SONGS.list.filter(s => SRC[s.id] && (SRC[s.id][0] || SRC[s.id][1])).map(s => {
  const src = SRC[s.id];
  const terms = [norm(s.t), norm(s.a), norm(`${s.t} ${s.a}`)];
  for (const alt of [src[2], src[3]]) if (alt && !terms.includes(norm(alt))) terms.push(norm(alt));
  return { ...s, key: s.id, dz: src[0] || 0, it: src[1] || 0, terms, lead: lead(s.a) };
}).sort((a, b) => a.id < b.id ? -1 : 1);
POOL.forEach((s, i) => { s.sort = -s.pop; s.idx = i; });
const byId = Object.fromEntries(POOL.map(s => [s.id, s]));

function dailySong(day) {
  const n = POOL.length, cycle = Math.floor(day / n), idx = ((day % n) + n) % n;
  return seededShuffle(POOL, cyrb53(`songs|${cycle}`) >>> 0)[idx];
}
const REC = day => `songs:${day}`;

/* ---------- preview lookup (Deezer JSONP first, then iTunes) ---------- */
let jsonpSeq = 0;
function jsonp(url, ms = 9000) {
  return new Promise((resolve, reject) => {
    const cb = "__shdz" + (++jsonpSeq), sc = document.createElement("script");
    const done = (fn, v) => { clearTimeout(t); delete window[cb]; sc.remove(); fn(v); };
    const t = setTimeout(() => done(reject, new Error("timeout")), ms);
    window[cb] = d => done(resolve, d);
    sc.onerror = () => done(reject, new Error("blocked"));
    sc.src = `${url}${url.includes("?") ? "&" : "?"}output=jsonp&callback=${cb}`;
    document.head.append(sc);
  });
}
const cache = {};
// Second line of defence behind tools/check-song-sources.mjs: a source whose track length is off from
// Spotify's is a different recording (sped up, slowed, edit…), so skip it.
const sameLength = (song, ms) => !song.d || !ms || Math.abs(ms - song.d) <= Math.max(4000, song.d * 0.02);
async function lookup(song) {
  if (cache[song.id]) return cache[song.id];
  let info = null;
  if (song.dz) {
    try {
      const d = await jsonp(`https://api.deezer.com/track/${song.dz}`);
      if (d && d.preview && sameLength(song, d.duration * 1000)) info = { url: d.preview, art: (d.album && (d.album.cover_xl || d.album.cover_big)) || "", link: d.link, via: "Deezer" };
    } catch (e) { /* fall through to iTunes */ }
  }
  if (!info && song.it) {
    try {
      const r = await fetch(`https://itunes.apple.com/lookup?id=${song.it}&country=US`);
      const j = await r.json(), t = j.results && j.results[0];
      if (t && t.previewUrl && sameLength(song, t.trackTimeMillis)) info = { url: t.previewUrl, art: (t.artworkUrl100 || "").replace("100x100bb", "600x600bb"), link: t.trackViewUrl, via: "Apple Music" };
    } catch (e) { /* no preview */ }
  }
  if (info) cache[song.id] = info;
  return info;
}

/* ---------- state ---------- */
let game = null, ui = {}, audio = null, raf = 0, ticker = null;
const prefs = () => X.S.prefs;
// A saved daily keeps its song even if the pool changed since. Older saves didn't store it, but for a
// solved one it's the last guess.
function savedSong(saved) {
  if (!saved) return null;
  const last = saved.steps && saved.steps[saved.steps.length - 1];
  const id = saved.answer || (saved.solved && last && last.id);
  return (id && byId[id]) || null;
}
function start(opts = {}) {
  stopAudio();
  audio = null;
  if (!POOL.length) {
    X.stopTicker(); stopTicker(); setHash("songs");
    app.replaceChildren(topBar({ tab: "songs", help: openHelp }), h("section", { class: "hero" }, h("h1", { class: "hero-title" }, "Songs"),
      h("p", { class: "hero-sub" }, "No songs with previews yet. Run node tools/build-songs.mjs and add data/song-sources.js.")));
    return;
  }
  const unlimited = opts.unlimited != null ? opts.unlimited : !!(game && game.unlimited);
  const day = dayIndex();
  let answer, saved = null;
  if (unlimited) {
    const filt = prefs().songPeople || [];
    let pool = filt.length ? POOL.filter(s => s.p.some(i => filt.includes(i))) : POOL;
    if (!pool.length) pool = POOL;
    do { answer = pool[Math.floor(Math.random() * pool.length)]; } while (pool.length > 1 && opts.avoid === answer.id);
  } else { saved = X.S.games[REC(day)]; answer = savedSong(saved) || dailySong(day); }
  game = { unlimited, day, answer, steps: saved ? saved.steps.slice() : [], solved: !!(saved && saved.solved), gaveUp: !!(saved && saved.gaveUp), info: null, failed: false };
  setAccent(null); document.documentElement.style.setProperty("--accent", ACCENT);
  setHash("songs");
  render();
  lookup(answer).then(info => { if (game && game.answer === answer) { game.info = info; game.failed = !info; renderPlayer(); if (over()) showResult(false); } });
}
const over = () => game.solved || game.gaveUp;
const clipLen = () => over() ? 30 : STEPS[Math.min(game.steps.length, STEPS.length - 1)];
function persist(outcome) {
  if (game.unlimited) return;
  const S = X.S;
  S.games[REC(game.day)] = { answer: game.answer.id, steps: game.steps, solved: game.solved, gaveUp: game.gaveUp };
  if (outcome) {
    const st = S.stats.songs || (S.stats.songs = { played: 0, won: 0, streak: 0, max: 0, lastDay: null, dist: {} });
    st.played++;
    if (outcome === "win") { st.won++; st.streak = st.lastDay === game.day - 1 ? st.streak + 1 : 1; st.max = Math.max(st.max, st.streak); const n = game.steps.length; st.dist[n] = (st.dist[n] || 0) + 1; }
    else st.streak = 0;
    st.lastDay = game.day;
  }
  X.saveState();
}

/* ---------- audio ---------- */
let playing = false;
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
// Play picks up where a pause left off, and starts over once the unlocked clip has run out. The limit is
// read every frame, so unlocking more (a skip or a wrong guess) mid-play just lets the song keep going.
async function play(fromStart) {
  if (!game.info) return toast(game.failed ? "No preview for this one" : "Still loading the clip…");
  if (!audio || audio.dataset.src !== game.info.url) { if (audio) audio.pause(); audio = new Audio(game.info.url); audio.dataset.src = game.info.url; audio.preload = "auto"; }
  audio.volume = prefs().songVol != null ? prefs().songVol : 0.7;
  cancelAnimationFrame(raf);
  if (fromStart || audio.ended || audio.currentTime >= clipLen() - 0.05) audio.currentTime = 0;
  try { await audio.play(); } catch (e) { setPlaying(false); return toast("Tap play again — the browser blocked autoplay"); }
  setPlaying(true);
  const tick = () => {
    if (!ui.player || !ui.player.isConnected) { stopAudio(); return; }
    const t = audio.currentTime;
    drawProgress(t);
    if (t >= clipLen() || audio.ended) { audio.pause(); setPlaying(false); drawProgress(clipLen()); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
function togglePlay() { if (playing) stopAudio(); else play(false); }

/* ---------- render ---------- */
function render() {
  X.stopTicker(); stopTicker();
  ui = {};
  const day = game.day;
  const head = h("div", { class: "play-head" },
    h("div", null,
      h("h1", { class: "series-title" }, "Name that song"),
      h("p", { class: "cutoff" }, `${POOL.length.toLocaleString()} songs that at least two of you have saved (${PEOPLE.join(", ")}). Six tries; the clip gets longer every time.`)),
    h("div", { class: "daybadge" }, game.unlimited ? "Unlimited · practice" : `Daily #${day + 1} · ${fmtDay(day)}`));
  const toggle = h("div", { class: "seg small", role: "tablist", "aria-label": "Daily or unlimited" },
    h("button", { role: "tab", "aria-selected": String(!game.unlimited), onclick: () => start({ unlimited: false }) }, "Daily"),
    h("button", { role: "tab", "aria-selected": String(game.unlimited), onclick: () => start({ unlimited: true }) }, "Unlimited"));
  const vol = h("input", { type: "range", id: "song-vol", min: "0", max: "1", step: "0.05", value: String(prefs().songVol != null ? prefs().songVol : 0.7), "aria-label": "Volume",
    oninput: e => { prefs().songVol = +e.target.value; if (audio) audio.volume = +e.target.value; X.saveState(); } });
  const controls = h("div", { class: "controls" }, h("label", { class: "vol" }, "🔊", vol), toggle);

  ui.player = h("div", { class: "player" });
  ui.form = X.searchBox({
    placeholder: "Type a song or artist…",
    items: () => POOL,
    exclude: () => new Set(game.steps.filter(s => s.id).map(s => s.id)),
    render: s => h("span", { class: "sug-name" }, h("span", null, s.t), h("span", { class: "alias" }, s.a)),
    onPick: s => guess(s),
    empty: "Not in the pool. Only songs at least two of you have saved are in it.",
  });
  ui.attempts = h("div", { class: "attempts" });
  ui.result = h("div", { class: "result-host" });
  const board = h("section", { class: "board song-board", "aria-live": "polite" }, ui.player, ui.form, ui.result, ui.attempts);
  const parts = [topBar({ tab: "songs", stats: openStats, help: openHelp }), head, controls];
  if (game.unlimited) parts.push(peopleFilter());
  parts.push(board, partyPanel());
  app.replaceChildren(...parts);
  renderPlayer(); renderAttempts();
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
  const skip = !over() && h("button", { class: "btn small", onclick: skipStep, disabled: n >= STEPS.length - 1 && !game.unlimited && false }, n >= STEPS.length - 1 ? "Give up" : `Skip (+${next}s)`);
  const status = game.failed ? h("p", { class: "player-note" }, "Couldn't load a preview for this song. The claude.ai preview blocks outside audio — open the site from your folder. If you're already there, this track may be region-locked.")
    : !game.info ? h("p", { class: "player-note" }, "Loading clip…") : null;
  ui.player.replaceChildren(
    h("div", { class: "player-row" }, ui.playBtn,
      h("div", { class: "bar" }, unlocked, ui.fill, ...marks), ui.time),
    h("div", { class: "player-actions" }, h("span", { class: "clip-label" }, over() ? "Full 30-second preview" : `Clip: ${len} second${len === 1 ? "" : "s"} · try ${Math.min(n + 1, 6)} of 6`), skip || ""),
    ...(status ? [status] : []));
}
function renderAttempts() {
  ui.attempts.replaceChildren(...Array.from({ length: 6 }, (_, i) => {
    const st = game.steps[i];
    if (!st) return h("div", { class: "att empty" }, h("span", { class: "att-n" }, i + 1), h("span", null, i === game.steps.length && !over() ? "…" : ""));
    if (st.k === "skip") return h("div", { class: "att skip" }, h("span", { class: "att-n" }, i + 1), h("span", null, "Skipped"));
    const s = byId[st.id];
    const cls = st.id === game.answer.id ? "ok" : s && s.lead === game.answer.lead ? "part" : "bad";
    return h("div", { class: `att ${cls}` }, h("span", { class: "att-n" }, i + 1),
      h("span", { class: "att-name" }, s ? s.t : "?", h("small", null, s ? ` — ${s.a}` : "")),
      h("span", { class: "att-tag" }, cls === "ok" ? "✓" : cls === "part" ? "right artist" : "✕"));
  }));
}
function guess(s) {
  if (!game || over()) return;
  game.steps.push({ k: "guess", id: s.id });
  const win = s.id === game.answer.id;
  if (win) game.solved = true;
  else if (game.steps.length >= 6) game.gaveUp = true;
  persist(win ? "win" : game.gaveUp ? "loss" : null);
  if (over()) stopAudio(); // a wrong guess mid-play just unlocks more and keeps it going
  renderPlayer(); renderAttempts();
  if (over()) showResult(true); else ui.form.input.focus({ preventScroll: true });
}
function skipStep() {
  if (!game || over()) return;
  game.steps.push({ k: "skip" });
  if (game.steps.length >= 6) game.gaveUp = true;
  persist(game.gaveUp ? "loss" : null);
  if (over()) { stopAudio(); renderPlayer(); renderAttempts(); showResult(true); return; }
  renderPlayer(); renderAttempts();
  // Already playing: the longer limit lets it run on into the newly unlocked part. Otherwise play the new clip.
  if (!playing) play(true);
}
function showResult(animate) {
  if (!ui.result) return;
  const a = game.answer, n = game.steps.length, info = game.info;
  ui.form.hidden = true;
  const actions = h("div", { class: "result-actions" });
  if (!game.unlimited) {
    actions.append(h("button", { class: "btn primary", onclick: share }, "Share result"), h("button", { class: "btn", onclick: () => start({ unlimited: true }) }, "Unlimited"));
    ui.countdown = h("span", { class: "countdown" }, "Next song in ", h("b", null, fmtCountdown(msToMidnight())));
    actions.append(ui.countdown);
  } else {
    actions.append(h("button", { class: "btn primary", onclick: () => start({ unlimited: true, avoid: a.id }) }, "Next song"),
      h("button", { class: "btn", onclick: () => start({ unlimited: false }) }, "Back to daily"));
  }
  const links = h("div", { class: "song-links" },
    h("a", { href: `https://open.spotify.com/track/${a.id}`, target: "_blank", rel: "noopener" }, "Open in Spotify"),
    info && info.link && h("a", { href: info.link, target: "_blank", rel: "noopener" }, `Open on ${info.via}`));
  const panel = h("div", { class: "result", style: animate ? null : { animation: "none" } },
    h("h2", null, game.solved ? (n === 1 ? "One second. Wow." : n <= 3 ? "Called it." : "Got it!") : "It was…"),
    h("p", { class: "sub" }, game.solved ? `Solved on try ${n}${game.unlimited ? "" : ` · Daily #${game.day + 1}`}` : "Out of tries"),
    h("div", { class: "answer song-answer" },
      info && info.art ? h("img", { class: "album-art", src: info.art, alt: "", referrerpolicy: "no-referrer" }) : h("span", { class: "album-art blank" }, "♪"),
      h("div", null,
        h("div", { class: "answer-name" }, a.t),
        h("div", { class: "answer-hint" }, `${a.a}${a.al ? ` · ${a.al}` : ""}${a.y ? ` (${a.y})` : ""}`),
        h("div", { class: "who" }, h("span", { class: "who-label" }, `In ${a.p.length} playlists:`), ...a.p.map(i => h("span", { class: "chip on" }, PEOPLE[i]))),
        links)),
    actions);
  ui.result.replaceChildren(panel);
}
function share() {
  const n = game.steps.length;
  const row = Array.from({ length: 6 }, (_, i) => {
    const st = game.steps[i];
    if (!st) return "⬜";
    if (st.k === "skip") return "⬛";
    if (st.id === game.answer.id) return "🟩";
    const s = byId[st.id];
    return s && s.lead === game.answer.lead ? "🟨" : "🟥";
  }).join("");
  const lines = [`${X.APP.name} Songs #${game.day + 1}`, `🔊${row}`, game.solved ? `Got it in ${STEPS[n - 1]}s` : "Didn't get it"];
  if (/^https?:/.test(location.protocol)) lines.push(location.href.split("#")[0] + "#songs");
  const text = lines.join("\n");
  const done = () => toast("Copied to clipboard");
  const fallback = () => { const ta = h("textarea", { style: { position: "fixed", opacity: 0 } }, text); document.body.append(ta); ta.select(); try { document.execCommand("copy"); done(); } catch (e) { toast("Couldn't copy"); } ta.remove(); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
}

/* ---------- people filter (unlimited) ---------- */
function peopleFilter() {
  const sel = new Set(prefs().songPeople || []);
  const count = () => { const f = [...sel]; return f.length ? POOL.filter(s => s.p.some(i => f.includes(i))).length : POOL.length; };
  const note = h("span", { class: "filter-note" }, `${count().toLocaleString()} songs`);
  const chips = PEOPLE.map((name, i) => h("button", { class: `chip${sel.has(i) ? " on" : ""}`, "aria-pressed": String(sel.has(i)), onclick: e => {
    if (sel.has(i)) sel.delete(i); else sel.add(i);
    prefs().songPeople = [...sel]; X.saveState();
    e.currentTarget.classList.toggle("on"); e.currentTarget.setAttribute("aria-pressed", String(sel.has(i)));
    note.textContent = `${count().toLocaleString()} songs`;
  } }, name));
  return h("div", { class: "people-filter" }, h("span", { class: "filter-label" }, "Only songs saved by:"), ...chips, note);
}

/* ---------- party scoreboard (for streamed game nights) ---------- */
function partyPanel() {
  const P = prefs().party || (prefs().party = { players: PEOPLE.map(n => ({ n, s: 0 })), open: false });
  const body = h("div", { class: "party-body" });
  // One fixed column per player, in the order they were added, so nobody jumps around when a point
  // lands. The leader just gets highlighted.
  const draw = () => {
    const top = Math.max(0, ...P.players.map(p => p.s));
    body.replaceChildren(
      h("div", { class: "party-cols" }, ...P.players.map((p, i) => h("div", { class: `party-col${top > 0 && p.s === top ? " lead" : ""}` },
        h("span", { class: "party-name", title: p.n }, p.n),
        h("b", { class: "party-score" }, p.s),
        h("div", { class: "party-btns" },
          h("button", { class: "btn small", "aria-label": `Take a point from ${p.n}`, onclick: () => { p.s = Math.max(0, p.s - 1); X.saveState(); draw(); } }, "−"),
          h("button", { class: "btn small primary", "aria-label": `Give ${p.n} a point`, onclick: () => { p.s++; X.saveState(); draw(); } }, "+1")),
        h("button", { class: "link-btn party-remove", "aria-label": `Remove ${p.n}`, onclick: () => { P.players.splice(i, 1); X.saveState(); draw(); } }, "remove")))),
      h("form", { class: "party-add", onsubmit: e => { e.preventDefault(); const v = e.target.elements.pname.value.trim(); if (v) { P.players.push({ n: v, s: 0 }); e.target.reset(); X.saveState(); draw(); } } },
        h("input", { name: "pname", id: "party-name", placeholder: "Add a player", "aria-label": "Player name", autocomplete: "off" }),
        h("button", { class: "btn small", type: "submit" }, "Add"),
        h("button", { class: "link-btn", type: "button", onclick: () => { P.players.forEach(p => p.s = 0); X.saveState(); draw(); } }, "Reset scores")));
  };
  draw();
  const d = h("details", { class: "party", open: P.open ? true : null, ontoggle: e => { P.open = e.target.open; X.saveState(); } },
    h("summary", null, "Party scoreboard", h("span", null, "for game night on stream")), body);
  return d;
}

/* ---------- ticker / modals ---------- */
function startTicker() {
  stopTicker();
  ticker = setInterval(() => {
    if (!game || !ui.player || !ui.player.isConnected) return stopTicker();
    if (ui.countdown && ui.countdown.isConnected) ui.countdown.querySelector("b").textContent = fmtCountdown(msToMidnight());
    if (!game.unlimited && dayIndex() !== game.day) { toast("A new daily song just dropped"); start({ unlimited: false }); }
  }, 1000);
}
function stopTicker() { if (ticker) clearInterval(ticker); ticker = null; }
function openHelp() {
  openModal("Songs",
    h("p", null, "Press play and name the song. The first clip is one second; every wrong guess or skip unlocks more (1, 2, 4, 7, 11, then 16 seconds). Six tries total."),
    h("p", null, "Yellow means you got the artist right but the wrong song."),
    h("p", null, `The pool is every song that shows up in at least two people's exported Spotify playlists (${PEOPLE.join(", ")}), so somebody else always knows it. The answer card shows whose playlists it's in.`),
    h("p", null, "Unlimited lets you filter to songs a few specific people have saved, and the party scoreboard keeps points when you're playing together on stream."),
    h("p", null, "Clips are the 30-second previews from Deezer (Apple Music as a backup)."));
}
function openStats() {
  const st = X.S.stats.songs || { played: 0, won: 0, streak: 0, max: 0, dist: {} };
  const pct = st.played ? Math.round(100 * st.won / st.played) : 0;
  const maxN = Math.max(1, ...Object.values(st.dist));
  openModal("Song stats",
    h("div", { class: "stat-grid" }, [["Played", st.played], ["Win %", pct], ["Streak", st.streak], ["Best", st.max]].map(([a, b]) => h("div", { class: "stat" }, h("b", null, b), h("span", null, a)))),
    h("h3", null, "Solved on try"),
    h("div", { class: "dist" }, STEPS.map((sec, i) => { const v = st.dist[i + 1] || 0; return h("div", { class: "drow" }, h("span", null, `${sec}s`), h("div", { class: "dbar" }, v ? h("i", { style: { width: `${Math.max(8, 100 * v / maxN)}%` } }, v) : null)); })));
}

registerTab({
  id: "songs", label: "Songs", help: openHelp,
  home: () => start({ unlimited: false }),
  route: id => { if (id === "songs") { if (!game || !ui.player || !ui.player.isConnected) start({ unlimited: false }); return true; } return false; },
});
window.KAMEDLES_SONGS = { get game() { return game; }, POOL };
})();
