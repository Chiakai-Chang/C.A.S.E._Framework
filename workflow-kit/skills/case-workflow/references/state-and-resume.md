# 狀態與跨 session 接續

`<cli>` 是實際載入技能目錄下的 `scripts/case.mjs`，`<project>` 是工作專案，`<id>` 取自 `new` 回傳。以下各列放在 `node "<cli>"` 後，再加 `--project "<project>"`；命令必須在選項之前，例如 `node "<cli>" context --task "<id>" --project "<project>"`。

| 命令尾端 | 意義 |
|---|---|
| `init` | 建立 `.case-agent/workflow.json`；遇舊 M0／外來 namespace 拒絕，不覆蓋 |
| `new --title "..." --goal "..." --criterion "..." [--criterion "..."] [--constraint "..."]` | 建立有穩定 ID 的任務；至少一項驗收 |
| `list` | 尋找任務；不要依猜測選 ID |
| `show --task "<id>"` | 查看完整當前任務與最近 30 筆事件；不是永久完整歷史 |
| `context --task "<id>"` | 輸出有界 Markdown 接續內容，省略歷史 |
| `checkpoint --task "<id>" --summary "..." --next "..." [--status active或blocked]` | 更新當前狀態與下一步 |
| `record --task "<id>" --criterion 1 --result pass或fail --evidence "..."` | 保存第 1 項驗收的觀察；編號從 1 起 |
| `handoff --task "<id>" --to "..." --summary "..." --next "..."` | 記錄接手者與接續點；不發送消息、不建立 agent |
| `finish --task "<id>" --summary "..."` | 全部驗收通過後完成 |
| `reopen --task "<id>" --reason "..."` | 重新開啟已完成任務；全部驗收回到 pending，需重新記錄 |
| `doctor` | 檢查 workflow 狀態結構；不驗證產物正確性 |

表中的「或」是說明：實際參數選 `active` / `blocked`、`pass` / `fail` 之一。除 `context`／help 外輸出為 JSON；先查看 `ok` 與 `code`，失敗不能繼續當成寫入成功。完成任務須先 reopen 才能再修改。每個文字欄位最多 2,000 字元，驗收與約束各最多 20 項；`context` 每欄最多 240 字元並標示截斷。

事件只保留最近 30 筆。重要原始觀察與失敗放在專案既有證據檔或版本紀錄，再由任務引用；不要依賴事件列表作永久稽核。reopen 前若需保留當次完整驗收快照，先保存 `show` 輸出到不衝突且適合存放的證據檔。

## 寫可接續的摘要

摘要只保存新 session 需要的決策與事實，例如：「CSV 匯出已改用引號包覆；測試 tests/export.test.js 通過。尚未驗證空資料；不能改現有欄位順序。」下一步寫可執行動作，例如：「讀 tests/export.test.js，新增空資料案例並執行該檔。」避免「繼續處理」「全部沒問題」。

必要約束若無法一次讀完，不再大量擴寫摘要；讓下一位按需取得完整 `show` 或被引用的規格。引用的檔案需實際存在，說明其用途；尚未執行的命令寫成下一步，不能列為通過證據。

在 context 接近上限、宿主即將 compact、交接或自然里程碑時保存 checkpoint。無新資訊不重寫。不要把任意固定字數當成實際 token 數，也不承諾自動節省成本。

## 新 session 的第一輪

1. 確認 project 與 task ID，讀 `context`；缺 ID 時先 `list`。
2. 對照使用者最新指示，確認舊摘要是否已過期。只讀下一步需要的來源；對變動中的檔案、分支與測試結果做必要現況核對。
3. 接續未完成動作，不重新規劃整件事，也不把舊 pass 當作修改後仍然成立。修改影響驗收時更新觀察。
4. 若阻礙需外部行動，保存 blocked 與具體解除條件；一般失敗先在已授權範圍內處理。

`.case-agent` 可能包含專案內部脈絡；是否納入版本控制由專案決定。不要為了共用進度把祕密或未授權資料提交到公開 repository。跨機器接手需要另外傳遞專案與狀態；CLI 不提供同步或同時多寫者保證。
