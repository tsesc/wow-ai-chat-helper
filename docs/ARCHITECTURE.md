# Architecture

Maintainer notes for the transport and data flow. The authoritative design is
[the spec](superpowers/specs/2026-10-05-wow-ai-chat-helper-design.md); section numbers below refer to it.

The transport is derived from [wow-ai](https://github.com/chelinho139/wow-ai) by chelinho139
(MIT, commit 3756eb5): its `docs/ARCHITECTURE.md` is the longer treatment of the sandbox
constraints. Files copied or adapted from it carry an "Adapted from wow-ai (MIT)" header;
see `THIRD_PARTY_NOTICES.md`.

## Why a bridge at all

A WoW addon cannot open sockets, run programs or receive input from other processes.
What it can do that reaches the outside world:

1. Draw pixels, which another process can screen-capture.
2. Load files that existed when the client started, on demand (`C_AddOns.LoadAddOn` of a
   `LoadOnDemand` addon; each can be loaded once per UI session). Files created after launch
   are not discovered, so everything the bridge writes must target pre-installed paths.
3. Play sound files (`PlaySoundFile` reports whether the file is playable), usable as a
   one-bit signal.

## Data flow

```
 incoming chat ─▶ Chat.lua (event / filter, secret values skipped)
                    │ offline phrase match? ─▶ annotate locally (no AI)
                    ▼
                 Transport.lua ─▶ pixel strip (Codec.lua, magic C7 2B, top-left)
                                      │  screen
                                      ▼
                 capture.ps1 (GDI) ─▶ protocol.js decodeFrame/parseRecords
                                      ▼
                 bridge.js: dedup (session,id) ─▶ ack signal ─▶ queue + batch (400 ms)
                                      ▼
                 glossary.js: terms in text+ctx ─▶ "Known WoW terms" block
                                      ▼
                 ai.js: claude -p (haiku persistent; sonnet one-shot for detail)
                                      ▼ JSON array (spec 3.2), validated, retried once
                 bridge.js: store state.json ─▶ publish: same Inbox.lua to 200 slots
                                      ▼                  + sig/ready/NNN.wav
                 Transport.lua: ready signal or poll schedule ─▶ LoadAddOn(slot)
                                      ▼
                 UI.lua: annotation, [回覆] picker, detail, glossary
                 user clicks a candidate ─▶ chat box filled; the user presses Enter
```

## Outbound: pixel strip (spec 3.1)

`Codec.lua` packs `magic(2) id(2) len(2) payload fletcher16(2)` into 3-bit cells (each
colour channel fully on or off), 4x4 px per cell, 200 cells per row, up to 48 rows,
about 3 KB per frame. The payload is records separated by `\x1E`, fields by `\x1F`:

```
session id kind channel sender model ctx text
```

`kind` is `h` hello, `x` explain, `t` translate, `d` detail. The bridge dedups on
`(session, id)`. The addon starts a new `session` token on every load (login or
`/reload`): SavedVariables are only written on a clean logout, so after a crash `lastId`
comes back older than ids the bridge already handled, and a long-lived token would make
new messages look like handled ones. The strip is parented to `WorldFrame` so hiding the
UI (Alt+Z) does not hide it. The strip stays up until the `ack` signal for the highest id in the frame
fires or 30 s pass; it is re-shown up to 3 times, then the records are marked failed.
The magic bytes differ from wow-ai's (`C7 1A`), so the two never decode each other's frames.

## Inbound: slots and signals (spec 3.3 - 3.5)

- The bridge cannot know which slot the game will load next, so every publish writes
  identical `Inbox.lua` content (`WCH_SlotData`, last 100 results) to all 200
  `WoWChatHelper_S001..S200` addons, atomically (temp file + rename), plus
  `WoWChatHelper/Inbox.lua`. A rename that fails because another process holds the
  file (Windows `EPERM`/`EBUSY`, e.g. an AV scan) is retried with a short backoff; files
  still failing are retried every second, and the `ready` signal of a result waits until
  a publish has reached every slot.
- Signals are empty or valid `.wav` files under `WoWChatHelper/sig/` (`ready`, `ack`,
  `presence`, `ctl`); `NNN = ((id-1) mod 200) + 1`. The addon self-tests at login and falls
  back to scheduled polling (4, 8, 14, 22, 34, 50 s after the oldest pending request, then
  every 30 s) when signals do not work. There is one schedule for everything pending.
- Presence: the bridge keeps the 50 files after its beat counter empty. The addon finds the
  head by probing every 50th file (one always lands in that gap, also after the counter
  wrapped at 2000) and binary-searching the 50 before it.
- Slot budget: one load per `ready`, at most every 3 s (8 s while other requests the bridge
  has are still without a result, so they ride along), warn at 20 left, stop at 0 and ask
  the user to `/reload`. Never auto-reload.

## Layout

| Path | Role |
|---|---|
| `addon/WoWChatHelper/` | in-game addon (Codec, Locales, Transport, Chat, UI, Core, Fonts) |
| `addon/WoWChatHelper_Glossary_<loc>/` | generated load-on-demand glossary per locale (do not edit) |
| `data/glossary/` | glossary master data: `terms.json`, `phrases.json` (`raw-terms.json` = unaudited source) |
| `tools/` | `build-glossary.js` (JSON → glossary addons, `--check`), `build-font.py` (TC/SC/KR subsets) |
| `bridge/` | Node.js bridge: `protocol.js`, `bridge.js`, `ai.js`, `glossary.js`, capture, slot installer, supervisor |
| `spike/WCHSpike/` | throwaway diagnostics addon for the Windows spike (spec section 7) |
| `setup.js` | installs addon, slot pool and signal files into the client |
| `tests/` | `node:test` suites; fengari Lua VM with a WoW stub (`tests/helpers/lua.js`) |

## Testing notes

`npm test` runs everything on Linux with no network. The addon Lua executes in fengari on a
WoW API stub with the sandbox enforced (no `io`/`os`/`require`) and every file syntax-checked
as Lua 5.1 by luaparse. `codec_test.js` proves the Lua encoder's output decodes in JS.
Windows-only pieces (`capture.ps1`) and real client behavior (fonts, IME, hyperlinks, API
presence) are covered by the spike and manual checklist, see
[SPIKE-CHECKLIST.md](SPIKE-CHECKLIST.md) and [INSTALL-WINDOWS.md](INSTALL-WINDOWS.md).

## Unsupported

Running this bridge and wow-ai's bridge simultaneously: both capture the same screen corner.

## Glossary and locales (spec section 10)

- **One source, two consumers.** `data/glossary/terms.json` / `phrases.json` feed both the
  bridge (loaded at start; `glossary.js` finds the terms in each message and `ctx` and puts
  them, with expansion, ambiguity note and the active locale's translation, in the request)
  and the addon (via `tools/build-glossary.js`, which writes one load-on-demand
  `WoWChatHelper_Glossary_<loc>` addon per locale). Edit the JSON, run
  `node tools/build-glossary.js`, commit the generated addons; `tests/glossary_test.js`
  fails if they are stale. The bug that motivated this: the AI never saw the glossary and
  read `ah isn't down for everyone` as an interjection.
- **Language selection.** The addon picks `WCH_DB.lang` (`/wch lang`), else the client's
  `GetLocale()` if supported, else zhTW with a one-time prompt. It sends `lang=<code>` in
  the hello settings; the bridge keeps one system prompt and one persistent Claude process
  per `model|locale`, and stamps each queued request with the language in force.
- **Wire fields.** Explanations and glosses are `tr` (was `zh`) in the AI JSON and the
  slot data; English replies stay in `en`.
- **Fonts.** TC/SC/KR subsets ship in `Fonts/`; the chat-frame font is switched only when
  the chosen CJK/Hangul language differs from the client locale.
- **Quality.** Non-zhTW texts are AI-generated, not native-reviewed. A live eval
  (`tests/live/eval_glossary_style.js`, results in `docs/research/eval-results.md`) is the
  regression check for prompt or glossary changes.
