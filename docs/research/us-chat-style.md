# US-realm WoW chat style guide (for reply generation)

Researched 2026-10-06 for the reply-candidate prompt. Scope: how players on US realms
actually type in WoW chat (Classic-era / WoW: Forever level-60 world plus general MMO
habits), so the bridge can generate English replies that read like a native US player
and not like a textbook. Companion data: `data/eval/messages.json` (50 incoming lines
with the facts an explanation must get right).

## Sources and how much to trust them

What the sources below directly support:

| Claim | Source |
|---|---|
| Trade shorthand: WTS / WTB / WTT, PST = "please send tell", OBO, BoE/BoP, LF / LFM / LFG, PUG; ads like `WTS <item> 200g pst` | [Little Big Land: The Language of Trade Chat](https://littlebigland.com/the-language-of-trade-chat-a-field-guide-for-the-brave/), [ZAM wiki: trade channel](https://wow.allakhazam.com/wiki/trade_channel_(WoW)), [WoWWiki archive: TradeChat/WoW Tips](https://wowwiki-archive.fandom.com/wiki/TradeChat/WoW_Tips) |
| Trade norms: link items with shift-click, don't repeat an ad every few seconds, an occasional "please"/"thanks" is enough | [WoWWiki archive: TradeChat/WoW Tips](https://wowwiki-archive.fandom.com/wiki/TradeChat/WoW_Tips), [Vanilla WoW archive: Etiquette](https://vanilla-wow-archive.fandom.com/wiki/Etiquette) (fetch returned HTTP 402; content known from the search summary only) |
| Chat acronyms: AFK, BRB, BTW, IDK, LFG, OMW, WTS, GG, GJ, L2P, OP, LF1M | [Wowpedia: Abbreviation guide](https://wowpedia.fandom.com/wiki/Abbreviation_guide), [WoWWiki archive: Acronym guide](https://wowwiki-archive.fandom.com/wiki/Acronym_guide) |
| Loot rules in pugs: need before greed, "MS > OS", reserves (often called HR / SR), plate-can't-roll-cloth style restrictions | [Suit Up guild: Loot rules for pug groups](https://suitup-guild.com/post/loot-rules-for-pug-groups), [Warmane forum: loot rules](https://forum.warmane.com/showthread.php?t=444730) |
| Summon requests by typing `123`, `summ`, `sum`, `port` in raid chat (RaidSummon addon keys on them) | [CurseForge: RaidSummon](https://www.curseforge.com/wow/addons/raidsummon), [Wowpedia: Meeting Stone](https://wowpedia.fandom.com/wiki/Meeting_Stone) |
| Barrens chat culture: Chuck Norris jokes, "where is Mankrik's wife" | [WoWWiki archive: Barrens chat](https://wowwiki-archive.fandom.com/wiki/Barrens_chat), [Wowpedia: Mankrik's Wife](https://wowpedia.fandom.com/wiki/Mankrik's_Wife) |
| "AH down" is a real, current WoW: Forever topic (players ask whether the Auction House outage is only them) | [US forums: Auction house is broken (WoW: Forever Beta)](https://us.forums.blizzard.com/en/wow/t/auction-house-is-broken/2372072), [EU forums: Auction House down for 10+ hours (WoW: Forever)](https://eu.forums.blizzard.com/en/wow/t/auction-house-down-for-10-hours/633633) |
| A final period on a short, positive message reads as cold or passive-aggressive in informal text; the message boundary already ends the sentence | [NPR 2020, quoting linguist Gretchen McCulloch](https://www.npr.org/2020/09/05/909969004/before-texting-your-kid-make-sure-to-double-check-your-punctuation), [CBC on the Binghamton University study](https://www.cbc.ca/lite/story/1.3359526) |

**Unverified (practitioner knowledge):** Reddit (r/classicwow, r/wow) could not be read
from this box, and Wowpedia returned HTTP 402 to the fetcher. The frequency claims below
(for example "lowercase is the default", "`ty` is far more common than `thank you`"),
the casual/polite/short tone split, and every example pair come from general knowledge
of US realm chat. They were **not** checked against a chat-log corpus. Treat them as a
style target to test with `data/eval/messages.json`, not as measured facts.

## 1. Core habits (put these in the reply prompt)

1. **Lowercase by default.** Capital letters are optional. People capitalize acronyms
   inconsistently (`ah`, `AH`, `lfm`, `LFM`). ALL CAPS means shouting, raid-leader
   urgency, or a joke.
2. **Short.** Most lines in party, raid, or whisper chat are 1-6 words. The player is
   typing between pulls, so a reply over ~12 words looks like a bot or a forum post.
3. **No final period.** Leave sentence-ending punctuation off. A period on `ok.` or
   `sure.` reads as annoyed (see the NPR/Binghamton source). Question marks are optional
   (`u selling?`). `!` is friendly in small doses (`ty!`); `!!!` or `?!?` reads as worked up.
4. **Abbreviations and shortened words:** u, ur, r, ty, thx, np, yw, pls/plz, ppl, rn,
   tho, idk, imo, nvm, w/e, gz/grats, gg, wp, gl, hf, brb, afk, omw, inc, lf, lfm, wts, wtb,
   pst, inv, summ, rez, oom, cd, ilvl. Also run-together forms: `kk`, `ok ty`, `np gl`.
5. **Little greeting ritual.** People rarely open with "Hello, how are you?". In a
   whisper, the first line is the actual request: `hey u still selling [Arcanite Bar]?`.
6. **Thanks and apologies are short:** `ty`, `thx`, `tyty`, `ty for group`, `my bad`,
   `mb`, `sry`, `oops`. One is enough. Native speakers don't stack them.
7. **Laughter and softeners:** `lol`, `lmao`, `haha`, `xD`; `:)` and `:D` are fine.
   `lol` often only softens a line ("my bad lol") and doesn't mean anything is funny.
8. **Declining is low-drama:** `nah im good`, `no ty`, `pass`, `maybe later`, `im full
   sry`. No reason needed.
9. **Item links carry the meaning.** Trade lines are `WTS [item] <price>` or
   `WTB [item] pst`. A reply can just name a price or `how much?`.
10. **Prices:** `g` (gold), `s` (silver), `5g ea` (each), `per stack`/`/stack`, `cod`
    (cash on delivery mail), `tips`/`tip` for crafting, `ur mats` / `my mats`, `obo`.
11. **Calm beats clever with rude people.** Locals ignore, `/ignore`, or answer flat
    once: `ok`, `cool story`, `np, gl`. Insults back escalate and can get the player
    reported. Even when the player asks for "casual", a reply candidate is never
    rude or insulting.

## 2. Anti-patterns non-native speakers produce (the model must avoid)

| Anti-pattern | Why it reads wrong | Native-like |
|---|---|---|
| `Hello! Could you please invite me to your team? Thank you very much!` | Over-polite and long; "team" is not WoW English (it's *group*/*party*) | `inv pls` / `can i get an inv?` |
| `I am sorry, it is my fault.` | Textbook and heavy | `my bad` / `mb sry` |
| `Thank you for your help, have a nice day.` | Sounds like customer service | `ty!` / `thx for the help` |
| `OK.` / `Sure.` | Final period reads cold | `ok` / `sure` / `kk` |
| `I want to buy your thing, how much money?` | Calque and awkward | `how much for the [item]?` / `price?` |
| `Please wait a moment.` | Stiff | `sec` / `1 sec` / `brb 2 min` |
| `Congratulations on your level up!` | Nobody types this | `gz` / `grats!` / `ding gz` |
| `I am coming.` | Literal | `omw` / `coming` |
| `Excuse me, where is the bank?` | "Excuse me" is unnecessary | `where's the bank?` / `anyone know where the bank is?` |
| Using retail-only slang on a Classic-era realm: `m+`, `io`, `key`, `lust` (as "Bloodlust" in a 60 world with no Heroism/BL) | Wrong era | era terms: `brd`, `strat`, `ubrs`, `mc`, `ony`, `wb` (world buff) |
| Wrong slang: `noob` thrown at strangers, `bro` everywhere, `gg` after a wipe meaning "nice work" | Sounds hostile or off | `gg` after a wipe is sarcastic or "we're done"; use `rip` / `np we got this` |
| Interpreting `lol` / `lmao` literally as "very funny" | Usually just a softener | treat as tone, not content |
| Long full-sentence LFG posts | Get skimmed | `LF2M strat live need heals` |
| Guessing slang meaning from sound (the trigger bug: `ah` read as the interjection "ah") | Breaks meaning | resolve jargon from context first: `ah` + down/price/check = Auction House |

## 3. Reply tones (used for the reply candidates)

- **casual**: lowercase, slang, may include `lol`, `:)`. Default for party, guild, whisper.
- **polite**: still short and lowercase, adds `pls`/`ty`/`np`/`sry`. Use with strangers,
  in trade, or when the player wants something from someone.
- **short**: 1-3 words. Combat, raid, ready check, summons.

None of the three has a final period, and none is longer than ~12 words.

## 4. Pairs by situation (incoming -> 2-3 natural replies)

The format is `incoming` -> reply (tone). Item names in `[...]` are item links.

### Invite requests and group forming
1. `inv pls` -> `sure sec` (casual) · `inv sent` (short) · `sry group's full` (polite)
2. `can i get an inv to the group?` -> `yep` (short) · `sure, what class?` (casual) · `sry we're full rn` (polite)
3. `need 1 more for deadmines?` -> `ya still need a heals` (casual) · `yes, inv?` (short) · `nah full now sry` (polite)
4. `want to group for this quest?` -> `sure inv me` (casual) · `ya sure` (short) · `im good ty` (polite)
5. `u lfg?` -> `ya what for?` (casual) · `yes` (short) · `not rn ty` (polite)
6. `whats ur class/spec` -> `resto druid` (short) · `holy priest, can heal` (casual)
7. `add me to the list for strat` -> `added` (short) · `got u, ill whisper when we start` (casual)

### LFG posts
8. `LF2M BRD need tank and heals` -> `warrior tank here, inv?` (casual) · `can heal, inv pls` (polite) · `heals lf inv` (short)
9. `LFM UBRS need 1 dps, have key` -> `mage lf inv` (short) · `rogue 60 can come, inv pls` (polite)
10. `LF1M strat live last spot` -> `me pls` (short) · `hunter here, inv?` (casual)
11. `lfg scholo any role` -> `need a dps, want in?` (casual) · `inv u` (short)
12. `LFM MC pug SR 1 item` -> `x` (short) · `rogue lf spot, sr [item]?` (casual)
13. `who wants to run sm cath?` -> `me!` (casual) · `ya im down` (casual) · `cant rn sry` (polite)

### Trade, prices, haggling
14. `WTS [Arcanite Bar] 25g` -> `how much for 5?` (casual) · `would u do 22?` (polite) · `ill take one` (short)
15. `WTB [Black Lotus] pst` -> `have 1, 80g?` (short) · `got one, what u paying?` (casual)
16. `20g for the [item]?` -> `deal` (short) · `can u do 18?` (polite) · `25 is lowest sry` (polite)
17. `would u take 15g` -> `meet at 17?` (casual) · `sure` (short) · `nah sry, 20 firm` (polite)
18. `LF enchanter crusader, my mats` -> `i can do it, tips?` (casual) · `omw where u at` (short)
19. `can u cod it?` -> `sure, name?` (short) · `ya sending now` (casual)
20. `still selling?` -> `yep` (short) · `ya still have 3` (casual) · `sry sold already` (polite)
21. `price?` -> `30g` (short) · `30g obo` (casual)
22. `meet me at ah` -> `omw` (short) · `ok be there in 2` (casual)
23. `too much lol` -> `np, offer?` (casual) · `ok gl` (short)
24. `ah isn't down for everyone` -> `oh weird, mine's still broken` (casual) · `ah ok ty, ill relog` (polite) · `rip just me then` (short)
25. `is the ah down?` -> `ya mine too` (casual) · `works for me` (short) · `try relogging` (polite)

### Thanks
26. `ty for the help` -> `np!` (casual) · `yw :)` (casual) · `np` (short)
27. `thanks for the run` -> `ty for group` (polite) · `gg ty` (short) · `anytime` (casual)
28. `tyvm for the buff` -> `np gl` (short) · `yw!` (casual)
29. `ty for group` -> `ty all` (short) · `gg ty` (casual)
30. `thanks for the summon` -> `np` (short) · `np ty for clicking` (casual)

### Apologies and mistakes
31. `sry pulled extra` -> `np we got it` (casual) · `np` (short)
32. `my bad was afk` -> `np` (short) · `all good` (casual)
33. `oops wrong target` -> `lol np` (casual) · `np` (short)
34. `dude u pulled aggro` -> `my bad` (short) · `mb, ill wait for sunders` (polite)
35. `u ninja'd that` -> `sry misclick, ill trade it` (polite) · `oh mb, want it?` (casual)

### Declining
36. `want to join our guild?` -> `no ty im good` (polite) · `already in one sry` (polite) · `nah ty` (short)
37. `can u carry me through sm?` -> `cant rn sry` (polite) · `maybe later` (short)
38. `can u lend me 10g` -> `sry cant` (polite) · `nah sry` (short)
39. `duel?` -> `sure` (short) · `nah im good` (casual) · `not rn sry` (polite)
40. `wanna buy [item]?` -> `no ty` (short) · `im good ty` (polite)

### Ready checks and pulls
41. `rdy?` -> `r` (short) · `ready` (short) · `1 sec drinking` (casual)
42. `everyone ready?` -> `yes` (short) · `need 30 sec` (casual)
43. `pulling in 5` -> `k` (short) · `wait oom` (short) · `go` (short)
44. `wait for mana pls` -> `k` (short) · `np take ur time` (casual)
45. `buffs pls` -> `sec` (short) · `fort coming` (casual)
46. `who is tanking?` -> `me` (short) · `i got it` (casual)

### Loot rolls
47. `need on this?` -> `ya its an upgrade` (casual) · `greed` (short) · `go ahead` (polite)
48. `can i roll need, its bis for me` -> `go for it` (casual) · `sure` (short)
49. `MS > OS ok?` -> `ok` (short) · `sounds good` (casual)
50. `gz on the drop` -> `ty!` (casual) · `thx` (short)
51. `can anyone use [item]?` -> `me, warrior` (short) · `need for my alt?` (polite) · `nope` (short)
52. `hr on [Lionheart Helm]` -> `ok` (short) · `fine by me` (casual)
53. `pass pls, misclicked need` -> `np` (short) · `lol np` (casual)

### Wipes and deaths
54. `wipe it` -> `rip` (short) · `ok run back` (casual)
55. `that was rough lol` -> `lol ya, again?` (casual) · `we got this` (casual)
56. `rez pls` -> `omw` (short) · `sec, oom` (short) · `rezzing` (short)
57. `res?` -> `ya one sec` (casual) · `no rez, sry` (polite)
58. `who pulled that` -> `my bad` (short) · `idk lol` (casual)
59. `healer didnt heal me` -> `oom sry` (short) · `sry got stunned` (polite)

### Summons and meeting stones
60. `need summ` -> `omw to stone` (casual) · `ill click` (short)
61. `123` (in raid) -> `summoning u next` (casual) · `k` (short)
62. `need 2 to click for summon` -> `clicking` (short) · `omw` (short)
63. `can a lock summon me?` -> `sure 1 sec` (casual) · `need 2 clickers` (short)
64. `where's the stone` -> `outside the instance portal` (casual) · `by the entrance` (short)

### Directions and help
65. `where is the flight master?` -> `top of the hill` (short) · `just east of the bank` (casual)
66. `how do i get to brd?` -> `blackrock mountain, through searing gorge` (casual) · `burning steppes north side` (short)
67. `where is mankrik's wife` -> `lol south of the crossroads, look for the beaten corpse` (casual) · `south of crossroads` (short)
68. `any1 know where the weapon trainer is?` -> `near the bank` (short) · `in the valley of honor` (casual)
69. `how do i get the bags from this quest` -> `turn it in to the guy in town` (casual) · `idk sry` (polite)
70. `help pls stuck in wall` -> `try /stuck` (short) · `hearth out` (short)

### Guild recruitment
71. `<Raid Night> recruiting all classes, mc/bwl tues thurs 8pm est, /w for info` -> `whats ur loot system?` (casual) · `ill pst` (short)
72. `u want a guild invite?` -> `sure ty` (polite) · `whats the guild about?` (casual)
73. `/w me for guild invite` -> `inv pls` (short) · `can i get an inv?` (polite)
74. `welcome to the guild!` -> `ty!` (casual) · `thx glad to be here` (polite)
75. `gratz on 60` (guild) -> `ty!!` (casual) · `thx finally` (casual)

### Banter, jokes, and trolling
76. `chuck norris doesnt need to roll, loot rolls to him` -> `lol` (short) · `classic barrens chat` (casual)
77. `is this barrens chat or trade lol` -> `both` (short) · `always has been` (casual)
78. `did someone say [Thunderfury]?` -> `lol` (short) · `every time` (casual)
79. `alliance smells` -> `lol` (short) · `for the horde` (casual)
80. `lol gnome mage` -> `:D` (short) · `tiny but deadly` (casual)
81. `ding!` -> `gz` (short) · `grats!` (casual)

### Rude messages (respond calmly or not at all)
82. `learn to play noob` -> `ok` (short) · `np, any tips?` (polite) · (ignore)
83. `ur dps is trash` -> `ill work on it` (polite) · `ok` (short)
84. `stfu` -> (ignore) · `k` (short)
85. `kick the hunter` -> `whats up?` (casual) · `sry, what did i do?` (polite)
86. `gtfo my spot` -> `np, ill go` (polite) · `can share tags?` (casual)
87. `ninja` -> `misclick sry, ill trade it` (polite) · `i rolled need for ms` (short)

### Misc everyday
88. `brb` -> `k` (short) · `np` (short)
89. `afk 5` -> `k` (short) · `np` (casual)
90. `whats ur ilvl / gear like?` -> `mostly blues` (short) · `pre-bis mostly, 2 epics` (casual)
91. `wb drop in 5 min at org` -> `omw` (short) · `ty for heads up` (polite)

## 5. Notes for prompt authors

- Guard against reading jargon literally: always check the known-terms block first
  (`ah`, `inv`, `hr`, `sr`, `wb`, `cd`, `pst`, `ty`, `gz`, `brd`, `ubrs`, `mc`). Lowercase
  jargon is the normal case and doesn't mean the word is something else.
- A reply should fit the incoming channel: trade and whisper replies can be one price
  or one word. Party and raid replies in combat should be `short`.
- When the incoming line is rude, at least one candidate must be calm and neutral.
  Never offer an insult.
- When the meaning isn't clear, pick a reply that asks: `wdym?`, `what for?`, `which one?`.
- `gg` mid-dungeon after a wipe may be sarcastic, or may mean "let's quit". Explain it.
  Don't suggest `gg` back unless the run really ended.
