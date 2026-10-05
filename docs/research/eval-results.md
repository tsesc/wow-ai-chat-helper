# Live eval: glossary + reply style (haiku, real Claude Code CLI)

Date: 2026-10-06. Script: `tests/live/eval_glossary_style.js` (not part of `npm test`).
Eval set: `data/eval/messages.json` (50 lines, each with `mustMention`), plus 8 held-out
lines written into the script after the first run (`--holdout`).

## Setup

- Runner: the real `bridge/ai.js` `AiRunner`, persistent haiku, `MAX_THINKING_TOKENS=0`,
  the real glossary `data/glossary/terms.json` (1786 terms), bridge batching
  (`batchWindowMs` 400, `maxBatch` 8). All requests are kind `x` (explain), empty `ctx`.
- Locales: zhTW all 50 lines; zhCN and deDE a fixed 15 (lines 1, 2, 4, 7, 9, 11, 13, 19, 20,
  24, 36, 37, 38, 42, 46: the four AH lines, trade, LFG, loot, summon, world buff, insults,
  a meme, a wipe, a battleground).
- Judge: one Sonnet one-shot per 8 items. Per item it scores `meaning` 0/1 against
  `mustMention`, `terms` 0/1, `natural` 1-5 (US-realm WoW chat), `language` 0/1
  (right language and script, gamer wording).
- Raw outputs and grades: `$TMPDIR/wch-eval/{before,after,holdout-before,holdout-after}-{outputs,grades}.json`.
  Not committed.
- Rerun: `node tests/live/eval_glossary_style.js --tag after`. Add `--holdout` for the
  8 held-out lines. Add `--ai <copy of ai.js>` to evaluate another prompt.

Live calls used: run 1 was 11 persistent turns, 7 one-shot retries and 11 judge calls.
Run 2 was 11 turns, an uncounted number of retries (the stats line was not captured) and
11 judge calls. The holdout runs were 2 turns and 2 judge calls. That is about 55-60
calls in total. All 80 + 80 + 16 items ended with a valid result (0 errors after retries).

## Results

| run | locale | n | meaning | terms | natural (1-5) | language |
|---|---|---|---|---|---|---|
| before (original prompt) | zhTW | 50 | 78% | 74% | 3.68 | 98% |
| | zhCN | 15 | 67% | 60% | 3.20 | 93% |
| | deDE | 15 | 67% | 87% | 3.60 | 87% |
| | **all** | 80 | **74%** | 74% | **3.58** | 95% |
| after (tuned prompt) | zhTW | 50 | 74% | 80% | 3.60 | 100% |
| | zhCN | 15 | 80% | 80% | 3.40 | 100% |
| | deDE | 15 | 53% | 73% | 3.47 | 100% |
| | **all** | 80 | **71%** | 79% | **3.54** | 100% |
| holdout, original prompt | zhTW | 8 | 100% | 100% | 3.38 | 100% |
| holdout, tuned prompt | zhTW | 8 | 75% | 88% | 3.38 | 100% |

Both runs miss the targets: meaning is under 90% and naturalness is under 4. **The prompt
tuning did not measurably improve the score.** Eight items flipped to correct meaning
(zhTW 15, 21, 31, 43, 45; zhCN 9, 13; deDE 38). Ten flipped to wrong (zhTW 5, 6, 20,
23, 38, 46, 48; deDE 2, 7, 13). The holdout lost 2 of 8. Most of these flips are run-to-run
and judge noise; see "Judge reliability" below. The items the new rules targeted did get
fixed: "trash" as an insult (#21), "rez inc" (#43), "brez up" (#31), "lol" as a softener
(#15), and zone names kept in English in deDE (#24 now says "Barrens", not "Sumpfland").
Rules that contradict the glossary had no effect; see the next section.

## The triggering bug: `ah isn't down for everyone`

**Fixed in all three locales, in both runs.** Every result says the Auction House is not
down for everyone, with terms `AH = 拍賣場 / 拍卖行 / Auktionshaus`. Before the fix the
output was "啊怪沒有倒地給所有人".

There is a caveat: this exact line is the system prompt's worked example, and
`tests/ai_test.js` pins it, so line #1 does not show that the fix generalizes. The
evidence that it does comes from lines the prompt does not contain:

| line | zhTW (tuned run) | correct? |
|---|---|---|
| `is the ah down for u too?` | 對方問拍賣場是否也對他掛掉了 | yes (all 3 locales, both runs) |
| `ah prices on [Elixir of the Mongoose] are crazy rn` | 拍賣場上貓鼬藥劑的價格現在很貴 | yes (all 3, both runs) |
| `ah ok makes sense` | 對方表示理解或同意了什麼（「啊好的，有道理」）, terms [] | yes: interjection, no AH term (all 3, both runs) |
| holdout `ah is lagging so bad rn` | 拍賣場現在延遲很嚴重 | yes |
| holdout `ah lol my bad` | 哈，沒事，我搞砸了, no AH term | interjection read right (the judge failed it on wording) |

The glossary block (term, expansion, translation, ambiguity note) is what makes this work.
Haiku follows the block closely in both directions: right entries fix lines, wrong
entries break them.

## Remaining failures: mostly glossary data, not the prompt

These failed in both runs. The fixes belong in `data/glossary/terms.json`, which this
track does not own:

| line | what the model said | cause in terms.json |
|---|---|---|
| `123` (zhTW/zhCN/deDE) | "help click the summoning portal" | `123 = click the summoning portal`. The eval set says `123` = asking for a summon. The two sources disagree, and the glossary entry wins even over an explicit rule in the prompt. **A human should decide which reading is right.** |
| `can we share tags on these?` | 分享任務 (share the quest) | `share = share the quest` matches; there is no `share tags` entry (`tag` exists separately). Needs a multiword `share tags` entry. |
| `gg wipe, run back` | gg = 打得好 (praise) | `gg` has no ambiguity note; it needs "after a wipe = resigned/sarcastic". |
| `LF1M strat live ...` | 斯坦索姆血色區 | `Strat Live = Stratholme Scarlet/Living side`. "Scarlet" is wrong and misleads the zhTW translation (should be 活人區). |
| `flag carrier is at mid, def our fc` (deDE) | "definitiv" | `def = definitely`. Battleground "defend" is only in the note. |
| `ss on priest` | right (Soulstone), but by luck | `SS` matches Sinister Strike, Sweeping Strikes and Southshore. Soulstone exists only as `soulstone`, not as an `SS` alias. |
| `free gold visit wowgold dot com` | right, but the block lists `dot = DoT`, `com = commission` | False hits on ordinary English. |
| `anyone want to run dm east for jumpruns?` | "jumping practice" | Only `DME jumps` exists; there is no `jumprun(s)` / `jump runs` alias. |
| `rez inc` (before tuning) | inc = enemies coming | The `inc` note doesn't cover "rez inc / heals inc". The tuned prompt now handles it. |
| `wb dropping in org` | generic "world buff" | The judge wants the dragon-head buff named. This is minor and comes from a strict `mustMention`. |

Model-side failures that remain:
- **Replies that don't fit the situation.** For an LFG post needing heals + dps it offered
  "warrior tank here". To "ur dps is trash" it replied "ill pull more threat". To a
  gold-seller whisper it gave the action words "spam report" / "ignore".
- **Replies that are too meek** to insults ("sry ill get better").
- **Item names translated** despite the rule: 貓鼬藥劑, 獅心頭盔. Once it hallucinated
  "法杖" for "2h". The glossary has no item names, so haiku translates them itself.
- **deDE** sometimes adds facts that aren't in the line ("the raid leader says…") or
  repeats the sender's name.

## Naturalness of the English replies (avg 3.5-3.7 / 5)

Most replies are short, lowercase and use the right shorthand: "np we got it", "inv
sent", "ya mine too", "gz", "omw", "kk". Points are lost when:
- a reply doesn't answer the line: "noted", "understood", "appreciated", "ty for the
  feedback", "sounds cool" to a guild ad;
- a reply sounds stiff: "ill consider it ty", "glad that makes sense";
- a "short" reply is garbled: "heals lf inv", "dps lf inv";
- a reply misuses shorthand: "psting" / "pst u in sec", "fr" in a Classic context.

The judge is strict here. A 3 often means "fine but generic". No reply was rude, used
retail-only slang, or broke the lowercase/no-period style.

## Explanation language

Language and script were 95% correct before tuning and 100% after, over 80 items.
zhTW stays Traditional with Taiwanese gamer words (坦, 補, 拍賣場, 滅團). zhCN uses
mainland words (拍卖行, 团灭, 世界BUFF). deDE uses du-form gamer German (Auktionshaus,
Heiler, Wipe). The before-tuning misses were: a wrong term gloss (`gg` as 团灭), the
translated zone name "Sumpfland" for the Barrens, and "Schadensausteiler" (stiff).

## Prompt changes made (bridge/ai.js, text only)

The changes are additions to the system prompt. Nothing structural changed, and the
worked example and style examples are unchanged because `tests/ai_test.js` pins them.

1. **KNOWN TERMS:** the block is matched by spelling, so it can contain wrong senses or
   false hits. The model must pick the sense that fits the whole line and must not put a
   dropped hit into `terms`.
2. **New READING CHAT section:**
   - "lol" as a softener; sarcastic "gg";
   - "trash" as an insult; l2p;
   - "<x> inc", "<spell> up", "cd on";
   - "ss on <name>", "123", "need N to click";
   - share tags, ninja, wb / hr / sr;
   - gold-spam handling;
   - "don't invent who the speaker is".
3. Zone and place names (the Barrens, Crossroads, Orgrimmar) keep their English names.
   `tr` stays short (about 60 CJK characters or 30 words) and mentions rude or angry tone.
4. **Replies** must answer *this* line ("need heals + dps → offer heals or dps, not
   tank"). Generic filler is banned ("noted", "understood", "appreciated", "ty for the
   feedback"). Answers to insults are calm without grovelling.

I kept the changes because the targeted failure classes did get fixed and the aggregate
change is within noise. They are not a measured improvement. To revert, the
pre-tuning `bridge/ai.js` is in `/tmp/wch-eval-ai.js.before` (temporary; not in git,
since bridge/ai.js has uncommitted changes from this round).

Part of rule 2 (`123` as asking for a summon, `share tags`) was written from the eval
failures, so the "after" numbers on those exact lines are optimistic. The 8-line holdout
did not improve (100% → 75%, a 2-item difference that is within judge noise).

## Judge reliability (read before trusting the percentages)

Sonnet as judge is noisy at this sample size:
- **Strict `mustMention` details.** It fails a line for not naming the Seal of Ascension
  or the Rallying Cry of the Dragonslayer even when the core meaning is right.
- **Self-contradiction.** On #46 its note says "leaning pass on core meaning" and the
  score is still 0.
- **Inconsistency.** It flags the same issue (IF not in terms) as fail in one run and pass
  in the other.
- **The 8-items-per-call batch** probably makes it harsher on later items.

A ±5-point swing between runs is noise. For a real decision, grade with 2-3 samples per
item or have a human review the ~25 contested items above.

## Next steps (for owners of other files)

1. Glossary data (highest value):
   - fix or decide `123`;
   - add `share tags`, `SS` → Soulstone, `jump runs` / `jumprun`;
   - add an ambiguity note to `gg` (after a wipe);
   - fix `Strat Live` (remove "Scarlet");
   - give `def` the defend sense in BG context;
   - add a stoplist for `dot` and `com` as ordinary words;
   - extend the `inc` note.
2. Add common item names (consumables, BiS items) with locale names, or tell the user
   that item names stay in English.
3. Re-run this eval after the data fix; it should move meaning more than prompt edits did.
4. Non-zhTW explanations are AI-generated, and German wording was judged by Sonnet only:
   none of it has been reviewed by a native speaker.

## Round 2 (2026-10-06): link tokens for game names

### What changed since round 1

- **Link tokens (`bridge/ai.js`, `linkTokens` / `restoreLinks`).** Each distinct `[Name]` in
  `text` and `ctx` is sent as `[I1]`, `[I2]`, and so on. A "Linked game names" block
  (`#<id> I1 = Elixir of the Mongoose`) tells the model what each token is and to write
  the token itself. After parsing, tokens (bracketed or bare `I1`) are restored to
  `[Name]` in `tr`, `terms`, `detail` and the replies (`en` and `tr`). The verbatim
  check plus one retry (`stats.nameRetries`) stays as a safety net. Names containing `|`
  are not tokenized, and neither are names written in plain words.
- **Not only the tokens changed (the comparison is confounded).** Between round 1 and
  this run the tree also got:
  - glossary data fixes from another track (`data/glossary/terms.json`, `phrases.json`,
    `bridge/glossary.js`);
  - reply rules (fit the specifics, no grovelling to insults, scam handling);
  - the GAME NAMES rule.

  Read the deltas below as "the current tree vs round 1", not as "tokens alone".
- **Harness.** It now also records ms per persistent batch turn, runner stats and a
  `[Name]` verbatim count (`<tag>-meta.json`).

### Method

The method is the same as round 1: the 50 zhTW lines, plus the same 15 lines for zhCN
and deDE. The runner is persistent haiku with `MAX_THINKING_TOKENS=0`, `maxBatch` 8 and
no ctx. The judge is one Sonnet call per 8 items, with the same prompt.
Command: `node tests/live/eval_glossary_style.js --tag round2`.

Live calls: 11 persistent turns, 7 one-shot retries and 11 judge calls, so **29 in
total**. The holdout was not re-run.

### Results

| run | locale | n | meaning | terms | natural (1-5) | language |
|---|---|---|---|---|---|---|
| round 1 "after" (baseline) | zhTW | 50 | 74% | 80% | 3.60 | 100% |
| | zhCN | 15 | 80% | 80% | 3.40 | 100% |
| | deDE | 15 | 53% | 73% | 3.47 | 100% |
| | **all** | 80 | **71%** | 79% | **3.54** | 100% |
| round 2 (tokens + current tree) | zhTW | 50 | 90% | 88% | 3.44 | 98% |
| | zhCN | 15 | 80% | 87% | 3.00 | 100% |
| | deDE | 15 | 87% | 80% | 3.53 | 73% |
| | **all** | 80 | **88%** | 86% | **3.38** | 94% |

| game link names | round 1 "after" | round 2 |
|---|---|---|
| items with a `[Name]` (zhTW 7, zhCN 3, deDE 3) | 13 | 13 |
| `[Name]` verbatim in final `tr` | **0/13** (奧金錠, 貓鼬藥劑, Löwenherzhelm, ...) | **13/13** |
| first-pass name misses (`nameRetries`) | n/a (no check yet) | **0** |
| names appended as last resort | n/a | 0 |
| 13 bracket items: meaning / terms / natural / language | 11 / 13 / 3.46 / 13 | 12 / 12 / 3.23 / 12 |

Latency: there were 11 persistent batch turns, averaging **12.8 s per turn** (8 items:
12.8-17.0 s; 7 items: 10.4-12.6 s; 2 items: 3.4 s). Round 1 did not record per-batch
latency. The smoke run before tokens needed one extra one-shot call per bracket line;
this run needed none.

Other retries: 7 one-shot retries were for items that were missing or invalid in a
batch reply, not for names. Round 1 run 1 also had 7. The harness does not log which
items they were.

### Reading the numbers

- **The goal is met.** Names survive on the first pass: 13/13 items, with 0 name
  retries. Restoring tokens in replies works too: "how much for 5 [Arcanite Bar]?"
  (deDE #2), and the Thunderfury meme echo (zhTW #26).
- **Meaning rose from 71% to 88%.** This is mostly not the tokens. The 13 bracket items
  went from 11 to 12. The rest comes from glossary data and prompt changes in the tree,
  plus judge noise (±5 points; see "Judge reliability").
- **Naturalness fell from 3.54 to 3.38.** The new insult rule's "cool story bro" is graded
  as escalating (zhTW #20, #21). "pst" is used in the wrong direction ("pst for price"
  replying to a WTB/WTS; zhTW #3, #10, #44). zhCN dropped 3.40 → 3.00.
- **deDE language fell from 100% to 73%** (4 items). The causes are garbled or stiff
  German ("getarnt", "Zweitrüstung", wrong gender) and invented names ("Angrydps",
  "Moonlock", "Ahmad meint ..."). This is not related to the tokens.
- **The tokens hide the glossary's item translations.** The glossary now has entries like
  `Arcanite Bar = 奧金錠` and `Lionheart Helm = 獅心頭盔`. They no longer match, because
  the glossary sees `[I1]`. `tr` therefore shows only the English name. This matches the
  "names verbatim" requirement but drops the local name. Option: put the local name in
  the links block as a hint (`I1 = Arcanite Bar (奧金錠)`) and allow "token + local name".

Raw files: `$TMPDIR/wch-eval/round2-{outputs,grades,meta}.json` (not committed).
