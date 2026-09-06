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

pi 子 session 使用 `case_result` 工具交回結構化內容：參數為 `{"result":下述回覆物件}`。先完成讀取、寫入與自查，再提交；**接受後**不再操作工具。計畫與 worker 成果會先預檢；遭拒時依錯誤在原 session 修正，再提交，不是已經驗收失敗便只能重開。原始最終文字另存 rawFinalText；其他整合若未提供此工具，仍須交回完整 JSON，不能在同一對話換個角色就宣稱隔離。

pi 接受回報後由程式停止該次生成並交回外層，不等待模型自行結束。相同已接受結果重送只取得原收據，不重跑檢查；衝突回報、後續寫入、取消或停止本身失敗仍受檢查，不能覆蓋原證據。

worker 回覆只能是 `{summary}`、`{blocked:{reason}}` 或 `{changeRequest:{reason}}` 其中一種；不能夾帶其他欄位或混合成功與受阻。未知欄位會拒絕並要求修正，不靜默丟棄。新發現使用下節的 `case_discover`；只在 summary 文字提及缺口，不代表已建立待辦。

計畫若被預檢拒絕，回報尚未收下，依工具錯誤修正後再交回；不需要重做已完成工作或改動契約。若 session 只回文字而沒有可接受的結構化回報，pi runner 在原回合／時間預算內最多補問一次，保留 `replyCorrections`；取消、回合用完或已接受回報時不補問。預檢不提交狀態，正式提交仍重新檢查版本與來源；不要把補正誤認為增加預算、放寬驗收或可以任意重播副作用。

`plan` action 帶 `packets`。每包包含 `id,purpose,constraintIds,inputs,dependsOn,writeScope,deliverables,checks,unknowns`；inputs 為 `{path,required}`，deliverables 為 `{path}`，checks 為 `{id,text,criterionIds}`。路徑相對於 project；每項全域驗收須有 check 涵蓋。明示相依包的產物可成為下游輸入，核心在上游 verified 後綁定版本。輸入 SHA256 由核心保存，不讓模型猜值。必要材料缺漏而無法形成有效計畫時，pi planner 回覆 `{blocked:{reason}}` 並填非空的具體原因；runner 保存原因、回報 BLOCKED 且不派 worker，不用空產物包表示阻礙。

包狀態依 `start → submit → review` 更新，`review` 使用不同於 worker 的真實 session ID。submit 保存產物版本但不代表通過；核對者查實際來源與產物，最後 `integrate` 逐項核對全域驗收，不能只憑局部 pass 結案。CLI 的 action 以 `dispatch --case <id> --data <action.json> --revision <目前revision> --request <唯一requestId> --project <project>` 提交；同一 requestId 只用於同一 action 的重送。

pi runner 依序建立 planner、worker、reviewer、integrator session，不把 worker 對話匯入 reviewer。只有 worker 可以透過限定寫入工具改工作包範圍；不是 OS sandbox 或對同權限程序的防竄改。契約 `writeScope` 是使用者授權上限，planner 只能在內縮小各包範圍，不能把模型的計畫當新授權。

執行中已識別的新待辦／缺料優先用下一節的 `case_discover`。以下為保留的終止回報路線：worker 完成回覆 `{"summary":"實際改動"}`；遇阻回覆 `{"blocked":{"reason":"缺什麼及影響"}}`，已有補做建議時也可用 `{"changeRequest":{"reason":"需補做什麼及依據"}}`。兩者均保存原始回饋並交給新 planner context，由 planner 判斷是否能在既有資料／授權內修正；不能僅憑 worker 的 blocked 標籤認定必須外部介入。真正缺外部資料或新授權時 planner 回覆 blocked，runner 保存阻礙；未受影響工作可先完成，無可做工作時才回報等待。兩者共用原有重規劃上限，不由 worker 自行改全域計畫。

planner 修正回覆 `{packets:[完整修正計畫],rerunPacketIds:[需實際重做的既有包ID],reason:"變更理由"}`。CLI 對應 `amend_plan` action。核心保存失敗嘗試，保留未受影響且來源／成果仍有效的 verified 包；變動、寫入重疊及相依受影響者待重做。目標、驗收、授權、總預算不變。舊契約未設 writeScope 時，修正上限是原計畫的範圍，不能偷偷擴大。外部缺料明示停止，未知副作用須確認，不自動重播。

## 執行中發現與待辦處置

需要補做的新工作立即保存，不等提交成果。原包內可自行修復就先修復；需另一工作包、外部資料或新權限時，worker 使用內部工具：

```json
{"key":"missing-normalized","summary":"報告需要已核對的正規化資料","evidence":"讀取 normalized.json 回傳不存在；本包只可寫 report.json，原驗收仍要求先正規化。","impact":"blocking"}
```

這是 `case_discover` 的參數（不是 `case_result`）。`key` 最長 160 字元、`summary` 2000、`evidence` 4000，均非空；impact 只接受 `blocking`／`nonblocking`。證據說明原目標或驗收缺口，不能把任意新想法當既有授權。同一來源 attempt 的相同 key／內容重送不重複入列；新證據用新 key，不同包／attempt 的相似發現交規劃者判斷，不能僅憑同名抹掉。

- `nonblocking`：保存後繼續本包，於安全交接點由規劃者處置；已核對且未受影響的成果保留。
- `blocking`：保存後結束本次執行、封住後續工具，讓規劃者補前置或記錄所缺外部條件；不在工具內遞迴派工。未受影響的工作包可繼續。
- 每卷宗最多 32 筆發現是工程上限，不是要求新增 32 項工作；達限須保存既有工作並明示問題，不無限擴張。

權威佇列是 state 的 `discoveries`，不是另一個服務或 GitHub Issue。核心 action 為 `report_discovery`，帶 `packetId,attemptId,discovery`；由核心綁定來源版本。pi runner 代辦持久保存，worker 不直接改 `.case-agent`。

規劃／整合與當包 context 使用有界 discovery 索引，不預載完整證據與歷史。`summaryPreview`／`reasonPreview` 最多 240 字元，另有明示截短欄位；索引不是完整證據。需要判斷的項目先呼叫 `case_discovery_read`，例如 `{"id":"索引中的實際ID","start":0,"maxChars":6000}`，依回傳 `nextStart` 分頁，`complete:true` 才表示已到末尾。不能把尚未讀到的證據當成不存在。單次上限 12000 字元，不是 token；revision 改變須重新核對，不能拼接不同版本。規劃者／整合者可查本卷宗，worker／reviewer 只可查與當包有關的項目；沒有任意檔案或其他卷宗讀取權限。可攜核心亦提供 `store.readDiscovery`，純 CLI 可由 get 查看權威記錄，不假裝有 pi 的內部工具。

規劃者收到待辦後回覆 `decisions`，每筆 pending 恰好處置一次；若需改計畫，同一回覆加完整 `packets`、`rerunPacketIds`、`reason`，核心以 `resolve_discoveries` 原子處置與補包，不先採納再留下半份計畫。以下是原計畫已經有符合相依的 normalize 包時的回覆例，id 換成收到的實際 ID：

```json
{"decisions":[{"id":"實際discovery-id","status":"accepted","packetIds":["normalize"],"reason":"原驗收必要前置，既有 normalize 工作包已涵蓋"}]}
```

如果 normalize 尚不存在，必須同時提供完整有效 packets 計畫（包含 normalize 及原報告包），並讓原報告包實際依賴 normalize。不能只給新增包或空陣列。僅採納已存在的工作、不修改計畫時，省略 packets／rerunPacketIds 即可。

| status | 必要資料與後果 |
|---|---|
| accepted | `packetIds` 引用實際工作包；blocking 的補做必須是來源包的真正前置，或以新計畫替換來源包 |
| duplicate | `duplicateOf` 指向已處置的直接項目；不接受循環、鏈結或掩蓋尚未解決的阻礙 |
| dismissed | `reason` 說明為何不屬必要工作或判斷有誤 |
| deferred | `reason` 說明延後理由；只適用 nonblocking，不是降低原驗收 |
| needs_input | `reason` 明示缺少的外部資料／授權；受影響工作等待，獨立工作繼續 |

所有處置都須 reason。正常發現處置使用原總時間／session／attempt 預算；不另耗舊失敗回饋的兩次重規劃額度。pending／needs_input 不得結案，accepted 對應工作必須仍存在且核對通過。

外部條件未變時 resume 不反覆問規劃者；條件已補足後，以 CLI dispatch 提交 `{"type":"reopen_discovery","id":"實際discovery-id","reason":"已補足什麼及來源"}`，再 run。保留舊處置歷史，重開主項亦重開其重複項。若來源／契約也變動，仍須依原版本規則重新對齊，不能靠 reopen 略過。

首次使用佇列時，**卷宗 state** 標為 `case-workflow/2.1`；目錄 manifest 仍是 `case-workflow/2`。新版核心讀取 2／2.1；舊核心應拒絕 2.1，避免漏掉待辦就結案。更新所有共同操作此卷宗的技能／核心，別把新狀態交給舊程式。純技能與其他 AI 工具可用相同核心 action，但不因此取得 pi 自動排程或獨立 session 能力。

## 實際檢查的授權

worker 提交前，runner 先用核心提交規則核對 summary、必要來源及實際產物，再執行本包已核准的檢查；缺檔或失敗會回到原 session，讓 worker 在原權限與預算內修復。預檢期間其他工具不能穿插操作，回覆文字也不能繞過同一預檢。只確認產物存在不是語意品質保證，未設定核准檢查時須明示其限制。正式 submit 和獨立 reviewer 仍重新核對；不能靠模型反覆自評代替獨立驗收。

工具清單依階段篩選：planner 不取得檢查工具；worker／reviewer 只取得 criterionIds 與當前包相符的檢查；integrator 取得全部。未指定 criterionIds 的整案檢查不提供給前置工作包。

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
