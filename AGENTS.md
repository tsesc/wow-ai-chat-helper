# Agent guide

This file is for coding agents (Claude Code, Codex, Gemini CLI, Copilot and similar) that a
user has asked to install, update, fix or change **WoW Chat Helper**. A typical request is:

> Install WoW Chat Helper from https://github.com/tsesc/wow-ai-chat-helper on this Windows PC,
> following the repo's AGENTS.md.

Read `README.md` for what the project does. This file tells you where things are, how to
install it for a user, and how to verify. It does not replace the user-facing docs.

## Ground rules

- The install must run **on the Windows PC that runs World of Warcraft: Forever**. If you are
  not on that machine (Linux, macOS, a server), stop and tell the user to run the agent, or the
  one-line installer in `README.md`, on that PC.
- Only run commands needed for the task the user asked for. Do not read secrets, `~/.claude`
  credentials, unrelated home-directory files, or the user's WoW `WTF\` account folder beyond
  `AddOns.txt` and `SavedVariables\WoWChatHelper.lua`.
- Do not modify this repository to install it. Installation never requires code changes.
- Never type into the game or send chat for the user. The addon shows reply candidates; the
  user presses Enter. Keep it that way.
- Claude is used through the user's **own Claude Code login** (`claude auth login`, a Claude
  subscription). There is no API key to collect. Never ask the user for a key or a password.

## Install for a user (Windows)

The installer `install.ps1` does everything and is idempotent. Prefer it over manual steps.

1. **Check the login first.** Run `claude auth status`. If it is missing or `loggedIn` is
   false, ask the user to run `claude auth login` in their own terminal (it opens a browser).
   Do not try to log in for them; `install.ps1 -NonInteractive` fails on purpose when not
   logged in. If `claude` is not installed yet, let the installer install it, then come back
   to this step.
2. **Find the WoW client folder**: the folder that contains `Wow*.exe` and `Interface\`,
   normally `...\World of Warcraft\_forever_` or, during the beta, `_classic_beta_`.
   `setup.js` and the installer scan `Program Files`, every drive root, `<drive>:\Games` and
   `<drive>:\battle.net`. If the client lives elsewhere, ask the user for the path.
3. **Run the installer non-interactively** so it never waits on a prompt you cannot answer:
   ```powershell
   $f = "$env:TEMP\wch-install.ps1"
   irm https://raw.githubusercontent.com/tsesc/wow-ai-chat-helper/main/install.ps1 -OutFile $f
   powershell -NoProfile -ExecutionPolicy Bypass -File $f -NonInteractive -WowPath "<client folder>"
   ```
   Add `-AutoStart` only if the user asked for the bridge to start at Windows logon.
   Omit `-WowPath` to let it auto-detect. Exit code 0 means success; failures print `FAIL`
   with the reason.
4. **Verify**:
   - `<client>\Interface\AddOns` has `WoWChatHelper`, 9 `WoWChatHelper_Glossary_*` and 200
     `WoWChatHelper_S###` folders.
   - `%LOCALAPPDATA%\WoWChatHelper\app\bridge\config.json` exists and `wowPath` points at the client.
   - `WoW Chat Helper.lnk` is on the desktop (unless `-NoShortcut`).
5. **Start the bridge** for them: `Start-Process "$env:LOCALAPPDATA\WoWChatHelper\app\bridge\start-window.cmd"`.
   A console titled "WoW Chat Helper bridge" opens and must stay open while they play.
   The banner ends with `claude : login ok`.
6. **Tell the user the two things only they can do**: fully quit and relaunch WoW (new addon
   files are only discovered at launch), then on the character screen open **AddOns** and tick
   **WoW Chat Helper** (leave the slot and Glossary entries alone). In game, `/wch` shows a
   green light once the addon and the bridge see each other.

### Update

Run the same installer again (step 3). It replaces `app\` and keeps `bridge\config.json`.
Then restart the bridge; the user runs `/reload` in game, or fully restarts WoW if the release
notes say new addon files were added.

### Uninstall

Stop the bridge window, then delete `%LOCALAPPDATA%\WoWChatHelper`, the desktop shortcut, the
scheduled task `WoW Chat Helper bridge` if it exists, and every `WoWChatHelper*` folder in
`<client>\Interface\AddOns`. `WTF\...\SavedVariables\WoWChatHelper.lua` holds the user's
addon settings; ask before deleting it.

## Troubleshooting pointers

| Symptom | Where to look |
| --- | --- |
| `setup failed: Could not find the WoW client` | Pass `-WowPath`; see step 2 |
| `claude : not logged in` in the bridge banner | Step 1 |
| Bridge says `capture: waiting for WowB window` | WoW is not running, or runs in exclusive fullscreen; it must be windowed / borderless |
| Addon light stays red in game | Bridge not running, or the WoW window's top-left corner is covered; `README.md` → Troubleshooting |
| Chinese shows as boxes | `docs/SPIKE-CHECKLIST.md` (font check) |

## Repository map

| Area | Location | Purpose |
| --- | --- | --- |
| Installer | `install.ps1` | One-line Windows install / update (Node, Claude Code, zip download, setup, shortcut) |
| Setup | `setup.js` | Finds the client, copies the addon and glossaries, builds the slot pool, writes `bridge/config.json` |
| Addon | `addon/WoWChatHelper/` | The in-game addon (Lua); `Locales.lua` has the 9 UI languages |
| Glossary addons | `addon/WoWChatHelper_Glossary_<locale>/` | Generated from `data/glossary/terms.json` by `tools/build-glossary.js` |
| Bridge | `bridge/` | Node program on the same PC: `supervisor.js` → `bridge.js`; `start-window.cmd` / `start.ps1` launch it |
| Docs | `README.md`, `README.zh-TW.md`, `docs/INSTALL-WINDOWS.md`, `docs/ARCHITECTURE.md` | User docs (English and Traditional Chinese), install guide, how the screen-capture transport works |
| Tests | `tests/` (`npm test`) | Node test runner; the addon is tested in a Lua VM (fengari) |
| Spec | `docs/superpowers/specs/` | Design decisions |

## Changing the code

- Run `npm test` before and after; all tests must pass. Node 22.2+ is required.
- Addon strings live in `addon/WoWChatHelper/Locales.lua`; every key must exist in all 9
  languages with the same `%s` placeholders (`tests/addon_locale_test.js` enforces it).
- Glossary changes go in `data/glossary/terms.json`, then `node tools/build-glossary.js`
  regenerates the Lua addons; never edit the generated `Glossary.lua` files by hand.
- Keep `README.md` and `README.zh-TW.md` in sync when behaviour or install steps change.
- Credit: parts of the bridge are adapted from chelinho139/wow-ai (MIT); keep the header
  comments and `THIRD_PARTY_NOTICES.md` accurate.
