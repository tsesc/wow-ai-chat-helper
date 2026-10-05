#!/usr/bin/env python3
"""Rebuild the bundled font subsets in addon/WoWChatHelper/Fonts/ (all SIL OFL 1.1).

Usage:  uv run --with fonttools --with brotli tools/build-font.py [tc] [sc] [kr]
        (no names = all three; optional --src-tc/--src-sc/--src-kr <path> use a local
        source file instead of the cached download)

Fonts:
  WCH-CJK.ttf  Noto Sans TC subset (Traditional Chinese; also the font the addon uses for
               Latin/Cyrillic languages on a CJK client, so it carries Latin Ext-A + Cyrillic)
  WCH-SC.ttf   Noto Sans SC subset (Simplified Chinese)
  WCH-KR.ttf   Noto Sans KR subset (Korean)

Source fonts (downloaded to $TMPDIR if not cached; variable TrueType with glyf outlines,
instantiated at wght=400 so the result is a static .ttf, which is what the WoW client reads):
  https://github.com/google/fonts/raw/main/ofl/notosanstc/NotoSansTC[wght].ttf
  https://github.com/google/fonts/raw/main/ofl/notosanssc/NotoSansSC[wght].ttf
  https://github.com/google/fonts/raw/main/ofl/notosanskr/NotoSansKR[wght].ttf

Character set of every font:
  - ASCII, Latin-1, Latin Extended-A (U+0100-017F: oe, accented names), Cyrillic
    (U+0400-04FF), general punctuation (U+2000-206F), arrows, CJK symbols/punctuation
    (U+3000-303F), fullwidth forms (U+FF00-FFEF)
  - the "tr" strings of that font's glossary locale(s) in data/glossary/*.json, and that
    locale's table in addon/WoWChatHelper/Locales.lua
  - the LANG_NAME of every language (shown by /wch lang), where the source has the glyphs
plus, per font:
  tc: Bopomofo; the 4808 characters of the Taiwan MOE 常用國字標準字體表
      (tools/data/moe-4808.txt, copied from https://github.com/Watermelonnn/ChineseUsefulToolKit,
      file 教育部常用字4808字.txt); every non-ASCII character in addon/WoWChatHelper/*.lua
      other than Locales.lua; the strings of the Latin/Cyrillic locales (deDE frFR esES ptBR
      ruRU itIT), since the addon uses this font for them on a CJK client
  sc: the 6763 hanzi of GB/T 2312-1980 levels 1+2 (tools/data/gb2312-6763.txt, generated
      by decoding every GB2312 double-byte code in rows 0xB0-0xF7 with Python's gb2312 codec)
  kr: the 2350 Hangul syllables of KS X 1001 (tools/data/ksx1001-hangul-2350.txt, generated
      by decoding rows 0xB0-0xC8 with Python's euc_kr codec) and Hangul Compatibility Jamo
      (U+3130-318F)
"""
import glob
import json
import os
import re
import sys
import tempfile
import urllib.request

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS_DIR = os.path.join(ROOT, "addon", "WoWChatHelper", "Fonts")
ADDON_DIR = os.path.join(ROOT, "addon", "WoWChatHelper")
DATA = os.path.join(ROOT, "tools", "data")
GLOSSARY = os.path.join(ROOT, "data", "glossary")
GF = "https://github.com/google/fonts/raw/main/ofl/"
LATIN_CYR = ["deDE", "frFR", "esES", "ptBR", "ruRU", "itIT"]

FONTS = {
    "tc": {"out": "WCH-CJK.ttf", "url": GF + "notosanstc/NotoSansTC%5Bwght%5D.ttf",
           "cache": "NotoSansTC-wght.ttf", "locales": ["zhTW"] + LATIN_CYR,
           "ranges": [(0x3100, 0x312F)], "lists": ["moe-4808.txt"], "addon_lua": True},
    "sc": {"out": "WCH-SC.ttf", "url": GF + "notosanssc/NotoSansSC%5Bwght%5D.ttf",
           "cache": "NotoSansSC-wght.ttf", "locales": ["zhCN"],
           "ranges": [], "lists": ["gb2312-6763.txt"], "addon_lua": False},
    "kr": {"out": "WCH-KR.ttf", "url": GF + "notosanskr/NotoSansKR%5Bwght%5D.ttf",
           "cache": "NotoSansKR-wght.ttf", "locales": ["koKR"],
           "ranges": [(0x3130, 0x318F)], "lists": ["ksx1001-hangul-2350.txt"], "addon_lua": False},
}
BASE_RANGES = [(0x20, 0x7E), (0xA0, 0xFF), (0x100, 0x17F), (0x400, 0x4FF), (0x2000, 0x206F),
               (0x2190, 0x2193), (0x3000, 0x303F), (0xFF00, 0xFFEF)]


def source_font(name, override):
    if override:
        return override
    spec = FONTS[name]
    cache = os.path.join(tempfile.gettempdir(), spec["cache"])
    if not os.path.exists(cache):
        print("downloading", spec["url"])
        urllib.request.urlretrieve(spec["url"], cache)
    return cache


def locale_tables(path):
    """{ locale: source text of `Locales.<loc> = { ... }` } from Locales.lua (empty if absent)."""
    if not os.path.exists(path):
        return {}
    text = open(path, encoding="utf-8").read()
    out = {}
    for m in re.finditer(r"^Locales\.(\w+)\s*=\s*\{\n(.*?)^\}", text, re.S | re.M):
        out[m.group(1)] = m.group(2)
    return out


def glossary_strings(locale):
    strs = []
    for fname in ("terms.json", "phrases.json"):
        p = os.path.join(GLOSSARY, fname)
        if not os.path.exists(p):
            continue
        for e in json.load(open(p, encoding="utf-8")):
            v = (e.get("tr") or {}).get(locale)
            if v:
                strs.append(v)
    return strs


def wanted_codepoints(name):
    spec = FONTS[name]
    cps = set()
    for lo, hi in BASE_RANGES + spec["ranges"]:
        cps.update(range(lo, hi + 1))
    for lst in spec["lists"]:
        with open(os.path.join(DATA, lst), encoding="utf-8") as f:
            cps.update(ord(c) for c in f.read() if ord(c) > 0x2E80)
    tables = locale_tables(os.path.join(ADDON_DIR, "Locales.lua"))
    for loc in spec["locales"]:
        for s in glossary_strings(loc):
            cps.update(ord(c) for c in s)
        cps.update(ord(c) for c in tables.get(loc, "") if ord(c) > 0x7F)
    for body in tables.values():
        m = re.search(r'LANG_NAME\s*=\s*"([^"]*)"', body)
        if m:
            cps.update(ord(c) for c in m.group(1))
    if spec["addon_lua"]:
        for path in glob.glob(os.path.join(ADDON_DIR, "*.lua")):
            if os.path.basename(path) == "Locales.lua":
                continue
            with open(path, encoding="utf-8") as f:
                cps.update(ord(c) for c in f.read() if ord(c) > 0x7F)
    cps.discard(0xFEFF)
    return cps


def build(name, override=None):
    spec = FONTS[name]
    font = TTFont(source_font(name, override))
    if "fvar" in font:
        font = instancer.instantiateVariableFont(font, {"wght": 400})
    opts = subset.Options()
    opts.layout_features = ["kern", "locl"]
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    opts.notdef_outline = True
    opts.glyph_names = False
    opts.hinting = False
    opts.drop_tables += ["DSIG", "BASE", "GSUB", "GPOS", "GDEF", "vhea", "vmtx"]
    sub = subset.Subsetter(opts)
    cps = wanted_codepoints(name)
    sub.populate(unicodes=cps)
    sub.subset(font)
    cmap = font.getBestCmap()
    # Only report what matters: requested non-control characters the source lacks.
    missing = sorted(cp for cp in cps if cp not in cmap and cp >= 0x20 and not 0x7F <= cp <= 0x9F)
    out = os.path.join(FONTS_DIR, spec["out"])
    os.makedirs(FONTS_DIR, exist_ok=True)
    font.save(out)
    print("wrote", out, os.path.getsize(out), "bytes;", len(cmap), "cmap entries;",
          len(missing), "requested codepoints not in source:",
          " ".join(chr(c) for c in missing[:60]))


def main(argv):
    names, overrides, i = [], {}, 0
    while i < len(argv):
        a = argv[i]
        if a.startswith("--src-"):
            overrides[a[6:]] = argv[i + 1]
            i += 2
            continue
        if os.path.isfile(a):  # old usage: a single source path = the TC font
            overrides["tc"] = a
            names.append("tc")
        elif a in FONTS:
            names.append(a)
        else:
            sys.exit("unknown font %r (expected tc, sc, kr)" % a)
        i += 1
    for name in names or list(FONTS):
        build(name, overrides.get(name))


if __name__ == "__main__":
    main(sys.argv[1:])
