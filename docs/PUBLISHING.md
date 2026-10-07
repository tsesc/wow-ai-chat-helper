# Publishing to CurseForge and Wago

Status: **plan, not implemented yet.** Facts checked on 2026-10-06; WoW: Forever is in
beta, so re-check the platform pages before the first upload.

## What can and cannot be published

| Piece | Addon managers? | Where it goes |
|---|---|---|
| `WoWChatHelper` (addon, `Fonts\`, `sig\` signal wavs) | yes | CurseForge / Wago zip |
| `WoWChatHelper_Glossary_<locale>` × 9 | yes | same zip |
| `WoWChatHelper_S001` … `S200` (slot addons) | yes | same zip |
| Bridge (`bridge\`, `setup.js`, `data\glossary`, Node.js) | **no** (no executables or companion programs in addon zips) | GitHub (clone or Release zip) |

Every user still installs the bridge from GitHub. Say so in the first lines of each
project page and link to the README's Install section; CurseForge does not allow
download links *inside* the zip, but the description may link to the companion (the
Offhand addon does exactly this).

## Platform facts

- **CurseForge** has a separate *Forever* game version. Uploads are tagged from the TOC:
  `## Interface: 16001`. A multi-flavor TOC (`## Interface: 120100, 16001`) is tagged for
  each. Only `.zip`. Moderation policy:
  <https://support.curseforge.com/support/solutions/articles/9000197279-moderation-policies>.
- **Wago Addons** lists Forever as "Classic Forever 1.60.1" (version key `forever`).
  Developer Agreement: `.zip`, no `.exe`: <https://addons.wago.io/agreements/developer-agreement>.
- **WoWInterface**: Forever support not confirmed; skip for now.
- **BigWigsMods/packager** (v2.6.1+) maps Interface `16???` to the `forever` game type;
  pass `-g forever` explicitly. Token names: `CF_API_KEY`, `WAGO_API_TOKEN`,
  `GITHUB_OAUTH` (or `GITHUB_TOKEN` passed as `GITHUB_OAUTH`).
- Blizzard's UI Add-On Development Policy: free of charge, no obfuscated code, no in-game
  advertising or donation requests, no harm to realm performance:
  <https://us.forums.blizzard.com/en/wow/t/ui-add-on-development-policy/24534>.

## Build step needed first

The slot addons and signal wavs are created by `setup.js` on the user's PC today and are
not in the repository. A release needs them in the zip, so add a small script (planned
name `tools/build-dist.js`) that, using the same code as `bridge/install-slots.js`:

1. creates `addon/WoWChatHelper_S001` … `S200` and `addon/WoWChatHelper/sig/...`;
2. writes `.pkgmeta` with one `move-folders` line per addon folder (211 lines, generated,
   not hand-written).

`setup.js` already leaves existing files alone, so a manager-installed addon plus a
`node setup.js` run for the bridge works without duplicates.

## `.pkgmeta` (generated)

```yaml
package-as: WoWChatHelper

move-folders:
  wow-ai-chat-helper/addon/WoWChatHelper: WoWChatHelper
  wow-ai-chat-helper/addon/WoWChatHelper_Glossary_zhTW: WoWChatHelper_Glossary_zhTW
  # ... the other 8 glossary addons
  wow-ai-chat-helper/addon/WoWChatHelper_S001: WoWChatHelper_S001
  # ... through S200

ignore:
  - bridge
  - data
  - docs
  - tests
  - tools
  - spike
  - setup.js
  - package.json
  - package-lock.json

manual-changelog:
  filename: CHANGELOG.md
  markup-type: markdown
```

Check the `move-folders` source prefix (repository name) against the packager's
documentation for the version you pin.

## Release workflow (`.github/workflows/release.yml`)

```yaml
name: release
on:
  push:
    tags: ['v*']
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci && npm test
      - run: node tools/build-dist.js          # slots, signal wavs, .pkgmeta
      - uses: BigWigsMods/packager@v2
        with:
          args: -g forever
        env:
          CF_API_KEY: ${{ secrets.CF_API_KEY }}
          WAGO_API_TOKEN: ${{ secrets.WAGO_API_TOKEN }}
          GITHUB_OAUTH: ${{ secrets.GITHUB_TOKEN }}
```

The packager also creates a GitHub Release with the addon zip; attach a bridge zip (the
repository without `addon/`) in a following step, or point users to `git clone`.

## One-time setup

1. Create the projects: CurseForge author portal (game World of Warcraft, version
   Forever) and Wago (Forever). Description: put "**Requires the companion bridge**
   (Windows, Node.js, Claude Code): install from <GitHub link>" at the very top, then
   what it does, privacy (chat text goes to Anthropic through Claude Code), and the
   game-rules note from the README.
2. Add the IDs to `addon/WoWChatHelper/WoWChatHelper.toc`:
   ```
   ## X-Curse-Project-ID: 123456
   ## X-Wago-ID: abcd1234
   ```
3. Create API tokens and add them as repository secrets `CF_API_KEY` and
   `WAGO_API_TOKEN` (GitHub: Settings → Secrets and variables → Actions).
4. The repository is public; packaging works either way, but public addon pages
   should link to a public source repository (Blizzard's policy forbids obfuscation, and
   users will want to read what the bridge does).

## Each release

1. Update `CHANGELOG.md` and the `## Version` in the main TOC.
2. `git tag v0.2.0 && git push --tags`.
3. Watch the workflow; mark the first upload **alpha**.
4. Before the first upload, build locally (`packager -d -z -g forever` or the workflow on
   a test tag) and check: about 211 top-level folders, about 2,800 files under
   `WoWChatHelper/sig`, the zip size, and that the client still starts quickly with all
   of them installed. File-count limits on CurseForge/Wago are not documented.
