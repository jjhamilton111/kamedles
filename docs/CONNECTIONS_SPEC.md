# Connections group bank spec

The Connections tab is NYT-Connections-style: 16 tiles, find the four groups of four. Puzzles are
generated from a bank of **groups** per show: each day the game picks 4 groups from one show's bank
and 4 members of each, making sure every tile belongs to exactly one of the chosen groups.

That guarantee only holds if every group is a **closed set**, so the rules below matter more than
cleverness.

## File

One file per show: `tools/connections/<slug>.json` (slug = the show's id in `data/`, e.g. `onepiece`).
`node tools/build-connections.mjs` validates every file and compiles them into `data/connections.js`.
Banks moved into `tools/connections/paused/` are kept but left out of the build.

```json
{
  "show": "onepiece",
  "groups": [
    {
      "title": "Straw Hat Pirates",
      "level": 1,
      "def": "Every official member of the crew as of the anime (ep. 1178).",
      "members": ["Luffy", "Zoro", "Nami", "Usopp", "Sanji", "Chopper", "Robin", "Franky", "Brook", "Jinbe"],
      "source": "https://onepiece.fandom.com/wiki/Straw_Hat_Pirates"
    }
  ]
}
```

## Rules

1. **Closed sets.** `members` lists *everyone* who fits the definition, not just four. The file's
   *universe* is every name that appears in any group of the file; for every group, every name in the
   universe must be either in `members` or clearly not fit `def`. (If "Swordsmen" is a group and
   "Kisame" appears anywhere in the file, Kisame must be in Swordsmen.) Open-ended traits you can't
   check against the whole universe ("strong characters", "fan favourites") are not allowed.
2. **Precise `def`.** One sentence saying exactly who counts, including edge cases (former members,
   temporary members, people who died). The player never sees `def`; it's how we check the group.
3. **The show only**, up to the show's `cutoff` in `data/<slug>.js`. No manga-only facts.
4. **Display names** are the short names fans use ("Luffy", "Kakashi", "Gojo"), at most ~14
   characters. The same person is the *exact same string* in every group of the file. Two different
   people never share a string (disambiguate: "Kid (Eustass)").
5. **4 to 14 members** per group. Groups with 5+ members give the generator room to vary puzzles.
6. **Levels** (the tile colour once solved): 1 = anyone who watched gets it, 2 = regular fans,
   3 = dedicated fans, 4 = the trick group (wordplay on names, a sneaky shared trait, trivia).
   Aim for a spread: roughly a third level 1, a third level 2, the rest 3–4.
7. **Overlap is good.** A character can sit in several groups (Zoro: Straw Hats *and* Swordsmen).
   The generator never puts an overlapping character on the board for two chosen groups, so overlaps
   just make the other tiles more confusing — which is the fun of the game.
8. **Titles** are short and plain ("Akatsuki members", "Hokages", "Waterbenders", "Names that are
   also foods"). Level-4 titles may be playful.
9. **Enough groups.** At least 10 groups per show (15–25 for big casts) so daily puzzles stay fresh
   for months. At least 3 groups must be level 3 or 4.
10. Every group needs a `source` URL you actually checked (wiki page, episode list, etc.).
11. **Never two slices of one list on a board.** Groups that split one list along a line players can't
    see from the names ("Big Time Rush cast" vs "BTR's recurring characters", Class 1-A boys vs girls,
    current vs former squad members, "introduced in arc X" vs "arc Y") share a `"family": "<name>"`;
    groups with the same family never appear together. For a one-off pair, list the other group's title
    in `"avoid": ["<title>"]` (either side is enough). Parallel categories that are easy to tell apart
    (two different teams, two nations, two Nen types) don't need this.

Run `node tools/build-connections.mjs` when done: it checks the format, flags names that look like
the same person spelled two ways, and simulates a few hundred daily puzzles to prove the bank can
fill them.
