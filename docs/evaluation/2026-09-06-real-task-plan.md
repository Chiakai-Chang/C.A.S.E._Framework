# 真實採用資訊任務：事前比較設計

本設計在模型請求前寫入。依使用者授權，比較一般 pi 原生工具和目前 CASE；不更動模型服務、全域 pi 設定或產品程式。

任務是將真實 CASE 公開來源整理成 `adoption-map.json`，讓維護者可核對安裝位置、套件入口、支援與實測差異及維護命令。四份來源已複製至 `workflow-kit/evaluation/real-task-sources/`：當時的 `workflow-kit/install.mjs`、`workflow-kit/package.json`、`workflow-kit/docs/HOSTS.md`、`docs/MAINTENANCE.md`。凍結時間早於本輪首頁與發布收尾；歷史狀態不得被後來修改替換。完整任務及人工依來源逐欄核對的答案在 `real-task-spec.mjs`。模型只收到四份來源及相同任務，答案與評分器不放入工作目錄。

驗收預先固定：輸出必須是合法 JSON；四個物件及全部欄位與凍結來源一致，額外／缺漏／錯誤欄位皆失敗；陣列按字串升序、物件 key 順序不限；四份來源 hash 必須不變。以整體通過與各物件差異列出結果，不用摘要文字代替成果。評分器有錯誤支援宣稱、欄位缺漏／額外／壞 JSON、來源改動的反例測試。評分只在各組結束後執行，不注入正解或評分回饋。

固定執行順序一般 pi、CASE，各一次，不因結果追加抽樣。兩組各用獨立暫存專案與 pi 設定目錄、相同來源、goal、模型、medium thinking、宣告 contextWindow 32768、maxTokens 4096、每 session 上限 16 turns、每組總時間上限 600 秒。CASE 沿用既有 `createPiSessionRunner` / `runCase`，maxAttempts 5，不預先提供人工工作包。一般 pi 使用 pi SDK 的預設原生 `read/bash/edit/write`，原生 system prompt；各自禁用外部 extensions/skills/templates/themes，以免個人設定混入。兩組開啟 pi compaction、關閉 SDK 自動 retry，無人工接續或答案修正。

原生工具具任意 shell／較廣檔案權限，工作目錄隔離不是 OS sandbox；提示限制只處理公開副本，不構成權限保障。CASE 是既有路徑限定工具，沒有任意 shell。這是兩種實際工具／流程組合比較，不能把差異純歸因於分工。CASE 的角色、結構回覆修正與多 session 成本屬受測流程。原生 pi 是乾淨 SDK session 的原生工具循環，並非互動 TUI 使用者研究。

保存來源及執行程式 SHA-256、模型 inventory 與服務 props、每次模型請求的工具清單／sampling／訊息字元數（不是 token context）、session 原始最終文字、完整工具 args/results、SDK token／成本回報、開始與結束時間、失敗／取消及最終狀態。SDK 回報零金額只代表本機 provider 的零費率設定，不代表能源免費；未回報 token、peak context、GPU 記憶體與能源用 null/unknown。人工準備由本代理完成；模型執行期間人工介入次數固定紀錄，準備成本未分臂計時，不能當作零。

這只有一個真實資訊整理任務、一組配對。不能推論一般程式實作、長 context、長期可靠度或所有模型效果，也不以成功替代安裝與 loader 驗證。若兩組品質相同而 CASE 較慢，直接呈現額外成本；不補增角色來改善說法。
