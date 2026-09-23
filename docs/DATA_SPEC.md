# Kamedles character data spec (v2)

You are producing or editing ONE JavaScript data file for a Wordle-style character guessing game
(like mangadle.net / loldle). Series are mostly anime, plus a few western shows. Output file path
is given in your task. The file must be valid JavaScript that runs in a browser with no build step.
"The show" below means the animated/live-action TV series (and any films your task names) — never
the manga, comics, or other spin-off material.

## File shape (exact)

```js
window.DLE = window.DLE || {};
window.DLE.series = window.DLE.series || {};
window.DLE.series["SLUG"] = {
  id: "SLUG",
  title: "Full Title",
  short: "Short",                 // <= 12 chars, e.g. "AoT", "JJK", "One Piece"
  cutoff: "One sentence: exactly what anime content this covers.",
  affiliationLabel: "Affiliation", // column header; series-specific is better ("Crew", "Squad", "Village")
  powerLabel: "Power",             // column header; series-specific ("Nen Type", "Devil Fruit", "Quirk Type", ...)
  affiliations: ["...", "..."],    // controlled vocabulary, 8-18 entries, most-to-least common
  powers: ["...", "..."],          // controlled vocabulary, 4-10 entries
  arcs: ["...", "..."],            // ORDERED list of arcs/seasons as aired, 5-16 entries
  // OPTIONAL per-series overrides (only when your task says so):
  // hairLabel: "Color", hairVocab: ["Yellow", ...],  // replaces the Hair column + its vocab
  // tagline: "Show A · Show B",                      // OPTIONAL line under the name on the home card
  // hideAge: true,                                    // drop the Age column (series with no canon ages)
  // maxPower: 3,                                      // allow up to 3 power entries per character
  characters: [
    {
      id: "kebab-case-unique",
      name: "Official English name (Crunchyroll/Viz spelling)",
      aliases: ["Alt spelling", "Nickname fans type"],  // may be []
      gender: "Male" | "Female" | "Other",
      hair: "<one of the hair vocab below>",
      affiliation: ["<from affiliations>", ...],  // 1-3 entries, ALL major groups they've belonged to in the anime
      age: 19 | null,                              // integer; see AGE RULE (latest age, not debut age)
      power: ["<from powers>", ...],               // 1-2 entries
      debut: "<from arcs>",                        // arc where they FIRST appear on screen in the anime
      quotes: ["Short line (max 15 words) they say in the show", "..."],  // 0-6 entries; [] = skipped in Quote mode
      emojis: ["🍖","👒","🏴‍☠️","👑","☀️"],          // EXACTLY 5, vaguest -> most revealing
      hint: "One sentence describing them without their name, spoiler-light.",
      wiki: "Exact page title on the series' Fandom wiki"   // OPTIONAL; used to look up a portrait image
    }
  ]
};
```

## Hard rules

1. **The show only.** Everything (cast, affiliations, powers, debut arc, quotes, ages) must come from
   the show up to the cutoff given in your task. No manga-only characters, no manga-only reveals.
2. **Relevance is the whole point of this site.** Include ~36-48 characters (big casts like One Piece
   or Naruto may go to ~65): main cast, major
   supporting cast, major villains, and the memorable arc-level side characters a fan who watched
   the anime would know by name. NO animals/mounts, NO one-scene characters, NO background
   soldiers, NO characters only mentioned by name. Ask: "would a fan recognize this name and be
   able to guess it?" If not, cut it.
3. **Controlled vocab.** Every `affiliation`, `power`, and `debut` value MUST be a string that
   appears verbatim in the series' `affiliations`, `powers`, `arcs` arrays. Keep vocab tight:
   merge tiny groups into a broader category rather than adding one-off entries.
4. **Hair vocab (exact strings, unless the series sets hairVocab):** Black, Brown, Blonde, White,
   Grey, Red, Orange, Pink, Purple, Blue, Green, Bald, Other. Silver -> White. Base/default form only (no transformations).
   Use "Other" for characters with no hair color in the ordinary sense (masked, non-humanoid, etc.).
5. **AGE RULE (v2 — latest age):** the character's age at the LATEST point the show depicts them,
   up to the cutoff. If the character dies in the show, use their age at death. Use the era's
   official/canon numbers (e.g. post-timeskip ages for One Piece, end-of-Shippuden ages for
   Naruto, Final Season ages for AoT). Characters only seen in flashbacks get the age of the latest
   flashback they appear in. Integer. If canon only gives a range or "over N", use the lowest stated
   number. If truly unknown or ageless, use null. Never guess a number you cannot justify; null is
   better than wrong. Do NOT mention death in hints just because you used an age at death.
   Ignore flash-forward epilogues ("X years later" finales) — use ages at the end of the main story,
   since epilogue ages are rarely canon.
6. **No alive/dead status anywhere** (not in fields, hints, or quotes).
7. **Quotes:** 2-4 short, recognizable lines (<= 15 words each) the character actually says in the
   show, in the common English rendering. Quote mode shows one per puzzle and rotates through a
   character's lines on repeat appearances, so variety matters. A quote must never give away who is
   speaking: no own name, surname, nickname, alias, title or epithet ("Gold Ranger Power!", "Tobi is
   a good boy!", "I'm the Fourth Hokage"), no roll calls or morph calls that announce their own
   ranger color/number, no self-introductions. Mentioning *other* characters is fine. No song lyrics.
   No two characters in a series may share a quote. Never invent or paraphrase a line: use only
   quotes you have verified (see Process). If a character has no verifiable line, use `quotes: []`
   (the game skips them in Quote mode). Aim for quotes on at least 70% of characters.
8. **Emojis:** exactly 5 per character. They describe the character (appearance, power, role,
   iconic objects/moments). Ordered vaguest -> most revealing. Never use letters, flags, or emojis
   that spell the name. Every entry must be a single emoji (ZWJ sequences are fine).
9. **Hint:** one sentence, no name, no spoilers about deaths/betrayals; describe role/power/look.
   No alias, surname or title that names them outright ("Third Hokage", "Straw Hat", "Uchiha").
10. **Names:** use the spelling used by Crunchyroll/Viz subtitles. Put other common spellings and
    nicknames in `aliases` (e.g. "Zolo", "Jaeger", "Tsuna"). Aliases are used for search matching.
11. **ids:** kebab-case, unique within the file, ASCII only.
12. **Debut arc:** the arc/season in which the character first physically appears on screen
    (flashback appearances count as an appearance). Arc names should be the ones fans use for the
    ANIME (season or arc names), ordered strictly by air order.
13. Valid JS: double-quoted strings, escape internal quotes, trailing commas fine, no comments
    needed. Test-load it with `node -e "global.window={};require('<path>');console.log(Object.keys(window.DLE.series))"`
    before finishing.

## Process

- Draft the character list first and prune it against rule 2 before writing attributes.
- Where you are unsure of an age, hair color, or debut arc, verify against a wiki (fandom wiki,
  Wikipedia) using WebFetch. If a fetch fails, rely on your knowledge but prefer null for age over
  a guess.
- Verify every quote against a source you fetched: Wikiquote, the show's Fandom wiki (character
  quote sections, episode transcripts) or another transcript site. Recalling a line is not enough.
- Run the node load test, then run `node tools/validate.js <path>` if it exists and
  fix every reported error.
- Your final message: a 5-line summary (character count, quote coverage, any characters you were
  unsure about and why). Nothing else.
