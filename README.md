# Kamedles

Daily guessing games for the group, in three tabs:

- **Characters** — mangadle-style character guessing (Classic, Quote, Emoji) across 10 anime plus Avatar, Korra, SpongeBob, Power Rangers, Game of Thrones and a combined TeenNick pool (iCarly, Victorious, Drake & Josh, Zoey 101, Big Time Rush), with hand-picked casts.
- **Episodes** — name the episode from a zoomed-in still that zooms out on every miss (Avatar, Korra, AoT, JJK, MHA, HxH, CSM, Frieren).
- **Songs** — Heardle-style: name the song from a 1-second clip that grows to 16 seconds. The pool is every song that shows up in at least two people's exported playlists.

## Run it

Open `index.html` in a browser. No build step or server needed. Portraits, episode stills and song clips load from AniList, Fandom, TVmaze, Deezer and Apple, so you need to be online. (The claude.ai preview copy blocks those outside sources, so pictures and audio only work when you open the real files or host them.)

`node tools/build.js` writes `dist/index.html`, a single self-contained file with everything inlined.

## Folder layout

- `index.html`, `css/`, `js/`, `data/` — the site. This is everything that gets published.
  - `js/app.js` — core + Characters tab (daily seeding, comparisons, stats, site tabs, routing).
  - `js/episodes.js` — Episodes tab.
  - `js/songs.js` — Songs tab (clip player, party scoreboard).
  - `data/<series>.js` — one file per show for the Characters tab.
  - `data/images.js` — character portrait URLs.
  - `data/episodes.js` — generated episode lists + stills.
  - `data/songs.js`, `data/song-sources.js` — generated song pool + preview sources.
- `sources/` — raw inputs that never ship (git-ignored): `playlists/` holds everyone's Spotify exports; `tvmaze-episodes.txt` is the episode list pulled from TVmaze.
- `tools/` — build and data scripts (see below).
- `docs/DATA_SPEC.md` — the rules for a character entry.
- `test/smoke.js` — headless browser test.

## Updating the Songs pool

1. Everyone exports their main playlist or Liked Songs with [Exportify](https://exportify.net) and drops the CSV in `sources/playlists/` named `<Name> Songs.csv` (extra files for the same person: `<Name> Songs 2.csv`).
2. Run `node tools/build-songs.mjs`. It keeps every song at least two different people have (same Spotify track, or same title + lead artist, so single and album versions match) and writes `data/songs.js`.
3. New songs also need a preview source in `data/song-sources.js` (`"spotifyTrackId": [deezerId, itunesId, "alt title", "alt title"]`). Songs without one are left out of the game automatically.

## Editing character casts

Edit `data/<series>.js`, then run `node tools/validate.js data/<series>.js`. Each character needs: `id`, `name`, `aliases`, `gender`, `hair`, `affiliation` (array, from the file's `affiliations` vocab), `age` (integer or `null` — the latest age the show gives them, or age at death), `power` (array, from `powers`), `debut` (from `arcs`, which must stay in air order), `quote` (or `null`), `emojis` (exactly 5), `hint`, optional `wiki` (Fandom page title). Portraits live in `data/images.js`; without one the tile shows initials.

Per-series switches: `hairLabel` + `hairVocab` replace the Hair column (SpongeBob uses body Color), `hideAge: true` drops the Age column, `maxPower` raises the 2-power cap, `tagline` adds a line under the name on the home card.

To add a series: create `data/<slug>.js`, add the slug and an accent color in `data/index.js`, and add a `<script>` line in `index.html` before `data/images.js`.

Adding or reordering characters/songs changes which one lands on which day, since the daily pick is a seeded shuffle.

## Tools

- `node tools/validate.js data/*.js` — checks character files against the spec.
- `node tools/build.js` — single-file build in `dist/`.
- `node tools/build-songs.mjs` — rebuilds the song pool from `sources/playlists/`.
- `node tools/build-episodes.mjs` — rebuilds `data/episodes.js` from `sources/tvmaze-episodes.txt` + `tools/hxh-titles.json`.
- `node tools/download-images.mjs` — optional: copies every character portrait into `img/` so the site stops hotlinking.

## Daily mechanics

- Day number counts from `2026-09-22` in the player's local time; everything resets at midnight.
- Each game has its own daily answer (per series × mode for Characters, per show for Episodes, one for Songs).
- Stats, streaks, progress and the party scoreboard live in the browser's `localStorage`.

Episode data and stills: [TVmaze](https://www.tvmaze.com) (CC BY-SA). Song clips: Deezer and Apple Music 30-second previews.
