# Client locales and fonts (for the multi-locale round)

Date: 2026-10-06. Evidence grades: **[P]** primary source fetched this session, **[C]** checked
in this repo, **[K]** well-known, not re-checked, **[NV]** not verified — needs the in-game
spike on the user's Windows PC.

Sources fetched 2026-10-06:
- Blizzard UI source mirror, **`forever` branch**:
  `Gethe/wow-ui-source/forever/Interface/AddOns/Blizzard_Fonts_Shared/{Shared,Mainline}/Fonts.xml`
  (the `forever` branch exists next to `live`, `classic_era`, ...).
- LibSharedMedia-3.0 trunk, `repos.wowace.com/wow/libsharedmedia-3-0/trunk/LibSharedMedia-3.0/LibSharedMedia-3.0.lua`
  (header table of which font files ship with which client locale, lines ~100-125).
- warcraft.wiki.gg `API_CreateFontFamily`, `API_C_UIFileAsset.IsKnownFile` (both list
  "Forever 1.60.1" as a supported version).

## 1. Locale codes (`GetLocale()`)

Retail-family clients return one of: `enUS`, `enGB` (EU English), `deDE`, `frFR`, `esES`,
`esMX`, `ptBR` (also used for Portuguese in EU), `itIT`, `ruRU`, `koKR`, `zhCN`, `zhTW` [K].
`enGB`/`ptPT` return-value details [NV]. The user's client returns `zhTW` (live finding,
WoW: Forever 1.60.1.70205).

Mapping for this addon: `esMX` -> `esES` data; `enUS`/`enGB` -> not a target language
(prompt the player via `/wch lang`); `ptPT` (if ever returned) -> `ptBR`.

## 2. Which font files each client ships

From the LibSharedMedia header table (X = file present and supports that locale's glyphs;
`x` = present but only partial use) [P]:

| file | name | western (enUS, deDE, frFR, esES, esMX, ptBR, itIT) | koKR | ruRU | zhCN | zhTW |
|---|---|---|---|---|---|---|
| 2002.ttf / 2002B.ttf | 2002 (Hangul) | X | X | X | - | - |
| K_Pagetext.TTF | MoK (Hangul) | X | X | X | - | - |
| K_Damage.TTF | YDIWingsM | - | X | X | - | - |
| ARHei.ttf | AR CrystalzcuheiGBK Demibold | X | - | X | X | X |
| ARKai_T.ttf / ARKai_C.ttf | AR ZhongkaiGBK Medium | X | - | X | X | X |
| bHEI00M / bHEI01B / bKAI00M / bLEI00D .ttf | AR Heiti2/Kaiti/Leisu B5 (Big5) | - | - | - | - | X |
| ARIALN.TTF | Arial Narrow | X | - | X | - | - |
| FRIZQT__.TTF | Friz Quadrata (Latin) | X | - | - | - | - |
| FRIZQT___CYR.TTF | FrizQuadrataCTT (Cyrillic) | x | - | X | - | - |
| MORPHEUS_CYR / SKURRI_CYR / NIM_____ | decorative, Cyrillic | X | - | X | - | - |

LSM note, verbatim: "Although FRIZQT___CYR is available on western clients, it doesn't
support special European characters e.g. é, ï, ö" [P].

Caveats: the table is written for Retail; Forever shares the Retail UI architecture
(transport-research.md Q1), and the forever-branch Fonts.xml references the same files,
so the table very likely applies — but **[NV] on Forever**. Newer Retail font
`arheiuhk_bd.TTF` (Traditional Chinese, see 3) is not in the LSM table; which clients ship
it is [NV] (assume zhTW only).

## 3. How the default UI picks a font (forever-branch Fonts.xml) [P]

Every shared font object is a `FontFamily` with five members: `roman`, `korean`,
`simplifiedchinese`, `traditionalchinese`, `russian` (88 families, each with all five).
Example, the chat font chain `ChatFontNormal` -> `NumberFont_Shadow_Med`:

| alphabet | file |
|---|---|
| roman | Fonts\ARIALN.TTF (14) |
| korean | Fonts\2002.TTF (13) |
| simplifiedchinese | Fonts\ARHei.ttf (14) |
| traditionalchinese | Fonts\arheiuhk_bd.TTF (14) |
| russian | Fonts\ARIALN.TTF (14) |

Most UI text (`SystemFont_*`, `GameFont*`): roman = FRIZQT__.TTF, korean = 2002.TTF,
simplifiedchinese = ARKai_T.ttf, traditionalchinese = blei00d.TTF, russian = FRIZQT___CYR.TTF.

Inference (not verified): the member is selected **once by client locale**, not per glyph.
So a zhTW client uses `arheiuhk_bd`/`blei00d` everywhere, an enUS client uses
ARIALN/FRIZQT__ everywhere. Text in another script falls back to whatever glyphs that one
file has; missing glyphs render as boxes/blank. [NV — the Windows spike should confirm by
printing Hangul, Simplified, Cyrillic and `äöüßéèçñœ` in a zhTW client's default chat.]

Also note: `FontString:SetFont(path, ...)` on a chat frame replaces the family member for
that object; the addon already does this for `WCH_DB.chatFont` (UI.lua:585-610) [C].

## 4. Can a client render script X with its own fonts?

Answers derive from section 2 (file presence) + glyph-set reasoning. "Default" = the default
chat/UI font; "other client font" = an addon can `SetFont("Fonts\\<file>")` on a file that
ships with that client.

| client \ needs | Traditional Chinese | Simplified Chinese | Hangul | Cyrillic | Latin + diacritics (de/fr/es/pt/it) |
|---|---|---|---|---|---|
| zhTW | default: yes (live finding) | default Big5 fonts: lack many simplified forms [K, Big5 has no simplified-only chars]; other client font ARHei/ARKai_T (GBK) ships on zhTW [P] and GBK covers GB2312 simplified [K] -> likely yes via `Fonts\\ARHei.ttf` [NV in-game] | **no** client font with Hangul ships on zhTW [P] -> needs bundled KR font | Big5 Cyrillic only via the ETEN extension [NV]; GB2312 includes Cyrillic [K] so `Fonts\\ARHei.ttf` likely works [NV] -> treat as not covered | Big5 has no ä ö ü ß ñ ç é [K]; GBK has only pinyin vowels (à á é è ü ê ...) [K] -> **probably boxes** for ß ñ ç ä ö (de/es/pt/fr) [NV] -> bundled font needed |
| zhCN | GBK covers most traditional chars [K] -> mostly yes [NV] | yes | no Hangul file [P] | GB2312 Cyrillic [K] -> likely yes | as zhTW -> likely gaps [NV] |
| koKR | KS X 1001 has 4888 Hanja [K] — partial; many Chinese chars missing -> **no** for running text | **no** | yes | 2002 font Cyrillic coverage [NV] (KS X 1001 includes Cyrillic [K]) | 2002 Latin-1 coverage [NV] |
| western (enUS etc.) | default ARIALN/FRIZQT__: no CJK [K]; other client font ARHei/ARKai_T ships on western [P] -> via SetFont likely yes for most traditional chars [NV] | via `Fonts\\ARHei.ttf` / `ARKai_T.ttf`: yes [P file present] | via `Fonts\\2002.TTF`: yes [P file present] | chat font ARIALN: yes (Fonts.xml uses ARIALN as the russian member) [P]; FRIZQT__ UI font: **no** -> use `Fonts\\FRIZQT___CYR.TTF` or ARIALN for own strings [P] | yes [K] |
| ruRU | ARHei present [P] -> likely yes | yes via ARHei [P] | yes via 2002 [P] | yes | FRIZQT___CYR lacks é ï ö [P]; ARIALN Latin-1 [NV] -> use ARIALN for Latin text |

Answer to the specific questions:
- **enUS client + Cyrillic:** yes in the chat frame (ARIALN), no in FRIZQT__-based UI text;
  FRIZQT___CYR.TTF ships on western clients and can be used by the addon [P].
- **enUS client + Hangul / Simplified Chinese:** not with the default font; yes if the addon
  sets `Fonts\\2002.TTF` / `Fonts\\ARHei.ttf`, which ship on western clients [P, file
  presence; in-game rendering NV].
- **zhTW client + Hangul:** no client font -> bundled KR subset required [P].
- **zhTW client + Simplified:** default font probably not complete; `Fonts\\ARHei.ttf` ships
  on zhTW per LSM [P] and the spike checklist already tests `ARHei.ttf` / `ARKai_T.ttf` on the
  user's client (docs/SPIKE-CHECKLIST.md item 1) — read its result before deciding [C].
- **Fonts of another locale's client** (e.g. `Fonts\\2002.TTF` on zhTW): only usable if that
  file ships with the running client. Per LSM, zhTW/zhCN clients do **not** ship 2002/
  K_Pagetext; koKR does **not** ship ARHei/ARKai; only zhTW ships the bHEI/bLEI/bKAI Big5
  files. Western and ruRU clients ship the most (Hangul + GBK + Cyrillic) [P].

## 5. Runtime probing (available on Forever) [P]

- `C_UIFileAsset.IsKnownFile(path)` -> boolean: "whether a file asset is known to the client,
  either as a shipped asset or a locally existing loose file". Listed for Forever 1.60.1+.
  Use it to test `Fonts\\2002.TTF`, `Fonts\\ARHei.ttf`, `Fonts\\FRIZQT___CYR.TTF`,
  `Interface\\AddOns\\WoWChatHelper\\Fonts\\WCH-*.ttf` before calling SetFont. LSM itself
  relies on it (LSM line ~240). Guard with `C_UIFileAsset and C_UIFileAsset.IsKnownFile`.
- `fs:SetFont()` returns a truthy value on success (the addon already checks it, UI.lua:44,
  590) [C]. A file being "known" does not prove it has the needed glyphs; there is no glyph
  query API [K] (`GetStringWidth` of a box glyph is non-zero, so width tests are unreliable
  [NV]).
- `CreateFontFamily(name, members)` with `{alphabet, file, height, flags}` members exists on
  Forever 1.60.1 [P]. Allowed alphabet strings (from Fonts.xml): `roman`, `korean`,
  `simplifiedchinese`, `traditionalchinese`, `russian`. It does not give per-glyph fallback
  if the inference in section 3 holds, so it does not solve mixed-script lines.

## 6. Bundled font facts [C, measured this session with fontTools]

- `addon/WoWChatHelper/Fonts/WCH-CJK.ttf`: 1,684,000 bytes, 5,371 glyphs (~313 B/glyph).
  Coverage: Latin-1 96/96, Latin Extended-A 0/128 (no `œ` U+0153), Cyrillic 0/64, Hangul 0,
  simplified-only chars (们, 这) absent.
- Source `NotoSansTC[wght].ttf`: Latin Ext-A 30/128 (has `œ`), Cyrillic А-я 64/64, no Hangul,
  no simplified-only chars. So the TC subset can gain Cyrillic + `œ` almost free by adding
  U+0100-017F and U+0400-04FF to `tools/build-font.py`'s ranges.
- Size estimates at ~313 B/glyph: SC subset with 通用规范汉字表 level-1 (3,500 chars) + ASCII/
  Latin-1/punct + glossary chars ≈ 1.2 MB; full GB2312 (6,763) ≈ 2.2 MB (under the 3 MB
  target). KR subset with KS X 1001's 2,350 Hangul syllables + jamo + Latin ≈ 0.8-1.0 MB
  (Hangul outlines in Noto Sans KR may be larger per glyph [NV]); all 11,172 syllables ≈
  3.5 MB+ (over target). Fonts: Noto Sans SC / Noto Sans KR, SIL OFL 1.1, from
  google/fonts `ofl/notosanssc`, `ofl/notosanskr` [K; URLs NV].

## 7. Recommended font policy

1. **Need table** per chosen language: zhTW -> Hant; zhCN -> Hans; koKR -> Hangul; ruRU ->
   Cyrillic; deDE/frFR/esES/ptBR/itIT -> Latin-1 (+ `œ` for frFR).
2. **Covered natively only when** client locale == chosen language (the fixed conservative
   rule), plus one safe extension: a **western** client covers the five Latin languages
   (FRIZQT__/ARIALN are Latin-1 fonts [K]). Everything else -> `chatFont` default ON with
   the matching bundled font.
3. Bundled fonts: `WCH-CJK.ttf` (TC, existing; add Latin Ext-A + Cyrillic ranges),
   `WCH-SC.ttf` (Noto Sans SC subset, GB2312 or level-1 list), `WCH-KR.ttf` (Noto Sans KR
   subset, KS X 1001 2,350 syllables + jamo). Each subset also includes ASCII + Latin-1 +
   Latin Ext-A + Cyrillic so that English chat and player names keep rendering after the
   chat-frame swap.
4. **Latin/Cyrillic languages on a CJK/KR client** (e.g. zhTW client + deDE): use the
   bundled TC font (it has Latin-1, and Cyrillic once ranges are added) rather than the
   client's Big5 font, which probably lacks ß ñ ç ä ö [NV]. On a western client + ruRU: no
   bundled font needed for chat (ARIALN has Cyrillic [P]); for the addon's own FontStrings
   use `Fonts\\FRIZQT___CYR.TTF` or `Fonts\\ARIALN.TTF` (probe with IsKnownFile), never
   FRIZQT__. **No separate Cyrillic font file needs to ship** if the TC subset carries
   Cyrillic.
5. Optional optimisation (only after the spike proves rendering): prefer a shipped client
   font when `IsKnownFile` is true and the pairing is known-good — western/ruRU + koKR ->
   `Fonts\\2002.TTF`; western/ruRU/zhTW + zhCN -> `Fonts\\ARHei.ttf`. Keep the bundled file
   as fallback when `IsKnownFile` is false or SetFont fails.
6. Keep `/wch font on|off` as the manual override; recompute the default only when the
   player has never set it explicitly (store e.g. `WCH_DB.chatFontAuto = true`).

## 8. Items for the Windows spike (cannot be checked from Linux)

- On the zhTW client, print in the default chat font and via SetFont on `Fonts\\ARHei.ttf`,
  `Fonts\\2002.TTF`, `Fonts\\FRIZQT___CYR.TTF`: `简体测试 这们`, `한국어 테스트`,
  `Русский тест`, `äöüß éèçñ œ`. Record OK/BOX for each.
- `C_UIFileAsset.IsKnownFile` results for the same paths and for `Fonts\\arheiuhk_bd.TTF`.
- Whether the meeting stone summons on Forever (for the glossary `summon` entry).
