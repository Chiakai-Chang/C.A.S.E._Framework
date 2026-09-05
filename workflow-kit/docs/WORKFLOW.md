# 從需求到交付：完整工作例

本頁為 v1 `case.mjs` 的人工工作與記錄示例；版本化契約及 pi 新 session 自動流程見 [v2 指南](V2.md)。

這是一個可依循的示例，並非已執行的產品效果實驗。實際安裝入口見 [套件 README](../README.md)。命令使用技能目錄內的 `scripts/case.mjs`；先將下例 `<cli>`、`<project>` 換成實際路徑，`<id>` 換成 `new` 回傳值。Node.js 20+ 即可執行，無需啟動模型或舊 M0 CLI。

## 一般小事

使用者說「把 README 的失效連結改成新網址」，agent 直接修改並核對連結即可。不必建立任務記錄、角色或復盤報告。

## 持續任務：修好 CSV 匯出

使用者需要匯出的 CSV 正確處理逗號、雙引號與換行，維持既有欄位順序，並在 README 提供使用例。agent 根據這個完整需求建立任務，不讓使用者再填一份表。

```sh
node "<cli>" init --project "<project>"
node "<cli>" new --project "<project>" --title "修復 CSV 匯出" --goal "使用者可匯出包含特殊字元的 CSV，並從 README 學會使用" --criterion "逗號、雙引號、換行、空資料均有通過的匯出測試" --criterion "保持既有欄位順序與公開介面" --criterion "README 有與實作一致的可執行使用例" --constraint "不新增 runtime 依賴"
```

agent 讀匯出程式與相關測試，修正必要行為。若空資料測試失敗，先保留觀察，再修正；不是把第一項標準刪掉。

```sh
node "<cli>" record --project "<project>" --task "<id>" --criterion 1 --result fail --evidence "tests/export.test.js 的空資料案例失敗：預期只有標頭，實際多一行空列"
node "<cli>" checkpoint --project "<project>" --task "<id>" --summary "特殊字元案例已通過；空資料多輸出一行，失敗記在 criterion 1。尚未改 README；不得新增 runtime 依賴" --next "檢查 src/export.js 的空資料分支，修正後重新執行 tests/export.test.js"
```

## Context 接近上限或換 session

完成 checkpoint 後，透過AI 工具既有功能 compact 或開新 session。給下一個 agent 專案路徑、task ID 及技能入口即可；CLI 不會自行開啟 session。

```sh
node "<cli>" context --project "<project>" --task "<id>"
```

下一個 agent 讀精簡接續內容，核對相關檔案現況，再從空資料分支繼續；不重讀所有聊天或重新建立整份計畫。若摘要提示截斷，用 `show` 取得需要的完整內容。若測試工具暫時不可用，保存 blocked 與具體解除條件；不要將未測試當成 pass。

## 確實有用時分工

測試修復與 README 可獨立處理，而且AI 工具提供已授權的 subagent 能力時，協調者自行修程式，交給 worker 撰寫 README。工作包可寫：「只修改 README 的匯出段落；讀 src/export.js 的公開介面；加入一個包含逗號的例子，核對可執行；回報修改位置、實際執行結果與限制；不要修改 .case-agent。」

worker 回報後，協調者核對例子與最終程式是否一致。若 worker 認為應新增依賴，協調者依原約束採用不新增依賴的方法，或有實際必要時說明取捨；不因 worker 建議而擅改任務。沒有 subagent 功能時依序完成，結果同樣可以交付。

若由另一個 agent 接手整個任務，先保存交接，再由AI 工具實際傳遞：

```sh
node "<cli>" handoff --project "<project>" --task "<id>" --to "接續 session 的 agent" --summary "程式已修正；README worker 回報待整合。驗收證據尚未全部更新" --next "核對 README 範例與 src/export.js，再執行受影響測試"
```

## 驗收、完成及重新開啟

下列 pass 命令只能在相對應觀察真的發生後執行；示例文字不是證據。協調者執行測試、核對介面和文件後更新三項驗收，再完成：

```sh
node "<cli>" record --project "<project>" --task "<id>" --criterion 1 --result pass --evidence "node --test tests/export.test.js 通過；涵蓋逗號、雙引號、換行與空資料"
node "<cli>" record --project "<project>" --task "<id>" --criterion 2 --result pass --evidence "既有介面回歸測試通過；核對 src/export.js 的參數與欄位順序無變更"
node "<cli>" record --project "<project>" --task "<id>" --criterion 3 --result pass --evidence "README 匯出範例已在專案環境執行，輸出與文件相符"
node "<cli>" finish --project "<project>" --task "<id>" --summary "CSV 特殊字元與空資料已修復，保留介面並補 README 使用例；三項驗收已有觀察"
```

agent 向使用者提供修改與使用入口、實際驗證及重要限制。CLI 的完成狀態只表示已記錄的驗收齊全，不是獨立證明成果正確，也不代表曾獲使用者核准。

交付後發現換行案例漏了一種輸入，重新開啟原任務並記錄失敗，再修正受影響範圍。reopen 會重置全部驗收；修正後需核對並重新記錄三項，才可再次 finish。重要證據另存來源檔，因 CLI 只保留最近 30 筆事件：

```sh
node "<cli>" reopen --project "<project>" --task "<id>" --reason "使用者提供 CRLF 輸入案例，原測試只有 LF"
node "<cli>" record --project "<project>" --task "<id>" --criterion 1 --result fail --evidence "新增 CRLF 案例重現解析錯誤；待修正"
```

若使用者改為要求 XLSX 匯出，這是新範圍：建立新 task，在摘要引用原 task ID，保留舊任務的結果。此版本沒有靜默改寫目標／驗收的入口。

## 用過後才判斷價值

在自然交付點問：必要約束是否保住、接續是否重做、人是否需要重新解釋、記錄成本是否值得。有可觀察的新收穫才補一句決策；成本不可得寫未知。不建立每週排程，不因用了本流程就宣稱改善品質或節省 tokens。
