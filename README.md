# wow-ai-chat-helper

An in-game AI chat helper for **World of Warcraft: Forever**, built for non-native
players on US realms. It explains incoming chat in your language (with slang and jargon
broken down), suggests English replies in US-realm chat style that you can drop into the
chat box with one click, translates your language into English, and keeps a searchable
glossary of WoW terms, all inside the game window.

## Languages

Traditional Chinese (zhTW, the default for this project), Simplified Chinese (zhCN),
Korean (koKR), German (deDE), French (frFR), Spanish (esES, also used for esMX),
Brazilian Portuguese (ptBR), Russian (ruRU) and Italian (itIT). The addon follows your
client's language when it is one of these; pick another in game with `/wch lang <code>`
(e.g. `/wch lang koKR`, `/wch lang auto` to follow the client again, `/wch lang` for the
list). Explanations, term glosses and the UI use that language; the English reply
candidates are always written like US-realm players write.

> **Note:** only the zhTW texts were written for a known reader. The glossary
> translations, UI strings and prompt wording for the other eight languages are
> AI-generated and have **not** been reviewed by native speakers. Corrections welcome
> (edit `data/glossary/terms.json` / `phrases.json`, then `node tools/build-glossary.js`;
> UI strings are in `addon/WoWChatHelper/Locales.lua`).

## Status

v0.1, feature-complete against [the design spec](docs/superpowers/specs/2026-10-05-wow-ai-chat-helper-design.md),
but **not yet tried on a real WoW: Forever client**. Everything is tested on Linux with
`npm test` (fengari Lua VM with a WoW API stub, a fake `claude` CLI, and an end-to-end
test that goes addon → pixel strip → bridge → slot file → addon). The Windows-only
parts (`bridge/capture.ps1` screen capture, CJK font rendering, IME, hyperlink clicks)
still need the phase-0 spike on the real client.

- Addon `WoWChatHelper`: auto-explains whisper/party/raid/guild, `[?]` for other
  channels, reply picker, `/wtr` translate, glossary panel, status frame, `/wch lang`,
  bundled Noto Sans TC / SC / KR subset fonts.
- Glossary: about 1,800 WoW terms (US realms, Classic-era / Forever level-60 world,
  general MMO slang) and 274 offline phrases in `data/glossary/`, with ambiguity notes
  (e.g. `ah` the interjection vs `AH` the Auction House). The bridge gives the matching
  terms to the AI with every request; the addon gets one generated load-on-demand
  `WoWChatHelper_Glossary_<locale>` addon per language.
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
