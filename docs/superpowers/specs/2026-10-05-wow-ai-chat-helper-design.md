# wow-ai-chat-helper — design spec

Date: 2026-10-05. Status: approved direction (sections 2–4 use the defaults proposed in the
design conversation; the user may revise them). Revised 2026-10-06: glossary given to the AI,
US-realm reply style, multi-locale (section 10); result field `zh` renamed `tr` (section 3).

## 1. Purpose

A Chinese-speaking player new to US realms on **WoW: Forever** cannot follow fast English
chat full of jargon (`LF1M tank HC DM, inv`), and cannot answer the way natives do. The
addon must, inside the game window:

1. Explain incoming chat in the player's language (default Traditional Chinese; 9
   languages, section 10): a translation plus a one-line explanation of each jargon term.
2. Offer 2–3 natural English reply candidates (different tones); clicking one puts it in
   the chat box with the right target. The user presses Enter. **Never auto-send.**
3. Translate the user's Chinese into 2–3 English candidates, same pick-and-fill flow.
4. Keep a searchable glossary: built-in offline terms plus terms the AI explained.

Success = a whisper/party line is explained within a few seconds, and replies read like a
native player (`omw`, `can I get an inv?`), not textbook English.

### Decisions (from the design conversation)

| Item | Decision |
|---|---|
| Client | WoW: Forever (Retail 12.1.5 API base, TOC 16001), on a Windows PC on the LAN |
| Where results show | All inside the game |
| AI | Local Claude Code CLI (`claude -p`), default model `haiku`; "detail" uses `sonnet` |
| Trigger | Auto: whisper, party, raid, guild (incl. leaders/officer). Manual (click): trade, general, other channels, say/yell |
| Explanation | Chinese translation + per-term explanation; a "detail" link asks Sonnet for tone + situation + advice |
| Replies | AI gives 2–3 English candidates; click → fills chat box; user presses Enter. Translation uses the same candidate UI |
| Glossary | In-game, searchable; built-in offline list + AI-learned terms; the same master data is given to the AI (section 10) |
| Languages | zhTW, zhCN, koKR, deDE, frFR, esES (esMX), ptBR, ruRU, itIT; `/wch lang <code>` (section 10) |
| Bridge language | Node.js ≥ 22.2, zero runtime dependencies |
| Out of scope | Auto-sending, memory reading, input generation, voice, non-Windows capture (code may keep the X11/mac capture scripts out entirely) |

### Non-goals (YAGNI)

No coding-agent features, no map, no macros, no multi-chat sessions, no agents other than
Claude, no restore-after-wipe bundle, no reload-only transport mode.

## 2. Architecture

```
 Windows PC
 ┌──────────────────────────────┐            ┌──────────────────────────────┐
 │ WoW client                   │            │ bridge (Node.js)             │
 │ WoWChatHelper addon          │ pixel strip│ capture.ps1 (GDI, corner)    │
 │  Chat.lua: hooks chat events ├───────────▶│ protocol.js: decode records  │
 │  Transport.lua: strip/slots  │            │ bridge.js: queue + batch     │
 │  UI.lua: annotations, picker,│            │ ai.js: claude CLI runner     │
 │          glossary panel      │ slot files │  haiku (persistent) / sonnet │
 │  Locales.lua: UI strings     │◀───────────┤ publish: 200 slot Inbox.lua  │
 │  Fonts/: TC/SC/KR subsets    │ + wav sigs │  + sig/ack/presence wavs     │
 │ WoWChatHelper_Glossary_<loc> │            │ glossary.js: term matching   │
 └──────────────────────────────┘            └──────────────────────────────┘
```

Transport is derived from wow-ai (MIT, commit 3756eb5). A local clone for reference is at
`/home/jack/github/wow-ai` (read its `docs/ARCHITECTURE.md`, `addon/WoWAI/Codec.lua`,
`addon/WoWAI/WoWAI.lua`, `bridge/protocol.js`, `bridge/capture.ps1`, `bridge/install-slots.js`,
`setup.js`, `tests/wow_stub.lua`, `tests/addon_test.js`). Copied/adapted files start with
a comment: `-- Adapted from wow-ai (MIT) by chelinho139: <path>` (or `//` in JS).

Must not collide with wow-ai if both are installed: different addon names, different strip
magic, different slot/signal folders. Running both bridges at once is unsupported (both
capture the same corner), documented in README.

### Repository layout

```
addon/WoWChatHelper/          WoWChatHelper.toc, Codec.lua, Locales.lua, Transport.lua,
                              Chat.lua, UI.lua, Core.lua, Fonts/
addon/WoWChatHelper_Glossary_<loc>/  generated load-on-demand glossary addon per locale
data/glossary/                terms.json, phrases.json (glossary master data)
tools/                        build-glossary.js, build-font.py
bridge/                       bridge.js, protocol.js, ai.js, capture.ps1, install-slots.js,
                              supervisor.js, config.example.json, start.ps1, start-window.cmd
spike/WCHSpike/               throwaway diagnostics addon (section 7)
setup.js                      install addon + slot pool + signal files into the client
tests/                        node:test suites; fengari Lua VM with a WoW stub
docs/                         ARCHITECTURE.md, INSTALL-WINDOWS.md, SPIKE-CHECKLIST.md
package.json                  devDependencies only: fengari, luaparse (as wow-ai)
```

## 3. Interfaces (all tracks must agree on these exactly)

### 3.1 Pixel strip (game → bridge)

Same frame encoding as wow-ai `Codec.lua` (3-bit cells, 4×4 px, 200 cells/row, ≤48 rows,
Fletcher-16), but **magic bytes `0xC7 0x2B`** (wow-ai uses `0xC7 0x1A`). Default anchor
top-left; configurable via `WCH_DB.stripCorner` = `"TOPLEFT"|"TOPRIGHT"` and the bridge
config `capture.corner` (must match).

Payload: one or more records separated by `\x1E`, fields by `\x1F`:

```
session \x1F id \x1F kind \x1F channel \x1F sender \x1F model \x1F ctx \x1F text
```

- `session`: random token created with the saved data. Bridge dedups on `(session, id)`.
- `id`: positive integer, increasing per session.
- `kind`: `h` hello (no AI call; announces session, carries settings in `text` as
  `k=v;k=v`), `x` explain, `t` translate (player's language → English), `d` detail (Sonnet; `text` = the original
  message, `ctx` as for `x`).
- `channel`: `WHISPER|PARTY|RAID|GUILD|OFFICER|INSTANCE|SAY|YELL|CHANNEL:<name>|BN`; for `t` the
  target channel of the reply.
- `sender`: player name (with realm if cross-realm); for `t`, the whisper target or empty.
- `model`: `""` (bridge default for the kind) or `haiku|sonnet`.
- `ctx`: up to the last 4 lines of the same conversation (same channel, and same sender
  for whispers), each `sender: text`, joined by `\n`, oldest first; may be empty.
- `text`: the message (links already expanded to `[Name]`). Max record size so a frame
  never exceeds capacity; the addon batches pending records into one frame (≤3000 bytes)
  and queues the rest.

The strip stays up until `ack/NNN.wav` for the **highest id in the frame** fires or 30 s
pass; then re-shown up to 3 times; then those records are marked failed in the UI.

### 3.2 AI result JSON (bridge internal, Claude output)

The bridge asks Claude for a JSON array, one object per request id:

```json
[{"id": 12, "kind": "x",
  "tr": "徵 1 名坦克打英雄難度死亡礦坑，有意者密我邀請",
  "terms": [{"term": "LF1M", "expansion": "Looking For 1 More", "tr": "還缺一人"},
            {"term": "HC", "expansion": "Heroic", "tr": "英雄難度"}],
  "replies": [{"en": "inv pls, tank here", "tr": "請邀我，我是坦", "tone": "casual"},
              {"en": "can tank if u still need one", "tr": "如果還缺人我可以坦", "tone": "polite"}]},
 {"id": 13, "kind": "t", "replies": [{"en": "omw, 5 min", "tr": "我在路上，5 分鐘", "tone": "short"}]},
 {"id": 14, "kind": "d", "detail": "語氣：有點不耐煩…\n情境：…\n建議：…"}]
```

`tone` ∈ `casual|polite|short`. `replies` length 2–3 for `x` and `t`. `terms` may be
empty. `tr` (explanation), `terms[].tr` and `replies[].tr` (gloss of the English reply)
are in the player's language for that request (section 10; the example is zhTW, Taiwan
gamer wording); `replies[].en` is always US-realm WoW chat English. The old field name
`zh` is not accepted. The bridge validates; a reply `en` that starts with `/`, contains
`|` or a control character, or is over 200 characters is dropped (it would run as a
slash command or an escape sequence in the edit box); `terms` keeps at most 6 entries
(term ≤ 40, expansion ≤ 80, tr ≤ 40 characters);
an item missing or invalid is retried once alone, then published as `status="error"`.

### 3.3 Slot data (bridge → game)

Every publish writes the same file to all 200 slots
`Interface/AddOns/WoWChatHelper_S001..S200/Inbox.lua` (each slot addon: TOC with
`## LoadOnDemand: 1`, `## Interface: 16001`) and to `WoWChatHelper/Inbox.lua`:

```lua
WCH_SlotData = {
  v = 1, now = 1790000000, session = "<token>",
  results = {
    { id = 12, kind = "x", status = "done", lang = "zhTW", tr = "...",
      terms = { { term = "LF1M", expansion = "Looking For 1 More", tr = "還缺一人" } },
      replies = { { en = "inv pls, tank here", tr = "請邀我，我是坦", tone = "casual" } } },
    { id = 13, kind = "t", status = "working" },
    { id = 14, kind = "d", status = "error", err = "timeout" },
  },
}
```

`lang` on a result is the language the bridge asked for when it dispatched the request
(10.4); the addon files learned terms under it. Keep the most recent 100 results of the current session. Lua string escaping must be
safe for any UTF-8 and quotes/newlines (use `string.format("%q")`-equivalent escaping in
JS; unit-test it). Atomic write per file (write temp + rename).

### 3.4 Signals (empty-wav trick, as wow-ai)

Folder `Interface/AddOns/WoWChatHelper/sig/`: `ready/NNN.wav` (result for id NNN ready),
`ack/NNN.wav` (record NNN received), `presence/kkkk.wav` (bridge alive, every 30 s),
`ctl/empty.wav`, `ctl/valid.wav` (login self-test). `NNN = ((id-1) mod 200)+1`.
Behavior on self-test failure / wrap-around: fall back to scheduled slot polls, as wow-ai.

### 3.5 Slot economy

200 slots per UI session. Rules:
- Load a slot when a `ready` signal fires, but never more often than every 3 s; one load
  picks up all results available.
- Without signals: schedule 4, 8, 14, 22, 34, 50 s after the oldest pending request, then
  every 30 s while anything is pending; idle: one poll per 10 min for the status light.
- Offline short-circuit: a message whose whole normalized text matches a phrase in the
  active locale's glossary addon phrase table (`ty`, `gg`, `omw`, `inv pls`, …) is explained locally,
  no AI request.
- Warn in chat at 20 slots left; at 0, stop polling and tell the user to `/reload` when
  convenient (which resets the pool). Never auto-reload.

## 4. In-game UX

Slash: `/wch` (main command), aliases `/chathelper`. `/wtr <text>` and `/tr <text>` are
aliases of `/wch tr <text>`; `/tr` only if no other addon registered it (it is taken on the
zhTW WoW: Forever client). `/wch lang <code>` picks the language (section 10). Labels below
are the zhTW strings; other languages use `Locales.lua`.

- **Annotations.** When an explain result arrives, print into the chat frame that showed
  the original message, directly as new lines:
  - `[譯] <tr>  [回覆] [詳細]` (gray-blue prefix; `[回覆]` and `[詳細]` are hyperlinks
    `|Hwch:r:<id>|h` / `|Hwch:d:<id>|h`, handled through `hooksecurefunc("SetItemRef")`
    or the 12.x equivalent).
  - `   <term>=<tr> · <term>=<tr>` (only if terms non-empty).
  - Offline short-circuit results print the same way, tagged `[譯·離線]`.
- **Manual trigger.** For manual channels, a chat message event filter appends a small
  `[?]` hyperlink (`|Hwch:x:<lineKey>|h`) to each incoming line; clicking it sends an
  explain request for that line. Auto channels show nothing until the result arrives;
  a request that fails prints `[譯] 失敗 (<err>) [重試]`.
- **Reply picker.** `[回覆]` (or a translate result) opens a small movable frame listing
  candidates: English line large, Chinese gloss and tone small. Clicking one opens the
  chat edit box with the text inserted and the target set: whisper → `/w <sender>`, party
  /raid/guild/etc. → that chat type. Esc closes. Nothing is sent by the addon.
- **Translate.** `/tr 我五分鐘後到`: target = the last whisper partner if the last
  incoming message was a whisper within 2 minutes, else the chat type currently active in
  the edit box (default SAY → shown so the user can change it). Result opens the picker.
- **Detail.** `[詳細]` sends a `d` request (Sonnet); the result prints as `[詳細] ...`
  lines in the chat frame.
- **Glossary panel.** `/wch g [keyword]` opens a frame: search box (filters as you type,
  matching term, expansion or Chinese), scrolling list `TERM — expansion — 中文`, source
  tag `內建`/`AI`. AI terms whose `term` (case-insensitive) is not built-in are stored in
  `WCH_DB.learned` (SavedVariables) with first-seen time. Built-in list (per-locale generated addon, 10.4): ≥300 entries
  covering LFG/raid/loot/class/role/trade/social slang relevant to a level-60
  2004-era-style game (Forever), plus a phrase table for the offline short-circuit.
- **Status.** `/wch` toggles a small status frame: bridge light (green/yellow/red as
  wow-ai's presence logic), slots left, pending count, toggles for auto-explain per
  channel group and for the chat-frame CJK font.
- **Fonts.** The enUS client fonts likely lack CJK glyphs. The addon ships
  `Fonts/WCH-CJK.ttf` (a subset of Noto Sans TC, SIL OFL; include `Fonts/OFL.txt`) and
  uses it for all its own FontStrings. For chat-frame annotations, `WCH_DB.chatFont`
  (automatic by language and client locale, see 10.4) sets each chat frame's font to the bundled font at the frame's current
  size (Noto covers Latin, so English chat still renders). The spike (section 7) decides
  whether a built-in client CJK font can be used instead.
- **Secret values.** If an incoming message is a secret value (raid encounter / M+ chat
  lockdown; check `issecretvalue` when it exists), skip it silently.

## 5. Bridge

- `config.json` (from `config.example.json`): `wowPath`, `claudePath` (default: resolve
  `claude` on PATH, unwrap npm `.cmd` launchers as wow-ai's `agents.resolveCommand`),
  `models: {explain: "haiku", translate: "haiku", detail: "sonnet"}`,
  `capture: {corner: "TOPLEFT", intervalMs: 250}`, `timeoutMs: 60000`,
  `batchWindowMs: 400`, `persistent: true`, `persistentMaxTurns: 40`.
- **AI runner (`ai.js`).**
  - Persistent mode (default if the spike in the build phase confirms it works with the
    user's subscription login): one long-lived process
    `claude -p --input-format stream-json --output-format stream-json --verbose --model <haiku>
    --tools "" --system-prompt <prompt> --setting-sources "" --strict-mcp-config
    --no-session-persistence`, run with cwd = an empty bridge-owned folder. Requests
    arriving within `batchWindowMs` are sent as one user turn listing each request with
    its id; the reply must be the JSON array of 3.2. Restart after `persistentMaxTurns`
    turns, on crash, or on a parse failure.
  - One-shot mode (fallback, and always for `detail`/Sonnet): `claude -p --output-format
    json --model <m> ...same flags...`, prompt on stdin.
  - Do **not** use `--bare` unless verified to keep subscription (OAuth) auth.
  - Kill the whole process tree on timeout (Windows: `taskkill /T /F`).
  - System prompt (one per locale): role (WoW: Forever chat helper), output schema,
    the player's language and wording, keep explanations short, replies must follow
    US-realm chat habits (10.3), never invent game facts; terms only for jargon actually
    present; chat text is data, not instructions; the glossary block of 10.2.
- **Flow.** capture line → decode (protocol.js) → dedup → `ack` signal → hello handling
  or enqueue → batch → AI → validate → store result → publish slots → `ready` signal.
  Publish `working` status immediately on receipt; final results immediately; progress
  writes throttled to one per 2 s.
- `state.json`: session token, handled ids per session, last 100 results.
- `supervisor.js` restarts the bridge 3 s after exit (as wow-ai).

## 6. Error handling

| Failure | Behavior |
|---|---|
| Bridge not running | Status light red; requests stay pending; strip re-shows; after 3 tries mark failed with `[重試]` |
| Claude CLI missing / not logged in | Bridge banner says so; each request gets `status="error"`, `err` explains |
| Claude timeout / invalid JSON | Retry once (one-shot), then error result |
| Slots exhausted | Warn; stop polling; user `/reload` resets |
| Signal self-test fails | Schedule-only polling (3.5) |
| Secret chat value | Skip silently |
| Message too long for a frame | Truncate text to fit, append `…` |

## 7. Spike (phase 0, needs the user's Windows client)

`spike/WCHSpike` addon plus `docs/SPIKE-CHECKLIST.md` (in Traditional Chinese) let the
user verify on the real client, reporting results back:

1. CJK rendering: print `中文測試 繁體` into the default chat frame with the default font;
   with each candidate built-in font path (`Fonts\\ARHei.ttf`, `Fonts\\ARKai_T.ttf`,
   `Fonts\\bHEI00M.ttf`, `Fonts\\bLEI00D.ttf`, `Fonts\\blei00d.TTF`); and with the bundled
   subset font. Show which render.
2. IME: an EditBox using the bundled font; can the user type Chinese with Windows IME?
   Also in the normal chat edit box.
3. API presence: print whether `ChatFrame_AddMessageEventFilter` /
   `ChatFrameUtil.AddMessageEventFilter`, `ChatFrame_OpenChat` / `ChatFrameUtil.OpenChat`,
   `SetItemRef` hook point, `issecretvalue`, `C_AddOns.LoadAddOn`, `PlaySoundFile` exist.
4. Hyperlink click: a custom `|Hwchspike:test|h[click]|h` link prints a message when clicked.

## 8. Testing

- `node --test` suites, no network:
  - `protocol`: strip record encode/decode round trip incl. UTF-8 Chinese, separators,
    batching; Lua serialization escaping; slot-number math.
  - `ai`: against a **fake claude** executable (a Node script emitting recorded
    stream-json/json); batching, id matching, validation, retry, timeout kill.
  - `bridge`: inject records (`--inject` file or API) → slot files contain expected
    results; signals raised; dedup.
  - `addon`: fengari Lua VM with a WoW stub (adapt wow-ai `tests/wow_stub.lua`): chat
    event → strip record bytes; offline short-circuit; slot load → annotation lines in the
    stub chat frame; `[回覆]` click → picker; candidate click → stub edit box text + chat
    type; glossary search; learned terms saved.
  - `codec`: Lua encoder output decodes in JS (cross-language test).
  - `e2e`: Lua addon in VM → strip bytes → JS decoder → bridge with fake claude → slot
    file → addon VM loads it → annotation printed.
- `npm run test:live` (optional, not in CI): real `claude` with haiku on a few sample
  messages; prints latency per call for persistent vs one-shot.
- Windows-only pieces (`capture.ps1`, GDI) cannot run on the Linux dev box: keep them
  close to wow-ai's tested version and cover them in the spike/manual checklist.
- GitHub Actions: `npm ci && npm test` on ubuntu-latest.

## 9. Delivery

Developed on a Linux box (`/home/jack/github/ai-in-wow`), pushed to the private GitHub
repo `tsesc/wow-ai-chat-helper`; the user clones it on the Windows PC and runs
`node setup.js` then `npm start`. `docs/INSTALL-WINDOWS.md` in Traditional Chinese.

## 10. Glossary, style and locales (revision 2026-10-06)

Trigger: `ah isn't down for everyone` was explained as an interjection ("啊…") with no terms
and replies `lol wipe`, because the glossary (which has AH = Auction House) lived only in
the addon and was never given to the AI.

### 10.1 Glossary master data

Single source of truth in `data/glossary/` (research and audit in `docs/research/`
`jargon-sources.md`, `glossary-audit.md`; `raw-terms.json` is the unaudited collection):

- `terms.json`: array of `{ term, aliases[], expansion, cat, ambiguity, examples[], tr }`,
  `tr` = `{ zhTW, zhCN, koKR, deDE, frFR, esES, ptBR, ruRU, itIT }`. `ambiguity` is a note
  for the model (e.g. lowercase `ah` may be the interjection; in trade/price/"down"
  context it is the Auction House), or `""`. Covers US-realm, Classic-era / Forever
  level-60 world and general MMO slang (about 1,800 entries).
- `phrases.json`: array of `{ key, terms[], tr }` for the offline short-circuit. `key`
  is normalized: lowercase, trimmed, single spaces, no trailing sentence punctuation
  (including `?`).
- Matching (bridge `glossary.js`): case-insensitive on word boundaries, multiword terms and
  aliases, symbol terms (`<3`, `/w`), longest match wins, no overlaps. Apostrophes count
  as part of a word (`don't` has no `DoN`, `we've` no `VE`), and a letter-initial term
  may follow a digit only when it is a unit (`80g`, `5k`; `1st` has no `ST`). A form
  that is also an everyday English word (list `ENGLISH_WORDS`: `was`, `how`, `if`,
  `at`, `go`, ...) matches only in its own spelling when written with capitals (`HoW`,
  `WAs`, `IF`; not `how`, `If`), and never as a lowercase alias (`at` is not `@`); an
  entry's own lowercase term (`need`, `down`) still matches and carries an ambiguity note.
  For `t` requests only `ctx` is scanned (the text is the player's own language).

### 10.2 Glossary in the AI request

The bridge loads `terms.json` at start. For each request it finds the terms in the message
and `ctx`, and adds a "Known WoW terms in this message" block (term, expansion, translation
in the active locale, ambiguity note; ctx-only terms marked `(ctx)`). The model decides
from the whole line whether a candidate applies, drops wrong hits, and may add terms it
knows.

### 10.3 Reply style

`replies[].en` always follows US-realm WoW chat habits (`docs/research/us-chat-style.md`):
lowercase by default, no final period, short, common abbreviations (`ty`, `omw`, `inv`,
`np`), no small talk, no excuses when declining, Classic-era vocabulary only, at least one
calm answer to an insult, first person for `t` (the player's own words). Item, NPC and
zone names stay in English. Only `tr` fields are in the player's language.

### 10.4 Locales

- Supported: zhTW, zhCN, koKR, deDE, frFR, esES (also used for esMX), ptBR, ruRU, itIT.
- Default: the client's `GetLocale()` if supported (esMX → esES). Otherwise zhTW is used
  and a one-time English prompt says to pick a language with `/wch lang`.
- `/wch lang <code>` sets `WCH_DB.lang` (persisted); `/wch lang auto` follows the client
  again; `/wch lang` alone lists the languages. Each change sends a new hello with
  `lang=<code>` in its settings; the bridge answers every request in that language
  (fallback: hello `locale=` if supported, else zhTW). A hello that expired unacked
  (bridge not running) is sent again as soon as the bridge shows up (presence/ack) and,
  in any case, right before the next request (lower id, so the bridge reads it first).
  Without signals, a slot result for a later record acks the hellos shown before it.
- UI strings: `addon/WoWChatHelper/Locales.lua`, one table per locale (zhTW = the original
  strings); a missing key falls back to zhTW.
- Generated glossary addons: `node tools/build-glossary.js` writes
  `addon/WoWChatHelper_Glossary_<loc>/` (TOC: Interface 16001, LoadOnDemand 1,
  Dependencies WoWChatHelper; `Glossary.lua` defines
  `WCH_Glossary = { locale, terms = { {term, expansion, tr, cat, ambiguity} },
  phrases = { [key] = { tr, terms = { {term, expansion, tr} } } } }`). The main addon loads
  the active locale's addon at login and on `/wch lang` (cached per locale). Generated files
  are committed; `tests/glossary_test.js` fails when they are stale (`--check`).
  `setup.js` installs all of them.
- Learned (AI) glossary entries store `{ term, expansion, tr, locale, t }`, one per term
  and language (key: the lowercase term for zhTW, `<term>\31<lang>` otherwise); search
  shows the active locale's entries. The language is the result's `lang` (else the
  request's), not the setting when the result arrives. Old `zh` entries migrate to `tr`
  with `locale = "zhTW"`; plain-keyed entries of another language move to their key.
- Fonts: `Fonts/WCH-CJK.ttf` (Noto Sans TC), `WCH-SC.ttf` (Noto Sans SC, GB2312),
  `WCH-KR.ttf` (Noto Sans KR, KS X 1001), each under 3 MB, SIL OFL, built by
  `tools/build-font.py`. Each subset holds one CJK script plus Latin/Cyrillic, and WoW's
  `SetFont` has no glyph fallback, so on a CJK client a subset of another script would
  turn the client's own text in chat into boxes (`WCH-KR` has no Han, `WCH-SC` lacks
  traditional forms). `WCH_DB.chatFont = nil` means automatic: on only when the language
  is zhTW/zhCN/koKR, differs from the client locale, and the client is not a CJK locale
  (a Latin/Cyrillic client loses nothing). A CJK client with another CJK language keeps
  its chat font and gets a one-time notice (`FONT_CROSS`) that `/wch font on` uses the
  bundled font at that cost. The addon's own windows always use the language's font.
  Latin and Cyrillic languages use the client fonts. `/wch font on|off|auto`. Open:
  merged subsets (client script + chosen script) would remove the trade-off.
- Non-zhTW translations (glossary, UI strings, prompt wording) are AI-generated and not
  reviewed by native speakers.

### 10.5 Evaluation

`tests/live/eval_glossary_style.js` (real `claude`, not in `npm test`) scores meaning,
terms, naturalness and language on `data/eval/messages.json`; results and known gaps in
`docs/research/eval-results.md`.
