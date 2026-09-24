# Kamedles

Daily guessing games for the group, in five tabs:

- **Characters** — mangadle-style character guessing (Classic, Quote, Emoji, Portrait) across 10 anime plus Avatar, Korra, SpongeBob, Power Rangers, Game of Thrones and a combined TeenNick pool (iCarly, Victorious, Drake & Josh, Zoey 101, Big Time Rush), with hand-picked casts.
- **Episodes** — name the episode from a zoomed-in still that zooms out on every miss (Avatar, Korra, AoT, JJK, HxH). You pick the season, book or arc, then the episode.
- **Openings** — name the show from its opening theme, Heardle-style. Two pools: your shows (their anime openings plus the western shows' theme songs) and the most popular anime on AniList.
- **Songs** — Heardle-style: name the song from a 1-second clip that grows to 16 seconds. The pool is every song that shows up in at least two people's exported playlists.
- **Connections** — NYT-style: sort 16 names into four hidden groups. One daily puzzle per show, plus one built from your playlists.

## Run it

Open `index.html` in a browser. No build step or server needed. Portraits, episode stills and song clips load from AniList, Fandom, TVmaze, Deezer and Apple, so you need to be online. (The claude.ai preview copy blocks those outside sources, so pictures and audio only work when you open the real files or host them.)

`node tools/build.js` writes `dist/index.html`, a single self-contained file with everything inlined.

## Folder layout

- `index.html`, `css/`, `js/`, `data/` — the site. This is everything that gets published.
  - `js/app.js` — core + Characters tab (daily seeding, comparisons, stats, site tabs, routing).
  - `js/episodes.js` — Episodes tab.
  - `js/openings.js` — Openings tab.
  - `js/songs.js` — Songs tab (clip player, party scoreboard).
  - `js/connections.js` — Connections tab and its puzzle generator.
  - `data/<series>.js` — one file per show for the Characters tab.
  - `data/images.js` — character portrait URLs.
  - `data/episodes.js` — generated episode lists + stills.
  - `data/songs.js`, `data/song-sources.js` — generated song pool + preview sources.
  - `data/openings.js` — generated opening themes (AniList + AnisongDB + Deezer/Apple).
  - `data/connections.js` — generated Connections group banks.
- `sources/` — raw inputs that never ship (git-ignored): `playlists/` holds everyone's Spotify exports; `tvmaze-episodes.txt` is the episode list pulled from TVmaze.
- `tools/` — build and data scripts (see below).
- `docs/DATA_SPEC.md` — the rules for a character entry.
- `docs/CONNECTIONS_SPEC.md` — the rules for a Connections group; the banks live in `tools/connections/<show>.json`.
- `test/smoke.js` — headless browser test.

## Updating the Songs pool

1. Everyone exports their main playlist or Liked Songs with [Exportify](https://exportify.net) and drops the CSV in `sources/playlists/` named `<Name> Songs.csv` (extra files for the same person: `<Name> Songs 2.csv`).
2. Run `node tools/build-songs.mjs`. It keeps every song at least two different people have (same Spotify track, or same title + lead artist, so single and album versions match) and writes `data/songs.js`.
3. New songs also need a preview source in `data/song-sources.js` (`"spotifyTrackId": [deezerId, itunesId, "alt title", "alt title"]`). Songs without one are left out of the game automatically.
4. Run `node tools/check-song-sources.mjs --fix`. It checks every clip against the Spotify track (same length, artist and title; no sped-up, slowed, remix, live, cover or karaoke versions), swaps wrong ones for the original found on Deezer or Apple Music, finds sources for songs that have none, and drops songs whose original isn't on either service.

## Editing character casts

Edit `data/<series>.js`, then run `node tools/validate.js data/<series>.js`. Each character needs: `id`, `name`, `aliases`, `gender`, `hair`, `affiliation` (array, from the file's `affiliations` vocab), `age` (integer or `null` — the latest age the show gives them, or age at death), `power` (array, from `powers`), `debut` (from `arcs`, which must stay in air order), `quotes` (a list of 2-4 short lines the character says, none naming them; `[]` skips them in Quote mode), `emojis` (exactly 5), `hint`, optional `wiki` (Fandom page title). Portraits live in `data/images.js`; without one the tile shows initials.

Per-series switches: `hairLabel` + `hairVocab` replace the Hair column (SpongeBob uses body Color), `hideAge: true` drops the Age column, `maxPower` raises the 2-power cap, `tagline` adds a line under the name on the home card.

To add a series: create `data/<slug>.js`, add the slug and an accent color in `data/index.js`, and add a `<script>` line in `index.html` before `data/images.js`.

Adding or reordering characters/songs changes which one lands on which day, since the daily pick is a seeded shuffle.

## Tools

- `node tools/validate.js data/*.js` — checks character files against the spec.
- `node tools/build.js` — single-file build in `dist/`.
- `node tools/build-songs.mjs` — rebuilds the song pool from `sources/playlists/`.
- `node tools/check-song-sources.mjs [--fix]` — makes sure every song clip is the original recording (see above). `--only=<title>` checks a single song.
- `node tools/build-openings.mjs` — rebuilds `data/openings.js` (popular anime from AniList, openings from AnisongDB, clips matched on Deezer/Apple; lookups cached in `sources/`).
- `node tools/build-connections.mjs` — checks every group bank and rebuilds `data/connections.js` (plus the Music set from `data/songs.js`).
- `node tools/build-episodes.mjs` — rebuilds `data/episodes.js` from `sources/tvmaze-episodes.txt` + `tools/hxh-titles.json`.
- `node tools/download-images.mjs` — optional: copies every character portrait into `img/` so the site stops hotlinking.

## Daily mechanics

- Day number counts from `2026-09-22` in the player's local time; everything resets at midnight.
- Each game has its own daily answer (per series × mode for Characters, per show for Episodes, one for Songs).
- Stats, streaks, progress and the party scoreboard live in the browser's `localStorage`.

Episode data and stills: [TVmaze](https://www.tvmaze.com) (CC BY-SA). Song clips: Deezer and Apple Music 30-second previews.
