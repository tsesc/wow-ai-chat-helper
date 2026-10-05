# Spike 檢查清單（Windows 上的 WoW: Forever）

這是 phase 0 的實機驗證：在你的 Windows 電腦上跑一個很小的診斷 addon `WCHSpike`，
把結果貼回來給我們，我們才能決定中文字型要用內建字型還是自帶字型、IME 能不能用、
各種 API 在 Forever client 上是否存在。全程約 5 分鐘，不需要 Node、不需要 Claude。

## 事前準備

- 你需要這個 repo 的內容（`git clone` 或直接下載 zip 都可以），裡面有：
  - `spike\WCHSpike\`（診斷 addon）
  - `addon\WoWChatHelper\Fonts\WCH-CJK.ttf`（自帶的中文字型子集）
- WoW 的 AddOns 資料夾通常在
  `C:\Program Files (x86)\World of Warcraft\_retail_\Interface\AddOns\`
  （Forever 的路徑可能不同，請用你實際安裝的位置，下面稱為 `<AddOns>`）。

## 步驟

1. 把整個 `spike\WCHSpike\` 資料夾複製到 `<AddOns>\WCHSpike\`。
   複製完應該有 `<AddOns>\WCHSpike\WCHSpike.toc` 和 `WCHSpike.lua`。
2. 把 `addon\WoWChatHelper\Fonts\WCH-CJK.ttf` 複製到 `<AddOns>\WCHSpike\WCH-CJK.ttf`
   （檔名要一模一樣，放在 `WCHSpike` 資料夾裡面）。
3. **完全關閉並重新啟動 WoW**（字型檔和新 addon 只有在 client 啟動時才會被發現，
   光是 `/reload` 不夠）。
4. 在角色選擇畫面按左下角「AddOns」，確認 `WCH Spike` 已勾選
   （若顯示「版本過期」，勾選「載入過期的 AddOns」）。進入遊戲。
5. 聊天框會出現一行 `WCHSpike loaded.`。輸入 `/wchspike`。
   會跳出一個診斷視窗（可拖曳，Esc 關閉），同時聊天框會印出測試文字和報告。

## 每一項要看什麼

### 1. 中文字型（視窗最上方的列表）

視窗裡有 7 列，每列都寫著 `中文測試 繁體`，各用不同字型：

- `default font`（預設字型）
- `ARHei.ttf`、`ARKai_T.ttf`、`bHEI00M.ttf`、`bLEI00D.ttf`、`blei00d.TTF`
- `bundled WCH-CJK.ttf`（自帶字型）

請**用眼睛**看每一列：能看到正確的中文字，還是方框 □ / 問號 ? / 空白？
另外看聊天框裡那行 `WCHSpike CJK test (default chat font): 中文測試 繁體`，
預設聊天字型能不能顯示中文。

### 2. 輸入法（IME）

- 點視窗中間那個藍灰色輸入框，切換到 Windows 注音／拼音輸入法，打幾個中文字。
  能不能打出來？選字視窗有沒有出現？字有沒有顯示正確？
- 再按 Enter 開啟**一般聊天輸入框**（不要送出），同樣試著打中文，記下能不能。
  按 Esc 取消。
- 打完字後，報告裡的 `ime editbox` 那行會更新成 `typed N bytes`，表示輸入框確實收到字。

### 3. API 是否存在

報告裡每個 API 一行：`OK` 代表存在、`MISS` 代表沒有。這項不用你判斷，貼報告即可。

### 4. 超連結點擊

- 聊天框會印出 `WCHSpike: [wchspike link]  <- click me`，用滑鼠左鍵點那個藍色連結。
- 也可以按視窗裡的「print test link to chat」按鈕再印一次。
- 成功的話聊天框會多一行 `WCHSpike: link click #1 via ...`，報告裡 `link click`
  那行也會變成 `OK`。如果點了完全沒反應（或跳出錯誤），請回報。

## 要貼回來的內容

1. **報告**：視窗最下方的大文字框（`4. Report`）。點一下文字框，按 `Ctrl+A`
   全選、`Ctrl+C` 複製，貼到訊息裡。請在**做完上面的點擊與輸入之後**再複製，
   這樣 `link click`、`ime editbox` 兩行才是最新的。
2. **你用眼睛看到的結果**（報告無法自動判斷），照這個格式填：

```
字型（OK=顯示中文 / BOX=方框或問號）
default chat font: 
default font row : 
ARHei.ttf        : 
ARKai_T.ttf      : 
bHEI00M.ttf      : 
bLEI00D.ttf      : 
blei00d.TTF      : 
bundled WCH-CJK  : 
IME（視窗輸入框能打中文？）: 
IME（一般聊天輸入框能打中文？）: 
超連結點擊有反應？: 
其他異常（錯誤彈窗、版本過期等）: 
```

3. 遊戲版本（報告開頭那行 `wchspike build=...` 已包含，不用另外查）。

## 常見問題

- `/wchspike` 沒反應：addon 沒載入。確認資料夾是 `<AddOns>\WCHSpike\WCHSpike.toc`
  （不要多包一層資料夾），並在 AddOns 清單中勾選。
- 報告裡有 `ERR ...` 行：不用處理，直接貼回來，這正是我們要的資訊。
- 測完之後可以刪掉 `<AddOns>\WCHSpike\`，它只是一次性的診斷工具。
