# wow-ai-chat-helper

**English** · [繁體中文](README.zh-TW.md)

An in-game AI chat helper for **World of Warcraft: Forever**, built for players whose
first language isn't English and who play on US realms. Inside the game window it:

- **explains incoming chat in your language**: a translation plus a short note for each
  piece of jargon (`LF1M tank HC DM, inv`, `ah isn't down for everyone`, `ss me pls`);
- **suggests 2–3 English replies** written the way US-realm players write (`omw`,
  `heals here, inv?`, `how much for 5?`). Click one and it is put in the chat box with
  the right channel; **you** press Enter. The addon never sends chat for you;
- **translates what you type in your language into English** (`/wtr 我五分鐘後到` →
  `omw, 5 min`), with the same pick-and-fill flow;
- keeps a **searchable glossary** of about 1,800 WoW terms, with notes on ambiguous ones
  (`ah` the interjection vs `AH` the Auction House), plus the terms the AI explained to
  you.

Item, spell, quest and place names stay in English (`[Elixir of the Mongoose]`), so you
can search for them on the Auction House or on Wowhead.

> **Status (v0.1, October 2026):** working end to end on a real WoW: Forever beta client
> (zhTW, build 1.60.1.70205) on Windows. It is still young: the AI is right about 88% of
> the time in our last test (80 sample lines), and the non-Chinese translations have not
> been reviewed by native speakers. See [Known limitations](#known-limitations).

---

## Contents

1. [How it works](#how-it-works)
2. [Requirements](#requirements)
3. [Install](#install)
4. [Using it in game](#using-it-in-game)
5. [Commands](#commands)
6. [Languages](#languages)
7. [Configuration](#configuration)
8. [Troubleshooting](#troubleshooting)
9. [Privacy, cost and game rules](#privacy-cost-and-game-rules)
10. [Publishing to CurseForge / Wago](#publishing-to-curseforge--wago)
11. [Development](#development)
12. [Known limitations](#known-limitations)
13. [Credits and license](#credits-and-license)

---

## How it works

WoW addons run in a sandbox: they cannot use the network or read files while the game is
running. So the project has **two parts that must both be installed**:

| Part | Where it runs | What it does |
|---|---|---|
| **Addon** (`WoWChatHelper` + glossary + slot addons) | inside WoW | watches chat, shows explanations and reply buttons, glossary window |
| **Bridge** (Node.js program in this repo) | on the same Windows PC, next to the game | reads the addon's messages off the screen, asks Claude, hands the answers back |

```
 WoW (addon)                                  Bridge (Node.js, same PC)
 ┌────────────────────────────┐ pixel strip   ┌───────────────────────────────┐
 │ chat line ─▶ coloured cells├──────────────▶│ screen capture ─▶ decode      │
 │ in the top-left corner     │               │ glossary lookup ─▶ Claude CLI │
 │                            │ slot files    │ (Haiku; Sonnet for "detail")  │
 │ explanation + reply buttons│◀──────────────┤ answer ─▶ load-on-demand files│
 └────────────────────────────┘               └───────────────────────────────┘
```

- **Out:** the addon draws the message as a short strip of coloured 4-pixel squares in
  the top-left corner of the screen for a moment; the bridge screen-captures and decodes
  it.
- **AI:** the bridge looks up known WoW terms in the message, then asks the local
  [Claude Code](https://claude.com/claude-code) CLI (`claude -p`) for an explanation and
  reply ideas.
- **In:** the bridge writes the answer into a pool of 200 pre-made load-on-demand addon
  files; the game loads one a few seconds later. No `/reload` needed.

Nothing injects code, reads game memory or presses keys. Technical details:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requirements

- **Windows 10/11** PC that runs the game. (The bridge's screen capture is Windows-only.)
- **World of Warcraft: Forever** (tested on 1.60.1.69977–70205), in **windowed** or
  **windowed fullscreen / borderless** mode. Exclusive fullscreen blocks screen capture.
- **[Node.js](https://nodejs.org) 22.2 or newer** (24 LTS works).
- **[Claude Code](https://claude.com/claude-code)**, installed and **logged in** with a
  Claude account (`claude auth status` shows `loggedIn: true`). Its usage counts against
  your Claude plan.
- Git is **not** required: the installer downloads a zip. (Developers can clone instead.)

## Install

**One line, on the Windows PC that runs WoW.** Open PowerShell and paste:

```powershell
irm https://raw.githubusercontent.com/tsesc/wow-ai-chat-helper/main/install.ps1 | iex
```

It installs Node.js and Claude Code if they are missing, opens the Claude login in your
browser the first time (that is how your Claude subscription gets connected; there is no API
key), downloads this project to `%LOCALAPPDATA%\WoWChatHelper`, installs the addon into WoW,
and puts a **WoW Chat Helper** shortcut on the desktop that starts the bridge. Run the same
line again to update. Full guide (Traditional Chinese): [docs/INSTALL-WINDOWS.md](docs/INSTALL-WINDOWS.md).

**Using a coding agent instead?** Paste this into Claude Code (or Codex, Gemini CLI, Copilot)
on the PC that runs WoW:

```text
Install WoW Chat Helper from https://github.com/tsesc/wow-ai-chat-helper on this Windows PC, following the repo's AGENTS.md.
```

[AGENTS.md](AGENTS.md) tells the agent how to install, verify, update and uninstall without
asking you for anything except the Claude login.

<details>
<summary>Manual install (Git users, developers)</summary>

```powershell
# 1. Tools (skip what you already have)
winget install OpenJS.NodeJS.LTS
irm https://claude.ai/install.ps1 | iex      # Claude Code
claude auth login                            # log in once, in a browser

# 2. This project
git clone https://github.com/tsesc/wow-ai-chat-helper
cd wow-ai-chat-helper
node setup.js                                # or: node setup.js --wow "G:\...\World of Warcraft\_classic_beta_"
```

`setup.js` finds the Forever client (`_forever_` or `_classic_beta_` under your Battle.net
folder; pass `--wow` if it can't), then:

- copies the addon to `Interface\AddOns\WoWChatHelper`, plus the 9 glossary addons;
- creates 200 slot addons (`WoWChatHelper_S001`…`S200`) and about 2,800 tiny signal
  `.wav` files. That many files is normal: the game only notices addon files that
  already exist when it starts;
- writes `bridge\config.json` and checks that `claude` is installed.

Then:

3. **Fully quit and restart WoW** (not just `/reload`).
4. On the character screen, open **AddOns** and make sure **WoW Chat Helper** is ticked.
   Leave the "slot ###" and "Glossary" entries as they are; they load on demand.
5. **Start the bridge** and leave its window open while you play:
   ```powershell
   npm start                      # in the project folder
   # or double-click bridge\start-window.cmd
   ```
   The banner shows the WoW folder, the glossary size, the language and
   `claude : login ok`. The bridge restarts itself if it crashes.
6. In game, type `/wch`. The light turns **green** once the addon and the bridge see each
   other.

**Updating:** `git pull`, then `node setup.js` again, restart the bridge, and fully
restart WoW when the update adds new addon files (the release notes say so; otherwise
`/reload` is enough).

</details>

## Using it in game

**Explanations arrive by themselves** for whispers, party, raid and guild chat. A few
seconds after a message, a line like this appears under it:

```
[Bob] whispers: LF1M tank HC DM, inv
[譯] 徵 1 名坦克打 Hardcore 厄運之槌，有意者密他邀請  [回覆] [詳細]
     LF1M=還缺一人 · HC=Hardcore · DM=厄運之槌
```

- **`[回覆]` (Reply)** opens a small window with 2–3 English replies (casual, polite,
  short), each with a translation underneath. Click one: it goes into the chat box,
  already addressed to that person or channel. Edit it if you like, then press Enter.
- **`[詳細]` (Detail)** asks the bigger model (Sonnet) for the tone of the message, what
  is going on and how you might answer. Takes a little longer.
- **`[重試]` (Retry)** appears if a request failed.

**Trade, General, Looking For Group and other public channels** are busy, so they are
not explained automatically. Each line gets a small **`[?]`**; click it to have that line
explained.

**Translate your own sentence:** type `/wtr` followed by what you want to say in your
language, in the channel you want to answer in. For example, with the chat box on Party:

```
/wtr 我去拿一下藥水，馬上回來
```

A window offers `brb grabbing pots` / `one sec, getting pots` / … Click one; it goes into
the box on the same channel (or to the person who whispered you in the last two
minutes). Press Enter to send.

**Glossary:** `/wch g` opens it; `/wch g ah` searches. Built-in terms are tagged
"built-in", terms the AI explained to you are tagged "AI" and are remembered.

Short, very common messages (`ty`, `gg`, `omw`, `inv pls`, …) are explained offline
from the built-in phrase list, without asking the AI (tagged `[譯·離線]`).

## Commands

| Command | What it does |
|---|---|
| `/wch` | Open/close the status window: bridge light, slots left, pending requests, per-channel switches |
| `/wch status` | Print the same in chat |
| `/wtr <text>` | Translate your text into English reply candidates. Same as `/wch tr <text>`. `/tr` also works when no other addon or the game uses it (on the zhTW client it is taken) |
| `/wch g [word]` | Glossary window, optionally searching for `word` |
| `/wch lang <code>` | Language for explanations and the UI: `zhTW zhCN koKR deDE frFR esES ptBR ruRU itIT`; `auto` follows the client; no code lists them |
| `/wch auto <whisper\|party\|raid\|guild> on\|off` | Turn automatic explanations on or off per channel group |
| `/wch font on\|off\|auto` | Use the bundled font in chat frames (needed when your client's fonts lack your language's characters) |
| `/wch corner TOPLEFT\|TOPRIGHT` | Where the pixel strip is drawn; must match `capture.corner` in `bridge/config.json` |
| `/wch hello` | Reconnect to the bridge (re-sends the handshake) |
| `/wch help` | List the commands |
| `/chathelper` | Same as `/wch` |

## Languages

Explanations, reply translations, the glossary and the addon's own text are available in
**Traditional Chinese (zhTW)**, **Simplified Chinese (zhCN)**, **Korean (koKR)**,
**German (deDE)**, **French (frFR)**, **Spanish (esES, also for esMX)**, **Brazilian
Portuguese (ptBR)**, **Russian (ruRU)** and **Italian (itIT)**. The addon starts in your
client's language when it is one of these; change it with `/wch lang <code>`. The English
replies are always US-realm style, whatever language you pick.

> Only the zhTW texts have been checked by a native speaker so far. Everything else was
> translated by AI. Corrections are very welcome: glossary in
> `data/glossary/terms.json` / `phrases.json` (then `node tools/build-glossary.js`), UI
> text in `addon/WoWChatHelper/Locales.lua`.

Fonts: the addon ships small Noto Sans subsets for Traditional Chinese, Simplified
Chinese and Korean (SIL Open Font License). They are only used in chat when your client's
own fonts can't show your chosen language (`/wch font` to override).

## Configuration

`bridge/config.json` is written by `setup.js` (template: `bridge/config.example.json`).
The keys you are most likely to change:

| Key | Default | Meaning |
|---|---|---|
| `wowPath` | found by setup | The Forever client folder (`...\_classic_beta_` during the beta) |
| `claudePath` | `""` | Full path to `claude.exe` if it isn't found automatically |
| `models.explain` / `translate` / `detail` | `haiku` / `haiku` / `sonnet` | Claude model for each kind of request |
| `capture.corner` | `TOPLEFT` | Must match `/wch corner` in game |
| `capture.processName` | `WowB` | The game's process name |
| `batchWindowMs` | `400` | Messages arriving this close together are sent to Claude in one go |
| `persistent` | `true` | Keep one Claude process running (faster) instead of starting one per request |
| `maxThinkingTokens` | `0` | Turns off extended thinking for Haiku; without it, answers took 24–80 s instead of 2–4 s |
| `timeoutMs` | `60000` | Give up on a request after this long |

Restart the bridge after editing it.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Light stays red/yellow; bridge window says nothing | Is **WoW Chat Helper** ticked in AddOns? Is the bridge running? Type `/wch hello`. |
| No coloured squares ever appear top-left | The addon isn't loaded (check AddOns, then `/reload`). `/dump WCH ~= nil` must print `true`. |
| Bridge says `strip seen but rejected` | Another window or overlay covers the corner, or HDR/colour filters are on. Use windowed or borderless mode, turn off HDR, and keep the very top-left corner clear. |
| `/tr` does nothing | Your client already uses `/tr`. Use `/wtr`. |
| Replies go to Say instead of Party | Update to the latest version; the reply now keeps the channel your chat box is on. |
| "Slots running low" warning | Each answer uses one of 200 slots per session. Type `/reload` when convenient to reset them. |
| Chinese/Korean shows as boxes | `/wch font on`. |
| `claude : not logged in` in the bridge banner | Run `claude auth login` once on that PC. |
| Answers take 20 s or more | Check `maxThinkingTokens` is `0` in `bridge/config.json`. |

The bridge also writes everything it does to its console window; when you report a bug,
include the last 30 lines.

## Privacy, cost and game rules

- **What leaves your PC:** the text of chat lines that get explained (sender name,
  channel and up to four previous lines of that conversation for context) and the
  sentences you translate are sent to Anthropic through Claude Code, under your Claude
  account's terms. Nothing is sent for messages that are not explained. Nothing else
  from the game is read.
- **Cost:** it uses your Claude plan's usage through Claude Code; there is no separate
  bill. Haiku is used for almost everything to keep it light.
- **Game rules:** the addon only uses Blizzard's documented addon API. The bridge only
  reads a small corner of the screen and writes ordinary files; it does not read game
  memory, inject anything or press keys, and **it never sends chat for you**. It is
  still a third-party tool that Blizzard has not endorsed. Use it at your own risk under
  Blizzard's Terms of Use.

## Publishing to CurseForge / Wago

Addon managers (CurseForge app, WowUp, Wago app) install **only the addon folders**. The
bridge cannot be distributed through them (no executables or companion programs in the
zip), so users always need step 2 of [Install](#install) for the bridge, and the addon
page must say so at the top. This is how other addons with a desktop companion do it
(for example Offhand: addon on CurseForge, companion on GitHub Releases).

Current state of the platforms (checked 2026-10-06):

| Platform | WoW: Forever | Notes |
|---|---|---|
| CurseForge | yes, as its own game version | detected from `## Interface: 16001` in the TOC; .zip only; no external download links inside the zip |
| Wago Addons | yes ("Classic Forever 1.60.1", key `forever`) | Developer Agreement: .zip, no .exe |
| WoWInterface | not confirmed | skip until Forever support is confirmed |

**What goes in the zip:** `WoWChatHelper` (with `sig\` and `Fonts\`), the 9
`WoWChatHelper_Glossary_*` folders and the 200 `WoWChatHelper_S###` folders, all at the
top level. The slot folders and signal files are generated by `setup.js` today, so a
build step must create them before packaging. With that zip installed by a manager,
`node setup.js` still runs to configure the bridge and skips files that already exist.

Packaging is **not set up in this repository yet**; these are the steps to do it.

**Steps:**

1. Create the project on [CurseForge](https://authors.curseforge.com) and
   [Wago](https://addons.wago.io) (game: World of Warcraft, version: Forever). Put the
   "**requires the companion bridge**, install it from GitHub" notice and a link to this
   README first in the description. Note the project IDs.
2. Add `## X-Curse-Project-ID: <id>` and `## X-Wago-ID: <id>` to
   `addon/WoWChatHelper/WoWChatHelper.toc`.
3. Create API tokens (CurseForge: *My API Tokens*; Wago: *Developer* settings) and save
   them as GitHub repository secrets `CF_API_KEY` and `WAGO_API_TOKEN`.
4. Add the packaging files ([BigWigsMods/packager](https://github.com/BigWigsMods/packager),
   which knows Forever as `-g forever`): a `.pkgmeta` and a release workflow that first
   generates the slot and signal files, then runs the packager. A full worked example is
   in [docs/PUBLISHING.md](docs/PUBLISHING.md).
5. Push a tag like `v0.2.0`. The workflow builds the zip, uploads it to CurseForge and
   Wago, and attaches it plus the bridge to a GitHub Release.
6. First upload as **alpha**: moderators may ask about the companion program, and the
   file count (≈3,000 files, 210 folders) has not been tried on these sites yet.

## Development

```bash
npm ci
npm test                         # 230 tests: Lua addon in a VM with a WoW API stub,
                                 # bridge with a fake claude, end-to-end round trips
node tools/build-glossary.js     # regenerate the per-language glossary addons from data/
node tests/live/eval_glossary_style.js   # optional: live quality eval with the real claude CLI
```

Layout: `addon/` (WoW addons), `bridge/` (Node.js bridge, `capture.ps1`), `data/glossary/`
(the glossary master data), `tools/` (glossary and font builders), `tests/`, `docs/`
(spec, architecture, research and eval results). Design spec:
[docs/superpowers/specs/2026-10-05-wow-ai-chat-helper-design.md](docs/superpowers/specs/2026-10-05-wow-ai-chat-helper-design.md).
CI runs the tests on Ubuntu and Windows.

## Known limitations

- **Accuracy:** in the last live test (80 lines in three languages, graded by a second
  model) the meaning was right about 88% of the time and the replies scored 3.4/5 for
  naturalness. Use `[詳細]` when something looks off.
- **Speed:** a batch of messages takes about 3–13 s to come back.
- **Translations** other than zhTW are AI-made and unreviewed; German is the weakest.
- **Busy chats** can use up the 200 slots in a long session (`/reload` resets them).
- **Raid encounters and Mythic+**: the game hides chat text from addons there, so those
  lines are skipped.
- **One bridge only:** do not run this together with the wow-ai bridge; both use the same
  screen corner.
- Windows only for now.

## Credits and license

The transport design and parts of its code come from
[**wow-ai**](https://github.com/chelinho139/wow-ai) by chelinho139 (MIT), which showed
that a sandboxed WoW: Forever addon can talk to a local program in both directions. The
first-load file behaviour it relies on was measured by
[wow-forever-codex](https://github.com/0xinuarashi/wow-forever-codex). Fonts: Noto Sans
TC/SC/KR subsets, SIL Open Font License. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

MIT License.
