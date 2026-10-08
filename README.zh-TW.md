# wow-ai-chat-helper

[English](README.md) · **繁體中文**

給在美服玩 **魔獸世界：Forever（WoW: Forever）**、英文不是母語的玩家用的遊戲內 AI
聊天助手。全部在遊戲畫面裡完成：

- **把收到的聊天解釋成你的語言**：翻譯，加上每個術語的一行說明
  （`LF1M tank HC DM, inv`、`ah isn't down for everyone`、`ss me pls`）。
- **給你 2–3 句美服玩家口吻的英文回覆**（`omw`、`heals here, inv?`、`how much for 5?`）。
  點一句就會填進聊天框，頻道或密語對象都設好了，**由你自己按 Enter 送出**。addon
  絕不會替你發話。
- **把你打的中文翻成英文**：`/wtr 我五分鐘後到` → `omw, 5 min`，一樣是點選後填入。
- **可搜尋的術語表**：約 1,800 個 WoW 術語，會標註容易誤會的詞（感嘆詞 `ah` 和拍賣場
  `AH`），AI 幫你解釋過的新詞也會記下來。

物品、法術、任務、地名一律保留英文（例如 `[Elixir of the Mongoose]`），方便你直接拿去
拍賣場或 Wowhead 搜尋。

> **目前狀態（v0.1，2026 年 10 月）**：已在 Windows 上的真實 WoW: Forever beta client
> （繁中，1.60.1.70205）完整跑通。還很新：最近一次 80 句的測試裡，意思正確率約 88%；
> 繁中以外的翻譯都還沒經過母語者校對。詳見[已知限制](#已知限制)。

---

## 目錄

1. [運作方式](#運作方式)
2. [需求](#需求)
3. [安裝](#安裝)
4. [遊戲內使用方式](#遊戲內使用方式)
5. [指令一覽](#指令一覽)
6. [語言](#語言)
7. [設定](#設定)
8. [疑難排解](#疑難排解)
9. [隱私、費用與遊戲規範](#隱私費用與遊戲規範)
10. [上架到 CurseForge／Wago](#上架到-curseforgewago)
11. [開發](#開發)
12. [已知限制](#已知限制)
13. [致謝與授權](#致謝與授權)

---

## 運作方式

WoW 的 addon 在沙盒裡執行：遊戲中不能連網路、也不能讀檔。所以這個專案有**兩個部分，兩個
都要裝**：

| 部分 | 跑在哪裡 | 做什麼 |
|---|---|---|
| **Addon**（`WoWChatHelper`、術語表、slot addon） | 遊戲裡 | 看聊天、顯示說明和回覆按鈕、術語表視窗 |
| **Bridge 橋接程式**（本 repo 的 Node.js 程式） | 同一台 Windows 電腦，在遊戲旁邊 | 從畫面讀取 addon 的訊息、問 AI（Claude 或 Codex）、把答案送回遊戲 |

```
 WoW（addon）                                  Bridge（Node.js，同一台電腦）
 ┌────────────────────────────┐  像素條       ┌───────────────────────────────┐
 │ 聊天訊息 ─▶ 左上角彩色小格子├──────────────▶│ 截圖 ─▶ 解碼                   │
 │                            │               │ 比對術語表 ─▶ Claude CLI       │
 │                            │  slot 檔案    │ （Haiku；「詳細」用 Sonnet）    │
 │ 中文說明 + 回覆按鈕         │◀──────────────┤ 答案 ─▶ 隨需求載入的檔案        │
 └────────────────────────────┘               └───────────────────────────────┘
```

- **送出**：addon 把訊息畫成畫面左上角一小排 4 像素的彩色方格，bridge 截圖解碼。
- **AI**：bridge 先比對訊息裡的 WoW 術語，再交給本機的 AI CLI 產生說明和回覆建議：
  [Claude Code](https://claude.com/claude-code)（`claude -p`，預設）或
  [OpenAI Codex](https://github.com/openai/codex)（`codex exec`）。見 [AI 後端](#ai-後端)。
- **送回**：bridge 把答案寫進 200 個預先建立的「隨需求載入」addon 檔，遊戲幾秒後載入其中
  一個。不需要 `/reload`。

不注入程式碼、不讀遊戲記憶體、不模擬按鍵。技術細節：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 需求

- 跑遊戲的那台 **Windows 10/11** 電腦（bridge 的截圖只支援 Windows）。
- **WoW: Forever**（測試過 1.60.1.69977–70205），**視窗**或**全螢幕（視窗模式）／無邊框**。
  獨佔全螢幕會擋住截圖。
- **[Node.js](https://nodejs.org) 22.2 以上**（24 LTS 可以）。
- **一個 AI CLI，已安裝並登入**（兩者擇一，安裝器會幫你裝）：
  - **[Claude Code](https://claude.com/claude-code)**（預設），用 Claude 帳號登入
    （`claude auth status` 顯示 `loggedIn: true`）。用量算在你的 Claude 方案裡。
  - **或 [OpenAI Codex](https://github.com/openai/codex)**（`npm install -g @openai/codex`），
    用 `codex login` 登入（`codex login status` 顯示 `Logged in`）。測試版本為 codex-cli 0.154.0，
    較舊的版本會顯示警告。用量算在你的 ChatGPT 方案裡。
- **不需要** Git：安裝器直接下載 zip。（開發者可以自己 clone。）

## 安裝

**在跑遊戲的 Windows 電腦上，開 PowerShell 貼這一行：**

```powershell
irm https://raw.githubusercontent.com/tsesc/wow-ai-chat-helper/main/install.ps1 | iex
```

它會自動裝 Node.js 與 Claude Code（已經有就跳過）、第一次會開瀏覽器讓你登入 Claude 帳號
（你的 Claude 訂閱就是這樣接上的，不用 API key）、把本專案下載到 `%LOCALAPPDATA%\WoWChatHelper`、
把 addon 裝進 WoW，最後在桌面放一個 **WoW Chat Helper** 捷徑用來啟動 bridge。要更新就再貼一次同一行。
完整逐步說明：[docs/INSTALL-WINDOWS.md](docs/INSTALL-WINDOWS.md)。

**想用 OpenAI Codex？** 改貼這一行；它會改裝 Codex（`npm install -g @openai/codex`）並跑
`codex login`，取代 Claude 的步驟：

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/tsesc/wow-ai-chat-helper/main/install.ps1))) -Agent codex
```

之後重跑安裝器沒帶 `-Agent` 時，會沿用 `bridge\config.json` 裡已設定的 agent。

**習慣用 AI 助手？** 在跑遊戲的 PC 上開 Claude Code（Codex、Gemini CLI、Copilot 也行），貼這句：

```text
Install WoW Chat Helper from https://github.com/tsesc/wow-ai-chat-helper on this Windows PC, following the repo's AGENTS.md.
```

[AGENTS.md](AGENTS.md) 會告訴助手怎麼安裝、驗證、更新、移除；除了登入 Claude（或 Codex）以外不會問你別的。

<details>
<summary>手動安裝（有 Git 的人、開發者）</summary>

```powershell
# 1. 工具（已經有的可以跳過）
winget install OpenJS.NodeJS.LTS
irm https://claude.ai/install.ps1 | iex      # Claude Code
claude auth login                            # 在瀏覽器登入一次
# ……或改用 Codex：npm install -g @openai/codex ; codex login

# 2. 本專案
git clone https://github.com/tsesc/wow-ai-chat-helper
cd wow-ai-chat-helper
node setup.js                                # 或：node setup.js --wow "G:\...\World of Warcraft\_classic_beta_"
                                             # Codex：node setup.js --agent codex
```

`setup.js` 會在 Battle.net 資料夾底下找 Forever client（`_forever_` 或 beta 期間的
`_classic_beta_`；找不到就用 `--wow` 指定），然後：

- 把 addon 複製到 `Interface\AddOns\WoWChatHelper`，加上 9 個語系的術語 addon；
- 建立 200 個 slot addon（`WoWChatHelper_S001`…`S200`）和約 2,800 個很小的訊號 `.wav`。
  檔案多是正常的：遊戲只會在啟動時偵測 addon 檔案，所以要先建好；
- 寫入 `bridge\config.json`，並列出 Claude Code 與 Codex 各自有沒有安裝、有沒有登入
  （`--agent claude|codex` 決定 bridge 用哪一個）。

接著：

3. **完全關掉 WoW 再重開**（`/reload` 不夠）。
4. 在角色選擇畫面點 **插件**，確認 **WoW Chat Helper** 有勾。「slot ###」和「Glossary」
   保持原樣就好，它們會在需要時才載入（顯示「僅能隨需求載入」是正常的）。
5. **啟動 bridge**，玩的時候視窗不要關：
   ```powershell
   npm start                      # 在專案資料夾
   # 或雙擊 bridge\start-window.cmd
   ```
   開頭會顯示 WoW 資料夾、agent、術語數量、語言和 `Claude Code : login ok`（或
   `Codex : login ok`）。當掉會自動重啟。
6. 進遊戲打 `/wch`，addon 和 bridge 連上後燈號會變**綠色**。

**更新**：`git pull`，再跑一次 `node setup.js`，重啟 bridge。如果更新加了新的 addon 檔案
（版本說明會寫），要完全重開 WoW；否則 `/reload` 就好。

</details>

## 遊戲內使用方式

**密語、隊伍、團隊、公會的訊息會自動解釋**，幾秒後在訊息下方出現：

```
[Bob] 悄悄地說：LF1M tank HC DM, inv
[譯] 徵 1 名坦克打 Hardcore 厄運之槌，有意者密他邀請  [回覆] [詳細]
     LF1M=還缺一人 · HC=Hardcore · DM=厄運之槌
```

- **`[回覆]`**：跳出小視窗，列出 2–3 句英文回覆（口語、禮貌、簡短），每句下面有中文意思。
  點一句就填進聊天框，對象或頻道都設好了。可以再改，最後按 Enter 送出。
- **`[詳細]`**：交給較大的模型（Sonnet）分析對方語氣、發生什麼事、可以怎麼回。稍慢一點。
- **`[重試]`**：請求失敗時出現。

**交易、綜合、尋求組隊等公共頻道**訊息很多，不會自動解釋。每一行後面會有小小的
**`[?]`**，點了才解釋那一句。

**翻譯你自己想說的話**：在要回覆的頻道打 `/wtr` 加上中文。例如聊天框在「隊伍」時：

```
/wtr 我去拿一下藥水，馬上回來
```

會跳出 `brb grabbing pots` / `one sec, getting pots` / … 點一句，它會填進同一個頻道
（如果 2 分鐘內有人密你，就是回給那個人），按 Enter 送出。

**術語表**：`/wch g` 打開，`/wch g ah` 搜尋。內建的詞標「內建」，AI 解釋過的詞標「AI」，
會記住。

很短又很常見的訊息（`ty`、`gg`、`omw`、`inv pls`…）直接用內建常用語離線解釋，不問 AI，
會標成 `[譯·離線]`。

## 指令一覽

| 指令 | 作用 |
|---|---|
| `/wch` | 開關狀態視窗：bridge 燈號、剩餘 slot、等待中的請求、各頻道開關 |
| `/wch status` | 在聊天框印出同樣資訊 |
| `/wtr <文字>` | 把你的文字翻成英文候選句。等同 `/wch tr <文字>`。`/tr` 只在沒被遊戲或其他插件佔用時可用（繁中 client 已被佔用） |
| `/wch g [關鍵字]` | 術語表，可帶關鍵字搜尋 |
| `/wch lang <代碼>` | 說明和介面的語言：`zhTW zhCN koKR deDE frFR esES ptBR ruRU itIT`；`auto` 跟隨 client；不帶參數列出全部 |
| `/wch auto <whisper\|party\|raid\|guild> on\|off` | 各類頻道的自動解釋開關 |
| `/wch font on\|off\|auto` | 聊天框改用內建字型（client 字型缺你的語言的字時才需要） |
| `/wch corner TOPLEFT\|TOPRIGHT` | 像素條的位置，要和 `bridge/config.json` 的 `capture.corner` 一樣 |
| `/wch hello` | 重新連線 bridge |
| `/wch help` | 列出指令 |
| `/chathelper` | 同 `/wch` |

## 語言

說明、回覆的中文對照、術語表和 addon 介面支援：**繁體中文（zhTW）**、**簡體中文
（zhCN）**、**韓文（koKR）**、**德文（deDE）**、**法文（frFR）**、**西班牙文（esES，
esMX 也用這個）**、**巴西葡萄牙文（ptBR）**、**俄文（ruRU）**、**義大利文（itIT）**。
預設跟隨你的 client 語系，可以用 `/wch lang <代碼>` 換。不管選哪個語言，英文回覆一律
是美服口吻。

> 目前只有繁中內容經過母語者確認，其他語言都是 AI 翻譯。歡迎指正：術語在
> `data/glossary/terms.json`／`phrases.json`（改完跑 `node tools/build-glossary.js`），
> 介面文字在 `addon/WoWChatHelper/Locales.lua`。

字型：附帶繁中、簡中、韓文的 Noto Sans 精簡字型（SIL Open Font License）。只有在 client
本身的字型顯示不了你選的語言時，聊天框才會使用（可用 `/wch font` 手動切換）。

## 設定

`bridge/config.json` 由 `setup.js` 產生（範本：`bridge/config.example.json`）。比較可能
需要改的：

| 項目 | 預設 | 說明 |
|---|---|---|
| `wowPath` | setup 自動找 | Forever client 資料夾（beta 期間是 `...\_classic_beta_`） |
| `agent` | `claude` | 用哪個 AI CLI：`claude` 或 `codex`（見 [AI 後端](#ai-後端)） |
| `claudePath` / `codexPath` | `""` | 找不到 `claude.exe` / `codex.exe`（或 npm 的 `codex.cmd`）時填完整路徑 |
| `models.explain` / `translate` / `detail` | （不設） | 所選 agent 的模型 id，依請求種類。不設 = 該 agent 的預設：Claude 是 `haiku` / `haiku` / `sonnet`；Codex 用它自己的預設模型 |
| `capture.corner` | `TOPLEFT` | 要和遊戲內 `/wch corner` 一致 |
| `capture.processName` | `WowB` | 遊戲的程序名稱 |
| `batchWindowMs` | `400` | 這段時間內到達的訊息會合併成一次送給 AI |
| `persistent` | `true` | 僅 Claude：常駐一個 Claude 程序（較快），而不是每次重開 |
| `maxThinkingTokens` | `0` | 關閉 Haiku 的延伸思考；不關的話每次要 24–80 秒，關了 2–4 秒 |
| `timeoutMs` | `60000` | 單一請求逾時 |

改完要重啟 bridge。

### AI 後端

bridge 透過你已登入的 CLI 呼叫模型，不會跟你要 API key。

| `agent` | CLI | 登入 | 說明 |
|---|---|---|---|
| `claude`（預設） | [Claude Code](https://claude.com/claude-code) | `claude auth login` | 常駐一個 Claude 程序，回應幾秒內。聊天用 Haiku，「詳細」用 Sonnet。 |
| `codex` | [OpenAI Codex](https://github.com/openai/codex) | `codex login` | 每次回答都是一次新的 `codex exec`（約 7–15 秒），唯讀、關閉 Codex 的工具。沒設 `models` 時用 Codex 預設模型。 |

切換方式：`node setup.js --agent codex`（或直接改 `bridge\config.json` 的 `"agent"`），再重啟
bridge。用 setup.js 切換會清掉 `models`，因為模型 id 只對原本的 agent 有意義。想接其他模型或
CLI？provider 是 `bridge/providers/` 裡的小外掛，介面、用假 CLI 寫測試的方法和檢查清單見
[docs/PROVIDERS.md](docs/PROVIDERS.md)（英文）。

## 疑難排解

| 症狀 | 解法 |
|---|---|
| 燈號一直紅／黃，bridge 視窗沒動靜 | 插件清單裡 **WoW Chat Helper** 有勾嗎？bridge 有在跑嗎？打 `/wch hello`。 |
| 左上角從來沒出現彩色格子 | addon 沒載入（檢查插件清單後 `/reload`）。`/dump WCH ~= nil` 應該印出 `true`。 |
| bridge 顯示 `strip seen but rejected` | 左上角被其他視窗或覆蓋層擋住，或開了 HDR／色彩濾鏡。用視窗或無邊框模式、關 HDR，左上角最邊緣保持空著。 |
| `/tr` 沒反應 | 你的 client 已經佔用 `/tr`，改用 `/wtr`。 |
| 回覆跑到「說」而不是隊伍 | 更新到最新版，回覆會沿用聊天框目前的頻道。 |
| 「slot 快用完」提示 | 每個答案用掉一個 slot，每次登入 200 個。方便時打 `/reload` 重置。 |
| 中文／韓文變方塊 | `/wch font on`。 |
| bridge 視窗顯示 `!! Claude Code CLI is not logged in` | 在那台電腦執行一次 `claude auth login`。 |
| bridge 視窗顯示 `!! Codex CLI is not logged in`，或答案顯示 `codex not logged in` | 在那台電腦執行一次 `codex login`（`codex login status` 要顯示 `Logged in`）。 |
| bridge 顯示 `config.json "agent": unknown agent` 後停止 | `"agent"` 只能是 `claude` 或 `codex`。 |
| 回應要 20 秒以上 | 確認 `bridge/config.json` 的 `maxThinkingTokens` 是 `0`。 |

bridge 會把所有動作印在它的視窗裡；回報問題時請附上最後 30 行。

## 隱私、費用與遊戲規範

- **哪些資料會離開你的電腦**：被解釋的那幾則聊天（發話者名稱、頻道，以及同一段對話的前
  4 句作為上下文），以及你要翻譯的句子，會透過 Claude Code 送到 Anthropic，適用你 Claude
  帳號的條款（`agent` 是 `codex` 時則透過 Codex 送到 OpenAI）。沒有被解釋的訊息不會送出，遊戲的其他內容也不會被讀取。
- **費用**：透過 Claude Code 使用你 Claude 方案的額度（或透過 Codex 使用 ChatGPT 方案的
  額度），沒有額外帳單。用 Claude 時幾乎都用 Haiku，負擔很輕。
- **遊戲規範**：addon 只用 Blizzard 公開的 addon API。bridge 只讀畫面一小角、寫一般檔案，
  不讀遊戲記憶體、不注入、不模擬按鍵，**也絕不替你發話**。但它仍是 Blizzard 沒有背書的
  第三方工具，請自行依 Blizzard 使用條款評估風險。

## 上架到 CurseForge／Wago

CurseForge App、WowUp、Wago App 這類 addon 管理器**只會安裝 addon 資料夾**。bridge
不能透過它們發布（addon 壓縮檔裡不能放執行檔或配套程式），所以使用者一定還要照
[安裝](#安裝)第 2 步從 GitHub 裝 bridge，而且 addon 頁面最上方要寫清楚。其他有桌面
配套程式的 addon 也是這樣做（例如 Offhand：addon 上 CurseForge，配套程式放 GitHub Releases）。

各平台現況（2026-10-06 查證）：

| 平台 | WoW: Forever | 備註 |
|---|---|---|
| CurseForge | 有獨立的 Forever 遊戲版本 | 依 TOC 的 `## Interface: 16001` 判定；只收 .zip；壓縮檔內不能有外部下載連結 |
| Wago Addons | 有（「Classic Forever 1.60.1」，代號 `forever`） | 開發者協議：.zip、不能有 .exe |
| WoWInterface | 未確認 | 確認支援 Forever 前先跳過 |

**壓縮檔內容**：`WoWChatHelper`（含 `sig\`、`Fonts\`）、9 個 `WoWChatHelper_Glossary_*`、
200 個 `WoWChatHelper_S###`，全部放在最上層。slot 和訊號檔目前是 `setup.js` 在使用者電腦上
產生的，所以打包前要先有一個產生它們的步驟。用管理器裝好 addon 後，使用者一樣要跑
`node setup.js` 設定 bridge，它會略過已存在的檔案。

本 repo **還沒設定好打包流程**，以下是要做的步驟：

1. 在 [CurseForge](https://authors.curseforge.com) 和 [Wago](https://addons.wago.io)
   建立專案（遊戲 World of Warcraft，版本 Forever）。說明最上方寫「**需要另外安裝配套
   的 bridge**，請從 GitHub 安裝」並附本 README 連結。記下專案 ID。
2. 在 `addon/WoWChatHelper/WoWChatHelper.toc` 加上 `## X-Curse-Project-ID: <id>` 和
   `## X-Wago-ID: <id>`。
3. 建立 API token（CurseForge：*My API Tokens*；Wago：*Developer* 設定），存成 GitHub
   repo secrets：`CF_API_KEY`、`WAGO_API_TOKEN`。
4. 加上打包檔案（[BigWigsMods/packager](https://github.com/BigWigsMods/packager)，
   以 `-g forever` 指定 Forever）：`.pkgmeta`，以及先產生 slot／訊號檔再執行 packager 的
   release workflow。完整範例：[docs/PUBLISHING.md](docs/PUBLISHING.md)。
5. 推送 tag（例如 `v0.2.0`），workflow 會打包、上傳到 CurseForge 和 Wago，並建立 GitHub
   Release。
6. 第一次請標成 **alpha**：審核人員可能會詢問配套程式，而且約 3,000 個檔案、210 個資料夾
   的規模在這些網站上還沒試過。

## 開發

```bash
npm ci
npm test                         # 230 個測試：在模擬 WoW API 的 Lua VM 跑 addon、
                                 # 用假的 claude 測 bridge、端到端往返
node tools/build-glossary.js     # 由 data/ 重新產生各語系術語 addon
node tests/live/eval_glossary_style.js   # 選用：用真的 claude CLI 做品質評估
```

目錄：`addon/`（WoW addon）、`bridge/`（Node.js bridge、`capture.ps1`）、`data/glossary/`
（術語主資料）、`tools/`（術語與字型產生器）、`tests/`、`docs/`（規格、架構、研究與評估
結果）。設計規格：
[docs/superpowers/specs/2026-10-05-wow-ai-chat-helper-design.md](docs/superpowers/specs/2026-10-05-wow-ai-chat-helper-design.md)。
CI 會在 Ubuntu 和 Windows 上跑測試。

## 已知限制

- **準確度**：最近一次實測（三種語言共 80 句，由另一個模型評分），意思正確約 88%，
  回覆自然度 3.4／5。覺得怪怪的時候用 `[詳細]`。
- **速度**：一批訊息約 3–13 秒回來。
- **翻譯**：繁中以外都是 AI 翻譯、未經校對，德文最弱。
- **熱鬧的頻道**：長時間遊玩可能用完 200 個 slot（`/reload` 重置）。
- **團隊首領戰和傳奇+**：遊戲在這些場合會對 addon 隱藏聊天內容，這些訊息會被略過。
- **一次只能跑一個 bridge**：不要和 wow-ai 的 bridge 同時跑，兩者用同一個畫面角落。
- 目前只支援 Windows。

## 致謝與授權

傳輸設計和部分程式碼來自 chelinho139 的 [**wow-ai**](https://github.com/chelinho139/wow-ai)
（MIT），它證明了沙盒中的 WoW: Forever addon 可以和本機程式雙向溝通。它所依賴的「首次
載入時讀取檔案」行為由 [wow-forever-codex](https://github.com/0xinuarashi/wow-forever-codex)
實測發現。字型：Noto Sans TC／SC／KR 精簡版，SIL Open Font License。詳見
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

MIT 授權。
