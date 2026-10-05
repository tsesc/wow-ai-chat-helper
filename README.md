# wow-ai-chat-helper

An in-game AI chat helper for **World of Warcraft: Forever**, built for Chinese-speaking
players on US realms. It explains incoming chat in Traditional Chinese (with slang and
jargon broken down), suggests natural English replies you can drop into the chat box with
one click, translates your Chinese into English, and keeps a searchable glossary of WoW
terms, all inside the game window.

> Status: early development. See [the design spec](docs/superpowers/specs/2026-10-05-wow-ai-chat-helper-design.md).

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
