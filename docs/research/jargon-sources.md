# WoW chat jargon: sources and method

Retrieved: 2026-10-06. Output: `data/glossary/raw-terms.json` (English only, no translations).

This is the raw collection the glossary master (`data/glossary/terms.json`) is built from.
It targets US-realm chat on level-60 Azeroth (Classic-era / WoW: Forever) plus general MMO and
internet slang.

## Schema

Each entry is
`{ term, aliases[], expansion, cat, ambiguity, examples[], source[] }`.

- `term`: unique, case-insensitive. Where one abbreviation means several things (for example
  `SS` = Soulstone / Sinister Strike / Southshore), one entry keeps the abbreviation as `term`.
  The other meanings get their own entries under their full name (`sinister strike`,
  `Southshore`), list the abbreviation in `aliases`, and explain the clash in `ambiguity`.
- `cat`: one of the existing addon categories: `lfg raid loot role class combat trade social zone misc`.
  PvP and reputation terms are in `misc`, profession materials and consumables in `trade`, and
  class abilities and races in `class`.
- `ambiguity`: empty when the term has one meaning. Otherwise it says how to tell the meanings
  apart from context (for example AH, add, port, mats, boost, SR, MS, MC, DM, HS, CoD, k, g, y).
- `source`: ids from the table below. `existing-addon` means the term came from the old
  `addon/WoWChatHelper/Glossary.lua`. All 756 unique terms from that file are kept, and `BRE` was
  corrected from "Black Rock Enchanting items" to Bonereaver's Edge.

## Sources

| id | source | URL | notes |
|---|---|---|---|
| wiki-abbr | Warcraft Wiki: Abbreviation guide | https://warcraft.wiki.gg/wiki/Abbreviation_guide | chat, BG, zone, instance and per-class ability abbreviations |
| wowpro-dict | WoW-Pro: World of Warcraft Dictionary | https://www.wow-pro.com/world-of-warcraft-dictionary/ | general A-Z glossary |
| slangnet | Slang.net: World of Warcraft slang | https://slang.net/terms/world_of_warcraft | short slang list (kek, bio, mule, waggro…) |
| tavern-glossary | Warcraft Tavern: WoW Classic Glossary | https://www.warcrafttavern.com/wow-classic/guides/glossary-abbreviations-acronyms/ | Classic-era instance sub-runs (DMT, Strat UD/Live, Mara princess, UBRS Rend), warlock builds, HR/SR, +1 |
| tavern-worldbuffs | Warcraft Tavern: WoW Classic World Buffs | https://www.warcrafttavern.com/wow-classic/guides/world-buffs/ | Rend/Ony/Nef heads, Songflower, DMT, ZG heart, consumables |
| guildorder-loot | GuildOrder: Classic loot systems (SR, GDKP, DKP) | https://guildorder.com/games/wow_classic/guides/classic-loot-systems-soft-reserve-gdkp | SR / GDKP mechanics |
| frostyboost-loot | FrostyBoost: WoW loot systems explained | https://frostyboost.com/blog/everything-about-gdkp-in-world-of-warcraft | GDKP pot, cut, min bid, MS>OS (search snippet) |
| forever-sources | WoW: Forever pages, see the list below | | Skyborne, Zephras Isle, new zones, dungeons and raids |
| community-usage | author knowledge of US-realm chat | — | **single-source, not cross-checked**: mostly raid boss nicknames, herbs and materials, enchant shorthand, Twitch and internet slang |
| existing-addon | `addon/WoWChatHelper/Glossary.lua` (pre-rewrite) | repo | |

WoW: Forever sources:
- Blizzard forums, "WoW: Forever Meet the New Skyborne": https://us.forums.blizzard.com/en/wow/t/wow-forever-meet-the-new-skyborne/2358236
- VaultAlts, Skyborne race guide: https://vaultalts.com/wow-forever/guides/skyborne-race-starting-zone-and-classes
- LFCarry, Skyborne guide: https://lfcarry.com/guides/wow-forever-skyborne
- Koroboost, WoW Forever overview: https://koroboost.com/guide/wow-forever-overview

Searched or seen but not used as data:
- `warcraft.wiki.gg/wiki/Abbreviations_and_acronyms` and `/wiki/Slang_and_terminology` returned 404.
- barrens.chat glossary returned 403.
- Wowpedia's mirror of the abbreviation guide (https://wowpedia.fandom.com/wiki/Abbreviation_guide) has the same content as wiki-abbr.

## Counts (from a real run of the build script)

- 1826 unique terms and 1048 aliases.
- 178 entries have an ambiguity note.
- 165 entries are confirmed by at least two independent fetched sources (existing-addon and
  community-usage not counted).
- 771 entries rest only on `community-usage`. Treat these as plausible, not verified.
- By category: social 297, class 292, misc 232, trade 210, zone 167, raid 162, combat 160,
  loot 131, lfg 125, role 50.

## Caveats

- **WoW: Forever details are unverified, and the sources disagree.** For example, the guides
  contradict each other on which faction can play a Skyborne Mage and which can play a Skyborne
  Shaman. The pages are pre-launch guides (launch is 2026-11-04). Zone and dungeon names are
  usable as names, but do not rely on level ranges or class restrictions.
- **Some terms are not from Classic and may still appear in chat**, from retail players or memes:
  Kara, heroic/HC, Bloodlust/Heroism, Misdirect, Belf, LFR, RDF, table (Ritual of Refreshment),
  GS (gear score). Their `ambiguity` field says so. `HC` on Classic now usually means Hardcore.
- Classic-era items whose availability in WoW: Forever is unknown are marked in `ambiguity`:
  Chronoboon, layering, and the campsite feature.
- Some single-letter terms are kept because players really type them: `u r y k g X F W L` from
  the old addon plus new ones. Matching them on word boundaries in the bridge will give false
  hits, so the bridge should require case or context, or limit how often they are added.
- Material and recipe names appear because trade chat uses them. They are proper nouns, so the
  translation step should use the official localized item name where possible rather than a
  literal translation.
- `Chinese farmer` is kept only so the explanation can be neutral. The term is a dated
  stereotype, and replies should not use it.
