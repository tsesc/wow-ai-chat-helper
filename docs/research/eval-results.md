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
