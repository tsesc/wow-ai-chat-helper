# wow-ai-chat-helper

An in-game AI chat helper for **World of Warcraft: Forever**, built for Chinese-speaking
players on US realms. It explains incoming chat in Traditional Chinese (with slang and
jargon broken down), suggests natural English replies you can drop into the chat box with
one click, translates your Chinese into English, and keeps a searchable glossary of WoW
terms, all inside the game window.

## Status

v0.1, feature-complete against [the design spec](docs/superpowers/specs/2026-10-05-wow-ai-chat-helper-design.md),
but **not yet tried on a real WoW: Forever client**. Everything is tested on Linux with
`npm test` (fengari Lua VM with a WoW API stub, a fake `claude` CLI, and an end-to-end
test that goes addon → pixel strip → bridge → slot file → addon). The Windows-only
parts (`bridge/capture.ps1` screen capture, CJK font rendering, IME, hyperlink clicks)
still need the phase-0 spike on the real client.

- Addon `WoWChatHelper`: auto-explains whisper/party/raid/guild, `[?]` for other
  channels, reply picker, `/wtr` translate, glossary panel (756 terms, 216 offline
  phrases), status frame, bundled Noto Sans TC subset font.
- Bridge (Node.js ≥ 22.2, no runtime dependencies): Claude Code CLI with Haiku
  (persistent, batched) and Sonnet for "detail"; 200 load-on-demand slots and wav
  signals, as in wow-ai.
- Do not run this bridge and the wow-ai bridge at the same time: both capture the
  same screen corner.

## Quick start

On the Windows PC that runs the game (full steps in Traditional Chinese:
[docs/INSTALL-WINDOWS.md](docs/INSTALL-WINDOWS.md)):

```
git clone https://github.com/tsesc/wow-ai-chat-helper
cd wow-ai-chat-helper
node setup.js      # installs the addon, slots and signal files; writes bridge/config.json
npm start          # runs the bridge; leave the window open while you play
```

Then restart the game client and use `/wch` in game. Before the first real use, run the
diagnostics addon and report the results:
[docs/SPIKE-CHECKLIST.md](docs/SPIKE-CHECKLIST.md). Developers: `npm ci && npm test`;
design notes in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## How it works

WoW addons cannot use the network or read files at runtime, so a small Node.js bridge
runs next to the game on the same Windows PC:

- **Out:** the addon draws chat messages as a strip of colored pixels in a screen corner;
  the bridge screen-captures and decodes it.
- **AI:** the bridge asks the local Claude Code CLI (`claude -p`, Haiku by default,
  Sonnet for "detail") to explain or translate.
- **In:** the bridge writes results into a pool of pre-made load-on-demand addon files,
  which the game loads on a timer, so no `/reload` is needed.

Nothing injects code, reads game memory, or generates input. The addon never sends chat
for you: you always press Enter yourself.

## Credits

The transport design and parts of its code come from
[**wow-ai**](https://github.com/chelinho139/wow-ai) by chelinho139 (MIT), which showed
that a sandboxed WoW: Forever addon can talk to a local program in both directions. The
first-load file behavior it relies on was measured by
[wow-forever-codex](https://github.com/0xinuarashi/wow-forever-codex). See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

MIT
