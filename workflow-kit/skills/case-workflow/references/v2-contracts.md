# v2 契約與接續

以載入本技能的目錄為 `<skill-dir>`，CLI 是 `scripts/case-v2.mjs`，需 Node.js 20+。核心保存版本與狀態，不自行呼叫模型。pi extension 的 `case_workflow` 工具才會啟動新 session；其他 AI 工具先確認可用的 session 能力，無法建立時明示人工交接，不在原對話換角色便宣稱已隔離。

## 建立與執行

agent 從使用者要求整理契約，不要求使用者填表。短工作直接完成；持續記錄可用 v1；需契約／工作包則用 v2。pi 的工具呼叫範例：

```json
{"operation":"create","contract":{"goal":"整理 CSV 資料並交付可核對的摘要","constraints":[{"id":"c1","text":"保留原始 CSV，不改動來源"}],"acceptance":[{"id":"a1","text":"摘要的筆數與加總可由原始 CSV 核對"}],"budget":{"maxAttempts":3,"maxDurationMs":300000}}}
```

保存回傳 id，再以 `case_workflow` 的 `run`（帶 caseId）或 `/case run <id>` 執行。`/case list`、`/case show <id>` 查詢；`/case stop` 請求停止目前專案的執行，需等待舊工作停止後才接手。先在 pi 選定預期模型，extension 沿用該模型；需要本地工作時確認選的是本地模型，不自行 fallback 雲端。

CLI 使用相同核心：`init --project <project>`、`create --project <project> --data <contract.json>`、`get --project <project> --case <id>`。以 `--help` 核對命令。契約及 action JSON 檔放在一般工作位置，不手改 `.case-agent` 狀態。

## 工作包與核對

`plan` action 帶 `packets`。每包包含 `id,purpose,constraintIds,inputs,dependsOn,writeScope,deliverables,checks,unknowns`；inputs 為 `{path,required}`，deliverables 為 `{path}`，checks 為 `{id,text,criterionIds}`。路徑相對於 project；每項全域驗收須有 check 涵蓋。明示相依包的產物可成為下游輸入，核心在上游 verified 後綁定版本。輸入 SHA256 由核心保存，不讓模型猜值。必要材料缺漏而無法形成有效計畫時，pi planner 回覆 `{blocked:{reason}}` 並填非空的具體原因；runner 保存原因、回報 BLOCKED 且不派 worker，不用空產物包表示阻礙。

包狀態依 `start → submit → review` 更新，`review` 使用不同於 worker 的真實 session ID。submit 保存產物版本但不代表通過；核對者查實際來源與產物，最後 `integrate` 逐項核對全域驗收，不能只憑局部 pass 結案。CLI 的 action 以 `dispatch --case <id> --data <action.json> --revision <目前revision> --request <唯一requestId> --project <project>` 提交；同一 requestId 只用於同一 action 的重送。

pi runner 依序建立 planner、worker、reviewer、integrator session，不把 worker 對話匯入 reviewer。只有 worker 可以透過限定寫入工具改工作包範圍；不是 OS sandbox 或對同權限程序的防竄改。一般 extension 沒有任意 shell，也未設定可執行測試清單；若驗收需執行程式，應由既有授權工具實際核對，或由整合者設定可信 `checks`。模型讀檔後自述通過不能稱作測試已執行。

## 接續、修訂與容量

- 先 `get` 查目前契約、包與 attempt，再以 `context --case <id> --packet <packetId> --project <project>` 組裝當包材料。全部全域限制保留；`--max-chars` 是字元預算，超限報 `CONTEXT_TOO_LARGE`，應縮小包／材料，不截掉必需條件。
- 來源或產物雜湊變更要核對並重驗。`retry` action 帶 `packetId,reason`；重跑已驗證包會使下游失效。pi 工具也有 retry 操作。
- `revise` action 帶新 `contract,reason`；契約修訂保守使全部包與整合失效，須 `plan` 重新對齊，不能用 retry 偷渡舊契約。舊包留在 packetHistory，累計預算不重置。
- 發現 running attempt 時，先確認原程序已停止及部分產物／外部副作用。需要時透過核心 `block`（packetId、reason）保存障礙，再明確 retry；不直接重跑外部副作用。失敗 run 的原始回報保留於 artifacts。
- runner 最多初次加兩次同包修正，重複 findings 或總預算到限會停止。沒有新證據不原樣重試；未知用量保留 unknown／null，不寫成零。

## v1 遷移與保存

讀到 `case-workflow/1` 時 v2 會回報 `MIGRATION_REQUIRED`。只有已明確要求升級才執行 `node "<skill-dir>/scripts/case-v2.mjs" migrate --project "<project>"`。先停止所有寫者；遷移在 `.case-agent` 外建立備份，驗證後才切換 manifest，保留回傳 backupPath。陌生內容、路徑連結或備份失敗應停止處理。

v1 `tasks` 留作 legacy 歷史，不成為 v2 獨立驗收；需要續作時建立新契約並引用舊 ID。遷移後 v1 `case.mjs` 拒絕資料是預期保護。安裝／移除技能不刪資料。v2 權威是 `cases/<UUID>/state.json`，run 記錄在其 `artifacts/`；摘要不是第二份權威。只有協調者寫狀態，殘留鎖須確認舊程序停止後處理，不能只憑時間刪除。
