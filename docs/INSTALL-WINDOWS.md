# Windows 安裝與使用

WoW Chat Helper 分兩部分：遊戲裡的 addon，以及在同一台電腦上跑的 bridge（Node.js）。
bridge 會從畫面角落讀取 addon 傳出的訊息，呼叫本機的 Claude Code，再把結果寫回檔案給 addon 讀。
運作原理見 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 事前準備

- **Node.js 22.2 或以上**：到 <https://nodejs.org> 安裝，之後在 PowerShell 執行
  `node -v` 確認（要 v22.2 以上）。
- **Git**，以及能存取私人 repo 的 GitHub 認證（見下方 clone 步驟）。
- **Claude Code 已安裝並登入**：在 PowerShell 執行 `claude`，確認能正常對話；
  若尚未登入，照畫面指示登入你的訂閱帳號。bridge 使用的是同一個登入。
- **遊戲要用「視窗」或「無邊框視窗」模式**（設定 → 系統 → 圖形）。
  獨佔全螢幕會讓螢幕擷取失敗。
- 建議先完成 [SPIKE-CHECKLIST.md](SPIKE-CHECKLIST.md)，確認字型與輸入法沒問題。

## 安裝步驟

1. 取得程式碼（這是私人 repo）：
   ```powershell
   gh auth login        # 若已安裝 GitHub CLI；依指示登入一次
   git clone https://github.com/tsesc/wow-ai-chat-helper.git
   cd wow-ai-chat-helper
   ```
   沒有 `gh` 的話，可以建立一個有 repo 讀取權限的 personal access token，
   clone 時帳號填 GitHub 帳號、密碼填 token。
2. 安裝 addon 到遊戲（會自動尋找 WoW 資料夾）：
   ```powershell
   node setup.js
   ```
   找不到的話手動指定路徑：
   ```powershell
   node setup.js --wow "C:\Program Files (x86)\World of Warcraft\_retail_"
   ```
   這會安裝 `WoWChatHelper` addon、200 個資料槽 addon（`WoWChatHelper_S001`..`S200`）
   和訊號檔案。bridge 不需要 `npm install`（沒有執行期套件）。
3. **完全關閉並重新啟動 WoW**。新增的資料槽、訊號檔案和字型只有在 client 啟動時才會被發現，
   `/reload` 不夠。
4. 在角色選擇畫面按「AddOns」，勾選 `WoW Chat Helper`（`WoWChatHelper_S001`..`S200` 是按需載入的資料槽，
   不需要手動勾選）。進入遊戲。
5. 在 repo 資料夾開一個 PowerShell 視窗執行：
   ```powershell
   npm start
   ```
   保持這個視窗開著（它會自動重啟 bridge）。遊戲視窗不要被其他視窗遮住畫面左上角。

## 第一次使用

1. 進遊戲後輸入 `/wch`：會出現狀態視窗。燈號綠色代表 bridge 已連上；
   黃色或紅色代表 bridge 沒在跑或還沒連上（等幾秒，或檢查 `npm start` 視窗）。
2. 請朋友（或另一個帳號）密你一句英文，例如 `LF1M tank HC DM, inv`。
   幾秒內聊天框會多出：
   - `[譯] 徵 1 名坦克…  [回覆] [詳細]`
   - 一行詞彙解釋 `LF1M=還缺一人 · HC=英雄難度`
3. 點 `[回覆]`：會開啟候選視窗，列出 2–3 句英文回覆（含中文說明與語氣）。
   **點其中一句**，它會被放進聊天輸入框並設好對象（例如 `/w 對方名字`）。
   你自己按 Enter 才會送出，addon 絕不會自動送出訊息。
4. 想把中文翻成英文：`/wtr 我五分鐘後到`（`/tr` 沒被遊戲或其他插件佔用時也可以；被佔用時登入會提示）。結果同樣打開候選視窗。
   預設對象是最近 2 分鐘內密你的人，否則是你目前輸入框的頻道。
5. 點 `[詳細]` 會請 Sonnet 分析語氣、情境與建議，結果印在聊天框。
6. 交易、綜合等頻道不會自動翻譯；每行訊息後面有一個 `[?]`，點它就會翻譯那一行。
7. 詞彙表：`/wch g` 開啟，在搜尋框輸入就會過濾；也可以 `/wch g tank` 直接搜尋。

## 疑難排解

**狀態燈一直是紅色／strip 沒被解碼**
- 確認 `npm start` 視窗在跑、沒有錯誤。
- 遊戲必須是視窗或無邊框視窗，且畫面左上角沒被其他視窗遮住。
- 遊戲裡執行 `/wch corner` 查看 strip 角落設定（`/wch corner TOPRIGHT` 改到右上角）；
  bridge 的 `config.json` 裡 `capture.corner` 必須相同。
- 螢幕縮放（DPI）或 HDR 可能影響擷取；先把遊戲 UI 縮放維持預設。

**資料槽用完（slots exhausted）**
- 每個遊戲 UI session 只有 200 個資料槽，剩 20 個時聊天框會警告。
  用完後 addon 會停止輪詢，並提示你輸入 `/reload`（會重設資料槽）。
  addon 不會自己 reload，請在方便的時候手動 `/reload`。

**中文顯示成方框**
- 先確認 `/wch` 狀態視窗裡「聊天框 CJK 字型」開關是開的。
- 還是不行就照 [SPIKE-CHECKLIST.md](SPIKE-CHECKLIST.md) 跑一次字型檢查，把結果回報；
  同時確認你完整重啟過 WoW（只 `/reload` 不會載入新字型檔）。

**Claude 沒回應或回錯誤**
- 在 PowerShell 手動執行 `claude -p "hi"`，確認已登入且可用。
- bridge 視窗會顯示 Claude CLI 找不到或未登入的訊息；聊天框會出現
  `[譯] 失敗 (...) [重試]`，點 `[重試]` 即可。

**不要和 wow-ai 同時執行**
- 本專案與 [wow-ai](https://github.com/chelinho139/wow-ai) 的 addon 名稱和 strip 標記不同，
  可以同時安裝，但**兩個 bridge 不能同時跑**：它們會爭用同一個螢幕角落。
  使用本專案時請先關掉 wow-ai 的 bridge。

## 更新

```powershell
git pull
node setup.js
```
然後完全重啟 WoW。
