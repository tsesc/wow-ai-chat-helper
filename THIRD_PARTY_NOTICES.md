# Third-party notices

## wow-ai

This project's transport layer (pixel strip out, load-on-demand slot addons in,
empty-wav signals) is derived from **wow-ai** by chelinho139:
https://github.com/chelinho139/wow-ai (reference commit 3756eb5a5e7858bf9e38786bc89f889a523dd55e).
Files copied or adapted from it carry a header comment saying so.

The idea that load-on-demand files are read fresh on first use was measured on live
WoW: Forever clients by wow-forever-codex (https://github.com/0xinuarashi/wow-forever-codex).
No code was taken from that project (it has no license).

wow-ai license:

```
MIT License

Copyright (c) 2026 chelinho139

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Noto Sans TC / SC / KR (fonts)

`addon/WoWChatHelper/Fonts/WCH-CJK.ttf`, `WCH-SC.ttf` and `WCH-KR.ttf` are subsets of
Noto Sans TC, Noto Sans SC and Noto Sans KR (Copyright Google LLC / Adobe), licensed under
the SIL Open Font License 1.1. The full license text is in
`addon/WoWChatHelper/Fonts/OFL.txt`; the subsets are rebuilt by `tools/build-font.*`.

## MOE common-character list (`tools/data/moe-4808.txt`)

The list of 4,808 common Traditional Chinese characters used to pick the glyphs for
`WCH-CJK.ttf` was copied from https://github.com/Watermelonnn/ChineseUsefulToolKit
(itself derived from the Taiwan Ministry of Education 常用國字標準字體表). It is data,
not code, and is used only at font build time by `tools/build-font.py`.
