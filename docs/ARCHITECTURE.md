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
`(session, id)`. The strip stays up until the `ack` signal for the highest id in the frame
fires or 30 s pass; it is re-shown up to 3 times, then the records are marked failed.
The magic bytes differ from wow-ai's (`C7 1A`), so the two never decode each other's frames.

## Inbound: slots and signals (spec 3.3 - 3.5)

- The bridge cannot know which slot the game will load next, so every publish writes
  identical `Inbox.lua` content (`WCH_SlotData`, last 100 results) to all 200
  `WoWChatHelper_S001..S200` addons, atomically (temp file + rename), plus
  `WoWChatHelper/Inbox.lua`.
- Signals are empty or valid `.wav` files under `WoWChatHelper/sig/` (`ready`, `ack`,
  `presence`, `ctl`); `NNN = ((id-1) mod 200) + 1`. The addon self-tests at login and falls
  back to scheduled polling (4, 8, 14, 22, 34, 50 s, then every 30 s) when signals do not work.
- Slot budget: one load per `ready`, at most every 3 s, warn at 20 left, stop at 0 and ask the
  user to `/reload`. Never auto-reload.

## Layout

| Path | Role |
|---|---|
| `addon/WoWChatHelper/` | in-game addon (Codec, Transport, Chat, UI, Glossary, Core, Fonts) |
| `bridge/` | Node.js bridge: `protocol.js`, `bridge.js`, `ai.js`, capture, slot installer, supervisor |
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
