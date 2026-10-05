# Glossary audit (addon/WoWChatHelper/Glossary.lua, as of commit 82d20b9)

Date: 2026-10-06. Scope: every `terms` entry (~760) and every `phrases` entry (~215) of the
old single-locale glossary, audited for the move to `data/glossary/terms.json` +
`phrases.json`. Audience: the agents that build the new JSON data and the bridge
term-injection.

Evidence grades: **[K]** well-known community usage (WoW Classic-era / US realms; no single
source needed), **[C]** checked against repo code in this session, **[NV]** not verified
(mostly official zhTW/zhCN in-game names, quoted from memory; verify against Wowhead
zhTW/zhCN pages before shipping, or leave as AI-generated).

WoW: Forever context (docs/research/transport-research.md Q1): Blizzard "Classic+" mode,
2004-era Azeroth, level cap 60, Retail 12.1.5 UI API, plus **new** zones/raids/race
(Skyborne). Content names after 1.12 (TBC+) are mismatches unless Forever adds them.

---

## 0. Root cause of the triggering bug, and what the data must carry

- Chat `ah isn't down for everyone` was read by haiku as `啊` + "mob not down". Two
  independent jargon readings were missed: **AH = Auction House** and **down = not
  working / unavailable** ("is X down for everyone, or just me?" is the standard
  US phrase for "is the service broken for everyone"). "Down" also has the opposite
  boss meaning ("Rag down" = Ragnaros killed). [K]
- `bridge/ai.js` never sees the glossary ([C]: the only glossary is the Lua table; the
  prompt at bridge/ai.js:42-59 has no term list). The prompt's own few-shot example
  (bridge/ai.js:59) teaches `HC = Heroic` and `DM = Deadmines` — both wrong for a
  Classic-era level-60 world (see 2.1, 2.2). Fix the example together with the data.
- Therefore the new data needs, at minimum: `AH` with an ambiguity note, a **`down`
  / `up` / `is down` entry**, and ambiguity notes on every short token that collides
  with an ordinary English word (section 3).

Recommended `AH` record:

```json
{ "term": "AH", "aliases": ["auction house", "auc", "the ah"], "expansion": "Auction House",
  "cat": "trade",
  "ambiguity": "lowercase 'ah' can be the interjection (ah, ok). In trade/price/'ah is down'/'check the ah'/'on the ah'/'ah price' context it is the Auction House",
  "examples": ["ah is down", "check the ah", "ah price is 5g", "ah isn't down for everyone"] }
```

Recommended `down` record (cat misc):
expansion "not working / offline (service); or killed (boss)", ambiguity "'X is down' about
AH/server/mail/realm/website = broken or offline; 'boss down', 'Rag down', 'Ony down' =
killed; 'down for X' = willing to do X ('down for BRD?')". examples: "ah is down",
"is the server down for everyone", "rag down gg", "anyone down for strat?". zhTW 掛了/
當掉（服務）；倒了（王）；有興趣（down for）. Add the mirror `up`: "Ony buff up in 2 min",
"server is up", "world buff up" (= available / happening).

---

## 1. Entries that are wrong or loose (term -> corrected meaning / zh)

| term | problem | correction |
|---|---|---|
| LFW | zh 找人帶或找工作 is wrong; LFW is posted by service providers | "Looking For Work": a crafter/enchanter/mage/lockpicker offering paid services. zh 接單／提供服務（附魔、傳送、開鎖） [K] |
| need (lfg) | conflicts with phrase `need` (Need roll) | one entry; ambiguity: "'need X' in LFG = group is missing X; alone in loot/roll context = I roll Need on this item" [K] |
| summon / summ | "warlock summon to instance" too narrow | Warlock Ritual of Summoning (needs 2 helpers) **or** meeting-stone summon. Whether Forever meeting stones summon: [NV] (Classic Era 1.13+ stones do; original 1.x stones only did LFG queueing) |
| meeting stone | "summoning stone" | Meeting Stone at dungeon/raid entrance; summoning ability on Forever [NV] |
| HC | means Heroic only from TBC on | In Classic-era chat **HC = Hardcore** (Hardcore realm / permadeath). Ambiguity: "Heroic only on retail-style content". Fix ai.js:59 example too [K]. Whether Forever has Hardcore realms: [NV] |
| heroic, normal (difficulty) | TBC+ concept | keep with note "dungeon difficulty modes do not exist in level-60 Classic content (TBC+)"; Forever may add them [NV] |
| DM | listed only as Dire Maul | Ambiguity: "DM = Dire Maul at 55-60 ('DM East/West/North', 'DM tribute'); Deadmines in level 15-25 context (older/US casual usage, also 'VC'); 'dm me' = direct message" [K] |
| VC | "Deadmines (VanCleef)" OK | add ambiguity: "literally Edwin VanCleef, final boss; 'LF VC run' = Deadmines" |
| ST | zh 沉默神廟 is wrong | Sunken Temple = Temple of Atal'Hakkar. zhTW 阿塔哈卡神廟, zhCN 阿塔哈卡神庙 (common zhCN nickname 沉没的神庙) [NV names]. Ambiguity with STV |
| Kara | Karazhan is a TBC raid | remove from base data or mark expansion "TBC raid (not in level-60 content)". Forever might add it [NV] |
| Misdirect | TBC hunter spell | remove (or mark TBC) [K] |
| Bloodlust / Heroism | TBC shaman spells; Classic has neither | remove, or note "TBC+; does not exist at 60" [K] |
| guild bank | added 2.3 (TBC) | note mismatch; Forever [NV] |
| vote kick | LFD vote-kick is 3.3 (Wrath) | note mismatch; on Classic-era it means the leader kicks / group asks leader to kick |
| BoP / BoP buff | `BoP buff` is not a chat term; `BoP` has two meanings | delete `BoP buff`; `BoP` ambiguity: "Bind on Pickup (loot) or Blessing of Protection (paladin, 'bop me', 'bop the mage')" [K] |
| HS / HS pot | `HS pot` is not a chat term | delete `HS pot`; `HS` ambiguity: "Hearthstone (travel: 'hs to IF') or Healthstone (warlock cookie, 'need HS', 'drop HS'); in combat/heal context Healthstone" [K]. Add `cookie(s)` = Healthstone |
| BRE | not a real abbreviation ("Black Rock Enchanting items") | delete [K] |
| Hakkar debuff | descriptive, not a term | rename to `corrupted blood` (ZG Hakkar debuff) or delete |
| DPS warr, OT chat | not real chat tokens | delete; use `dps warrior` only as alias of `warr`; delete `OT chat` |
| legit | zh 真的假的 is wrong | "genuine / legitimately, really ('legit good')". zh 真的（很）、正當的 [K] |
| rare | "blue quality item" only | ambiguity: "rare quality (blue) item, or rare spawn/rare elite mob ('rare up at X')" |
| AI | zh 奧術智慧 is zhCN wording | zhTW in-game name likely 秘法智力 (zhTW uses 秘法 for Arcane, as the `arcane` entry already does); zhCN 奥术智慧 [NV] |
| Vael | 維拉斯塔茲 | zhTW 瓦拉斯塔茲 [NV] |
| Domo | 管理者埃克索圖斯 | spelling [NV]; verify |
| hit | "hit rating" is a TBC stat | Classic: "+hit % (chance to hit)". zh 命中 OK |
| res | resurrect only | ambiguity: "resurrect ('res pls'), or resistance in gear context ('fire res', 'nature res')" |
| CC | crowd control only | ambiguity: "crowd control; 'CC rep'/'Cenarion' context (Silithus, AQ) = Cenarion Circle" |
| MC | Molten Core only; `mind control` separate | ambiguity: "Molten Core (raid), or priest Mind Control ('MC the add', 'MC'd')" |
| MT | Main Tank only | ambiguity: "Main Tank, or 'mt' = mistell (whisper sent to the wrong person)" [K] |
| PL | "party leader" is wrong for US chat | primary: **Power Leveling** ("WTS PL 1-60", "PL service"); party leader rarely abbreviated. zh 代練 [K] |
| RL | raid leader only | ambiguity: "raid leader in raid context; 'rl' = real life ('rl stuff', 'afk rl') or /reload ('rl ui')" [K] |
| GM | OK | ambiguity: "Game Master (Blizzard staff, ticket) or Guild Master; phrase 'gm' alone = good morning" |
| BB | Booty Bay only; phrase `bb` = bye bye | ambiguity: "Booty Bay in location/travel context; alone at end of chat = bye bye" |
| k | term says thousand, phrase says okay | ambiguity: "after a number = thousand ('5k gold' is a lot at 60); alone = ok" |
| g | gold only | ambiguity: "after a number = gold ('50g'); '/g' or 'in g' = guild chat" |
| ms | Main Spec only | ambiguity: "Main Spec in loot; '200ms' = latency" |
| OS | OK | ambiguity minor: "Off Spec in loot context" |
| BS | Blacksmithing only | ambiguity: "Blacksmithing in trade context; otherwise 'bs' = bullshit" |
| BM | Beast Mastery only | ambiguity: "Beast Mastery hunter; also 'BM' is not Black Morass at 60" (TBC) |
| SM | OK | ambiguity: "Scarlet Monastery; rarely Shadowmourne (Wrath)" -> keep simple |
| pm | private message | ambiguity: "time '8 pm' vs 'pm me'" |
| inc | "有怪來了" | add PvP usage: "'inc mid', '3 inc farm' = enemies coming". zh 有敵人／怪過來了 |
| boost | OK | add Classic usage: "a level-60 mage AoE-pulls a dungeon for paying lowbies ('WTS SM/ZF/Mara boost')" [K] |
| twink | OK | add "built for a BG bracket (10-19, 20-29 ...)" |
| ty for the run / thanks for the run (phrases) | zh 謝謝帶我跑副本 assumes being carried | 謝謝這趟（副本），辛苦了 |
| kek | "from Horde language" OK | add the Alliance counterpart `bur` (Orcish 'lol' seen by Horde) [K] |
| Ali | rare spelling | primary aliases `ally`, `alli`, `alliance` |
| DD | EU (German) usage | keep; note "rare on US realms; US says dps" |
| log | "log out" | ambiguity: "'log' = log off; 'logs' = Warcraft Logs parses" |
| 60 | number term | delete as a term (matches prices "60g" and levels); keep phrase `lvl 60` |
| healbot | OK | note: "also the HealBot addon name" |
| TB | OK | ambiguity: "Thunder Bluff; 'tb' rarely 'text back'" |
| SR | soft reserve OK | note: "'SR gear'/'shadow res' = shadow resistance" |
| HR | Hard Reserve OK | ambiguity: "'1 hr' = hour" |

## 2. Classic-vs-Retail summary

2.1 Retail/TBC+ items present today: HC (as Heroic), heroic, normal, Kara, Misdirect,
Bloodlust, Heroism, guild bank, vote kick, (brez is OK: druid Rebirth exists in 1.x).
2.2 bridge/ai.js few-shot example `LF1M tank HC DM` -> "英雄難度死亡礦坑" is a Cataclysm-era
reading. Replace with e.g. `LF1M tank BRD arena run pst` or `LFM UBRS need heals have key`.
2.3 Forever adds new content (zones/raids/Skyborne race) — add a note in the prompt that
unknown proper nouns may be Forever-only content and must not be force-mapped to old names.

## 3. Short tokens that collide with ordinary English (need an ambiguity note or exact-case rule)

Case-insensitive word-boundary matching (the fixed decision) will hit these in normal
sentences and flood the "Known WoW terms" block. For each, either drop it from
`terms.json` (keep it only in phrases), or give it a precise `ambiguity` note. Builders may
also consider letting the bridge include such a term only when its uppercase form appears
or when a listed context word is nearby — that is an implementation choice, not data.

- **Drop as terms (ordinary words, no WoW-specific meaning):** all, u, r, y, ok, sure, nice,
  sorry, wait, stay, stop, hold, move, run away, jump, fall, eat, food, rest, free, tip, firm,
  dead, died, quest(s), level, group, party, friend, voice, mic, guide, explain, first time,
  event, dragon, insane, sick, dope, lit, cringe, lame, sucks, hey, hi, haha, hm, nostalgia,
  set, bag(s), bar, run, full, clear, key(s), spot, gather, ready, normal, heal, heals.
  (They can stay in `phrases.json` where whole-message matching is safe.)
- **Keep with ambiguity note:** AH (ah), IF (if), UC, AB, AV, DM, ST, SM, BM, MM (mm = hmm),
  SV, OS, MS, BS, LW, PI, AI, DI, FR, NR, SR, HR, OT, MT, OP, PL, GM, RL, DE (German / disenchant),
  FC, g, k, X, F, DC, CD, CR, GY, HS, BB, TB, SW (also 'Shadow Word'), lock (lock/locked), hunt,
  cat, bear, pet, combat, shadow, holy, arcane, sub, ret, prot, resto, disc, fury, arms, ele,
  enh, feral, port, portal, pull, add(s), pat, kick, sap, trap, fear, sheep, root, snare, slow,
  stun, silence, shield, bubble, fade, shift, water, trash, boss, mob, wipe, hit, miss, block,
  dodge, parry, resist, immune, spirit, int, str, rare, epic, green, blue, purple, orange,
  token, tier, roll, pass, greed, need, drop, loot, gear, mats, ore, herb, leather, cloth,
  recipe, pattern, formula, mail, bank, vendor, trade, mount, honor, rank, flag, camp, gank,
  spawn, farm, bug, nerf, hack, bot, spam, crash, reset, saved, carry, boost, inv, invite,
  tell, whisper, pst, down, up.

## 4. Phrases-table defects

- `["ready?"]`, `["rdy?"]`: dead keys. `ns.Normalize` (addon/WoWChatHelper/Core.lua:39-46)
  strips trailing `?`, so these can never match, and they collide with `ready`/`rdy`.
  Delete them (the question-vs-statement difference is lost anyway). [C]
- Apostrophe keys: `i dont know`, `dont pull`, `its ok`, `lets go`, `lets do it` only match
  when the player omits the apostrophe. Normalize does not strip `'` [C]. Either add both
  spellings (`don't pull`, `it's ok`, `let's go`, `let's do it`, `i don't know`) or make the
  normalizer drop apostrophes (then the JSON key rule must say so, and builders must apply
  the same normalization in Lua and Node).
- `["need"]` = Need roll vs term `need` (LFG) — fine at whole-message level, but the term
  must carry the ambiguity note (section 1).
- `["sum"]` cites term `summ`; add `sum` as alias of `summ`.
- `["gm"]` = good morning is fine as a whole message; term `GM` keeps both other meanings.
- `["wipe"]` alone in raid chat is often the **raid leader calling a deliberate wipe**
  ("wipe it", "just wipe"): zh 滅團吧／放棄這次（重來）; current 滅團了 only covers the report.
- `["f"]` OK. `["k"]` OK. `["bb"]` OK (bye bye) — term BB keeps Booty Bay.
- Missing high-frequency whole messages (US realms): `ty for the group`, `ty for the
  carry`, `tyty`, `ty!`/`ty <3` (normalizes to ty / "ty <3"), `np gl`, `gl hf`, `inv`, `x`,
  `+1`/`1` (in raid: "type 1 if you have the key"), `same`, `lol rip`, `rip`, `gz`, `gratz`,
  `ding` (= I just leveled; zh 升級了！), `ding 60`, `grats on 60`, `hs`, `omw`, `coming`,
  `here`, `ready check`, `r`, `1 sec`, `afk bio` (= bathroom break), `bio` (bio break),
  `brb bio`, `bb`, `ttyl`, `gn all`, `o/` (wave), `\o`, `:)`, `lfg`, `wts`, `wtb`,
  `pst`, `w/e` (whatever), `idc`, `ez`, `gogo`, `go go`, `lets go` / `let's go`, `on it`,
  `kk`, `ofc`, `nw` (no worries), `mb`, `my b`, `sry`, `ty for summon`, `ty for port`,
  `ty for water`, `ty for buffs`, `ty for the rez`, `ty for the res`, `need water`,
  `water pls` (asking a mage for conjured water), `need heals`, `heal pls`, `oom`,
  `drinking`, `pull?`, `pulling`, `inc`, `go ahead`, `dont pull`.

## 5. Missing jargon to add (Classic-era level-60 world, US realms)

Prioritize these — they are frequent in US Classic-era Trade/LFG/raid chat and none is in
the current table. (Names [K]; zhTW/zhCN official names [NV] — the builder should produce
translations; mark AI-generated per spec.)

**Status / service words:** down, up (see section 0), live ("server live?"), lagging,
ding, bio / bio break, rl (real life / reload), mt (mistell), ttyl, w/, w/o, w/e, ffs, ftw,
nw (no worries), np, tyty, gratz, grats, gogo, ofc, ik, iirc, afaik, ty, tytyty, 1 (yes/count
me in), +1, x (in raid: "x" = here/ready), o/, \o, gl, inc, sec, rq ("real quick").

**Trade:** auc / auction (alias of AH), mats, "your mats" / "ur mats" (crafter uses
buyer's materials), tips (tips appreciated), "LF enchanter", "LF lockpick" / "LF lockbox
opener", lockbox, "box" (lockbox), "PL" (power leveling), "boost", "WTS boost", "port" (mage
portal service: "WTS ports to Org/UC/TB"), "summs" (warlock summon service), "COD",
"price check" / "PC", "undercut", "repost", "relist", "bound", "BoE epic", "lw", "mooncloth",
"felcloth", "black lotus" / "lotus", "arcanite" (bar), "devilsaur leather" / "devilsaur",
"thorium", "essence of fire/earth/water/air/undeath", "elementium", "Righteous Orb", "Dark
Iron", "dense stones", "rugged leather", "enchant crusader" / "crusader", "+heal",
"spellpower", "agi", "AP", "MP5", "fiery" (Fiery Weapon), "lifestealing", "Mongoose" (Elixir
of the Mongoose), "Giants" (Elixir of Giants), "Flask of Titans" / "titans", "Supreme Power",
"Distilled Wisdom", "FAP" (Free Action Potion), "LIP" (Limited Invulnerability Potion),
"GFPP" / "fire prot pot", "juju", "rumsey", "dirge", "nightfin", "tubers", "sapper(s)",
"dense dynamite".

**Dungeons / runs (US shorthand):** DME / DMW / DMN, "DM tribute" / "trib run" (DM North
Tribute buff run), "jump run" (DM West/North jump-skips), "lashers" (DM East farm), "BRD
arena run", "BRD emp run" (Emperor), "lava run", "jailbreak" (BRD quest), "UBRS key" / "have
key", "Rend run" (UBRS, Warchief's Blessing), "Baron run" (45-min Strat UD), "Strat UD" /
"Strat Dead", "Strat Live" / "Strat Living", "Scholo key" (Skeleton Key), "ZF graves" / "ZF
carry", "Mara princess", "SM cloth farm", "AoE farm" / "AoE pull", "UBRS / LBRS", "Ulda",
"Gnomer", "SFK", "WC" (Wailing Caverns; ambiguity: wc = water closet rarely), "BFD".
Keys/attunement: "MC attune" (Hydraxian Waterlords — "aqual quintessence", "douse"), "Ony
attune" ("Drakefire Amulet", "Onyxia key"), "BWL attune" (Blackhand's Command orb), "Seal of
Ascension" (UBRS key), "Scepter" (AQ gate), "AQ gate", "Scarab Lord".

**Raid / buffs (Classic-specific, very common):** world buffs / WBs, "Ony buff" / "Ony head"
/ "head" (Rallying Cry of the Dragonslayer: "head going up in IF in 2 min"), "Nef buff",
"Rend buff" / "WCB" (Warchief's Blessing), "ZG buff" / "heart" (Spirit of Zandalar),
"Songflower" / "SF", "DMT" (Dire Maul Tribute buffs), "DMF buff" (Sayge's Dark Fortune),
"chrono" / "chronoboon" (Classic Era only; Forever [NV]), "salv" / "BoS" (Blessing of
Salvation — tanks say "no salv"), "kings" / "might" / "wis" (Blessings), "Fort", "MotW",
"AI" (Arcane Intellect), "spirit" / "Div Spirit", "shadow prot", "WF" (Windfury Totem —
melee groups beg for it), "SoC" (Seal of Command), "SoR", "SoW" / "SoL" (judge Wisdom/Light),
"judge" / "judgement", "sunders" ("5 sunders"), "CoR" / "CoE" / "CoS", "SS" (soulstone),
"HS" (healthstone; see ambiguity), "imp buff" (Blood Pact), "trueshot", "LotP", "Innervate",
"PI", "Inner Focus", "FW" (Fear Ward, dwarf priest), "tranq" (Tranquilizing Shot — Magmadar/
Flamegor/Chromaggus), "decurse" (BWL/ Lucifron), "MCP" (Manual Crowd Pummeler), "HoJ"
(ambiguity: Hammer of Justice stun **or** Hand of Justice BRD trinket — "LF HoJ farm"),
"Ironfoe", "Lionheart", "Hand of Rag", "Ashkandi", "CTS" (Crul'shorukh), "DFT" (Drake Fang
Talisman), "Chromatic Boots", "T0" / "D1" (dungeon set), "T0.5" / "D2", "T2.5" (AQ40), "T3"
(Naxx), "pre-bis" / "pre-raid BiS", "parse(s)" / "logs" (Warcraft Logs), "dps check",
"enrage", "soft enrage", "LoS", "tank swap", "taunt", "MT/OT1/OT2", "melee/ranged group",
"healing assignments", "soak", "Vael tank rotation", "mind control" priests (Razorgore),
"suppression room" (BWL), "Garr adds", "Rag submerge", "sons" (Sons of Flame), "Ony deep
breath" / "whelps", "Geddon bomb" ("you're the bomb"), "Shazz curse".

**PvP (Classic honor system):** HK, DHK (dishonorable kill — killing civilian NPCs), R14 /
"rank 14", GM/HWL (Grand Marshal / High Warlord; ambiguity with GM), "honor farm", "AV
premade" / "premade", "pug vs premade", "Turtle" (WSG flag carrier turtling), "EFC low",
"FC", "mid", "LM"/"BS"/"ST"/"GM"/"farm" in AB (Lumber Mill, Blacksmith, Stables, Gold Mine,
Farm — another reason BS/ST/GM need ambiguity notes), "Drek" / "Vann" (AV generals), "SH"/"IBGY"
(AV towers / graveyards; [NV] exact shorthand), "TM vs SS" (Tarren Mill vs Southshore world
PvP), "Crossroads raid", "world PvP", "PvP server", "flagged".

**General MMO social slang (US):** ding, gratz/grats/gz, ty/tyty, np, gl, glhf, gg, wp, lol,
lmao, kek/bur, omg, wtf, smh, ikr, ffs, rofl, xd, ez, gg ez (taunting), noob/nub, scrub,
bad (noun: "these bads"), toxic, troll, griefing / griefer, ninja / ninja looter, "drama",
"pug life", "carry", "sweaty/tryhard", "casual", "hardcore", "f2p", "sub", "bio", "rl",
"irl", "brb", "afk", "omw", "eta", "lf" , "lfg", "lfm".

## 6. Notes for the reply-style requirement (US realm chat habits)

Observed habits to encode in the prompt (all [K]): lower case, little punctuation, short
(2-8 words); abbreviations used freely ("ty", "np", "inv pls", "omw", "gl", "lf1m dps",
"wts [item] 50g pst"); item links instead of item names; prices as "50g", "1.5k"; no
greetings in LFG ("inv" / "lvl 58 mage, inv?" not "Hello, may I join?"); class + level + role
when asking ("58 resto shammy lf strat"); polite forms are "could I get an inv?" / "ty for the
group"; "pst" = whisper me; replies to a seller go in whisper, not in Trade; avoid Briticisms
("cheers mate") and avoid formal full sentences unless the tone is "polite".
