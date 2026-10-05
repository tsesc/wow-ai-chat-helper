#!/usr/bin/env python3
"""Rebuild addon/WoWChatHelper/Fonts/WCH-CJK.ttf (a subset of Noto Sans TC, SIL OFL 1.1).

Usage:  uv run --with fonttools --with brotli tools/build-font.py [path/to/NotoSansTC[wght].ttf]

Source font (downloaded if no path is given and not cached in $TMPDIR):
  https://github.com/google/fonts/raw/main/ofl/notosanstc/NotoSansTC[wght].ttf
  (variable TrueType, glyf outlines; we instantiate it at wght=400 so the result is a
  static .ttf, which is what the WoW client reads.)

Character set:
  - ASCII, Latin-1, general punctuation (U+2000-206F), arrows, CJK symbols/punctuation
    (U+3000-303F), Bopomofo, fullwidth forms (U+FF00-FFEF)
  - the 4808 characters of the Taiwan MOE 常用國字標準字體表, tools/data/moe-4808.txt
    (copied from https://github.com/Watermelonnn/ChineseUsefulToolKit, file
    教育部常用字4808字.txt)
  - every non-ASCII character that appears in addon/WoWChatHelper/*.lua
"""
import glob
import os
import sys
import tempfile
import urllib.request

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "addon", "WoWChatHelper", "Fonts", "WCH-CJK.ttf")
URL = "https://github.com/google/fonts/raw/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf"


def source_font():
    if len(sys.argv) > 1:
        return sys.argv[1]
    cache = os.path.join(tempfile.gettempdir(), "NotoSansTC-wght.ttf")
    if not os.path.exists(cache):
        print("downloading", URL)
        urllib.request.urlretrieve(URL, cache)
    return cache


def wanted_codepoints():
    cps = set()
    for lo, hi in [(0x20, 0x7E), (0xA0, 0xFF), (0x2000, 0x206F), (0x2190, 0x2193),
                   (0x3000, 0x303F), (0x3100, 0x312F), (0xFF00, 0xFFEF)]:
        cps.update(range(lo, hi + 1))
    with open(os.path.join(ROOT, "tools", "data", "moe-4808.txt"), encoding="utf-8") as f:
        cps.update(ord(c) for c in f.read() if ord(c) > 0x2E80)
    for path in glob.glob(os.path.join(ROOT, "addon", "WoWChatHelper", "*.lua")):
        with open(path, encoding="utf-8") as f:
            cps.update(ord(c) for c in f.read() if ord(c) > 0x7F)
    cps.discard(0xFEFF)
    return cps


def main():
    font = TTFont(source_font())
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
    cps = wanted_codepoints()
    sub.populate(unicodes=cps)
    sub.subset(font)
    cmap = font.getBestCmap()
    missing = sorted(cp for cp in cps if cp not in cmap)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    font.save(OUT)
    print("wrote", OUT, os.path.getsize(OUT), "bytes;", len(cmap), "cmap entries;",
          len(missing), "requested codepoints not in source:",
          " ".join(chr(c) for c in missing[:40]))


if __name__ == "__main__":
    main()
