# v2 契約與接續

以載入本技能的目錄為 `<skill-dir>`，CLI 是 `scripts/case-v2.mjs`，需 Node.js 20+。核心保存版本與狀態，不自行呼叫模型。pi extension 的 `case_workflow` 工具才會啟動新 session；其他 AI 工具先確認可用的 session 能力，無法建立時明示人工交接，不在原對話換角色便宣稱已隔離。

## 建立與執行

agent 從使用者要求整理契約，不要求使用者填表。短工作直接完成；持續記錄可用 v1；需契約／工作包則用 v2。pi 的工具呼叫範例：

```json
{"operation":"create","contract":{"goal":"整理 CSV 資料並交付可核對的摘要","constraints":[{"id":"c1","text":"保留原始 CSV，不改動來源"}],"acceptance":[{"id":"a1","text":"摘要的筆數與加總可由原始 CSV 核對"}],"writeScope":["reports"],"budget":{"maxAttempts":3,"maxDurationMs":300000}}}
```

保存回傳 id，再以 `case_workflow` 的 `run`（帶 caseId）或 `/case run <id>` 執行。`/case list`、`/case show <id>` 查詢；`/case stop` 請求停止目前專案的執行，需等待舊工作停止後才接手。先在 pi 選定預期模型，extension 沿用該模型；需要本地工作時確認選的是本地模型，不自行 fallback 雲端。

CLI 使用相同核心：`init --project <project>`、`create --project <project> --data <contract.json>`、`get --project <project> --case <id>`。以 `--help` 核對命令。契約及 action JSON 檔放在一般工作位置，不手改 `.case-agent` 狀態。

## 專案共識與整體計畫

先讀已有專案指引。長期共識需要跨卷宗共用時，agent 整理 `{summary,constraints:[{id,text}],sources:["AGENTS.md"]}` 設定檔，來源只列真實存在的相對路徑；由使用者在 pi 執行 `/case project <FILE>` 並確認，或經授權用 CLI `set-project --data <FILE> --revision <目前專案revision，首次0> --reason <理由> --project <project>`。CLI 前須 init；pi 命令會初始化。沒有跨任務需求不必額外設定。

`/case project`、`case_workflow` 的 `project` 操作或 CLI `project` 可查看共識。設定檔的 constraint ID 使用 `local` 這種一般 ID，**不要自行加 `project:`**；例如 `{"summary":"本機完成工作","constraints":[{"id":"local","text":"資料不外傳"}],"sources":["AGENTS.md"]}`。核心才會在繼承時產生 `project:local`。新卷宗自動繼承摘要、來源雜湊及限制，模型不能以同名 constraint 覆蓋。來源或共識改變會回報 `PROJECT_POLICY_CHANGED`；經使用者確認更新共識，再明示 revise 受影響卷宗，不能偷偷讓新規則取代舊驗收。大憲法是跨任務共識，卷宗契約是本次成果與整體驗收，packets 是可修改的執行計畫，不是三份相同文件。

## 工作包與核對

pi 子 session 使用 `case_result` 工具交回結構化內容：參數為 `{"result":下述回覆物件}`。先做完讀取、寫入與檢查，再呼叫一次；之後不再操作工具。它只傳送回報，核心仍驗證其內容，呼叫成功不等於工作驗收通過。原始最終文字另存 rawFinalText；其他整合若未提供此工具，仍須交回完整 JSON，不能在同一對話換個角色就宣稱隔離。

`plan` action 帶 `packets`。每包包含 `id,purpose,constraintIds,inputs,dependsOn,writeScope,deliverables,checks,unknowns`；inputs 為 `{path,required}`，deliverables 為 `{path}`，checks 為 `{id,text,criterionIds}`。路徑相對於 project；每項全域驗收須有 check 涵蓋。明示相依包的產物可成為下游輸入，核心在上游 verified 後綁定版本。輸入 SHA256 由核心保存，不讓模型猜值。必要材料缺漏而無法形成有效計畫時，pi planner 回覆 `{blocked:{reason}}` 並填非空的具體原因；runner 保存原因、回報 BLOCKED 且不派 worker，不用空產物包表示阻礙。

包狀態依 `start → submit → review` 更新，`review` 使用不同於 worker 的真實 session ID。submit 保存產物版本但不代表通過；核對者查實際來源與產物，最後 `integrate` 逐項核對全域驗收，不能只憑局部 pass 結案。CLI 的 action 以 `dispatch --case <id> --data <action.json> --revision <目前revision> --request <唯一requestId> --project <project>` 提交；同一 requestId 只用於同一 action 的重送。

pi runner 依序建立 planner、worker、reviewer、integrator session，不把 worker 對話匯入 reviewer。只有 worker 可以透過限定寫入工具改工作包範圍；不是 OS sandbox 或對同權限程序的防竄改。契約 `writeScope` 是使用者授權上限，planner 只能在內縮小各包範圍，不能把模型的計畫當新授權。

worker 完成回覆 `{"summary":"實際改動"}`；外部必要資料缺漏回覆 `{"blocked":{"reason":"缺什麼及影響"}}`；可由既有資料與權限補做的前置或計畫缺口回覆 `{"changeRequest":{"reason":"需補做什麼及依據"}}`。後者交給新 planner context，不由 worker 自行改全域計畫。

planner 修正回覆 `{packets:[完整修正計畫],rerunPacketIds:[需實際重做的既有包ID],reason:"變更理由"}`。CLI 對應 `amend_plan` action。核心保存失敗嘗試，保留未受影響且來源／成果仍有效的 verified 包；變動、寫入重疊及相依受影響者待重做。目標、驗收、授權、總預算不變。舊契約未設 writeScope 時，修正上限是原計畫的範圍，不能偷偷擴大。外部缺料明示停止，未知副作用須確認，不自動重播。

## 實際檢查的授權

沒有任意 shell 工具。若需要執行測試，agent 可準備以下設定，由使用者執行 `/case checks <FILE>`，看清命令後確認：

```json
{"tests":{"command":"node","args":["--test"],"timeoutMs":30000}}
```

未指定 `criterionIds` 的檢查在全域整合執行；可加 `criterionIds:["a1"]`，讓涵蓋該驗收的工作包核對時也執行。命令會執行專案程式，具有目前使用者權限；不可信測試須另用沙箱。授權只留在此次 extension 記憶體；`/case checks-clear` 清除後續授權，執行中需 `/case stop`。模型只能呼叫已核准 ID，不能新增命令。runner 保存真實結果，失敗不能被模型 passed 覆蓋；沒有清單時仍可讀檔核對，但不得聲稱已執行測試。

## 接續、修訂與容量

- 先 `get` 查目前契約、包與 attempt，再以 `context --case <id> --packet <packetId> --project <project>` 組裝當包材料。全部全域限制保留；`--max-chars` 是字元預算，超限報 `CONTEXT_TOO_LARGE`，應縮小包／材料，不截掉必需條件。
- 大型必要來源可設 `{path,required:true,delivery:"indexed",purpose:"讀取用途"}`，保留版本與必讀義務、按 `case_read` 的 startLine/maxLines 取用，不整份內嵌。預設 inline；限制仍直接進 context。讀取工具單檔上限 1 MiB、每次 200 行與 24000 字元，超過需已授權的前處理或其他工具，不能默默略過。
- 來源或產物雜湊變更要核對並重驗。`retry` action 帶 `packetId,reason`；重跑已驗證包會使下游失效。pi 工具也有 retry 操作。
- `revise` action 帶新 `contract,reason`；契約修訂保守使全部包與整合失效，須 `plan` 重新對齊，不能用 retry 偷渡舊契約。舊包留在 packetHistory，累計預算不重置。
- 發現 running attempt 時，先確認原程序已停止及部分產物／外部副作用。需要時透過核心 `block`（packetId、reason）保存障礙，再明確 retry；不直接重跑外部副作用。失敗 run 的原始回報保留於 artifacts。
- 同包最多初次加兩次局部修正；重複缺陷、計畫缺口、全域驗收失敗可回 planner。自動重規劃最多兩次，跨 run 累計並受原總時間／attempt／session 預算限制；無實質改動停止。整合 false 必須實際補做，不反覆詢問驗收者直到改口。未知用量保留 unknown／null，不寫成零。

## v1 遷移與保存

讀到 `case-workflow/1` 時 v2 會回報 `MIGRATION_REQUIRED`。只有已明確要求升級才執行 `node "<skill-dir>/scripts/case-v2.mjs" migrate --project "<project>"`。先停止所有寫者；遷移在 `.case-agent` 外建立備份，驗證後才切換 manifest，保留回傳 backupPath。陌生內容、路徑連結或備份失敗應停止處理。

v1 `tasks` 留作 legacy 歷史，不成為 v2 獨立驗收；需要續作時建立新契約並引用舊 ID。遷移後 v1 `case.mjs` 拒絕資料是預期保護。安裝／移除技能不刪資料。v2 權威是 `cases/<UUID>/state.json`，run 記錄在其 `artifacts/`；摘要不是第二份權威。只有協調者寫狀態，殘留鎖須確認舊程序停止後處理，不能只憑時間刪除。
