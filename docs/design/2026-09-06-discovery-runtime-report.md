# 執行中發現與原 session 自查：程式交付紀錄

日期：2026-09-06。依[已批准設計](2026-09-06-discovery-and-repair.md)接續未提交成果；此紀錄描述程式與測試，真實模型探測由主代理另外保存。未提交、推送、修改全域 pi／模型服務或清除備份。

## 本輪結果與接口

核心保存發現、來源與規劃者處置；pi 執行者能立即回報並在提交被拒後於原 session 修正實際產物。規劃者仍掌握原目標內的補包與相依，執行者不能自行派發或擴權。已核對的獨立成果沿用既有 amendment 規則保留，所有必做發現與工作包仍須經全域驗收。

| 位置／接口 | 行為 |
|---|---|
| `core/discoveries.mjs` | `report_discovery` 保存 `{key,summary,evidence,impact}` 與 packet／attempt／packetRevision／contractRevision。重送鍵以 packetId＋attemptId＋key 為範圍；同範圍同內容沿用項目，同範圍變更內容拒絕，跨來源或跨 attempt 保留新項供語意去重。 |
| `resolve_discoveries` | 同一次處理全部 pending。可附完整 `packets`／`rerunPacketIds`／`reason`，使用原 amendment 範圍、相依、來源與保留規則；處置及計畫同一次寫入。`accepted` 只帶實際 `packetIds`；`duplicate` 只帶 `duplicateOf`，映射由核心繼承；其他只帶 id／status／reason。 |
| 阻塞／去重 | Blocking accepted 必須指向來源包的實際前置相依，或由新計畫替代來源包。Blocking 不得 deferred，也不得借 duplicate 隱藏 deferred 工作。Duplicate 只接受直接 settled target（可為同批較早的 accepted／dismissed／deferred 決定），拒絕鏈與循環。 |
| `reopen_discovery` | 保存先前決定與重開理由；同步重開指向它的 duplicate。`revise` 亦重開舊處置以重新對齊新契約。後續 amendment 不得刪掉 accepted 映射，必須先重開再明示重新處置。 |
| `core/state.mjs`／`store.mjs` | Pending／needs_input 不能整案完成；accepted 工作須仍存在且 verified。阻塞亦限制來源包的下游執行。`validateAction(id, action, {expectedRevision})` 支援 submit／resolve_discoveries，共用正式 transition，但不寫入 revision、attempt 或產物狀態。 |
| `core/context.mjs` | 當包 context 加入與來源包或採納工作包有關的發現索引，不放入全部證據歷史或 worker 對話。每項含 id／status／impact／來源／summaryPreview／明示截短標記／evidenceChars／historyCount／必要處置映射；完整權威資料按需讀取。 |
| `runSession` request | Worker 新增 `onDiscovery(discovery)`，await 後取得 `{id,status,impact,revision}` 持久收據。`validateResult` 為可 await；先核心 submit 預檢，再本包已核准 checks，再確認取消／當時來源與產物。失敗的實際 check 結果保存於 run。 |
| `readDiscovery`／`case_discovery_read` | Request callback 與 SDK 唯讀工具接受 `{id,start=0,maxChars=6000}`，回傳 `{id,revision,start,nextStart,totalChars,complete,text}`；單次上限 12000 字元，從同份 state 的單筆權威發現分段讀取。Planner／integrator 可讀本案索引，worker／reviewer 限當包來源或採納映射；不允許任意檔案、其他卷宗或狀態寫入。Store 提供相同 `readDiscovery(caseId,id,options)` 及可選 expectedRevision 預檢。 |
| `case_discover` | 僅有 callback 的 worker 註冊此工具。Nonblocking 持久後繼續；blocking 持久後封住 session 工具並要求 session 停止，交回帶發現 ID 的 changeRequest。工具內不開 planner 或 worker；外層安全交接後才處置。 |
| `case_result`／final-text | 驗證可 await；等待期間拒絕其他工具競態。被拒後可在同 session 修復檔案／檢查問題再送；accepted 後封住工具並主動要求 session 停止生成。同一 JSON 語意結果重送僅回原收據，不重驗或毒化有效成果；衝突結果／後續其他工具仍被拒絕。Final-text 及一次原 session 回覆修正也走相同預檢，不能以最後文字繞過；成功 final-text 不重複執行一次已通過的預檢。取消與停止本身的異常均保留失敗及原結果證據。 |
| Worker 正式回覆形狀 | 共用 `validateWorkerReply` 僅接受單一 `{summary}`、`{blocked:{reason}}` 或 `{changeRequest:{reason}}`；文字須非空，拒絕未知、混合及巢狀額外欄位。獨立 runner 正式 parse、worker 預檢、SDK 工具及 final-text 均適用；SDK worker schema 同步 `additionalProperties:false` 及互斥形狀。新發現應使用 case_discover，無法處理的結構資料會明確拒絕，不靜默丟棄。 |
| `runner.mjs` 等待 | Worker blocked／changeRequest 與 reviewer 反覆失敗仍能要求 planner 補包；planner 判定缺外部資訊後，獨立包繼續完成。Discovery needs_input 或真正外部阻礙在無可做工作時返回 BLOCKED。已保存 waitingRevision 未改時，resume 不再呼叫模型；外部資料補足後，以 reopen_discovery 或相關明示核心操作改變狀態再接續。獨立包找到新證據並由 replan 或 discovery 原子 amendment 實際修正整體計畫時，同步清除過期等待標記與 pendingFeedback。 |
| CLI／封裝 | `case-v2.mjs --help` 列出 discovery 動作。新增兩個測試檔已加入 `package.json` 全套清單；新增核心位於原有 skills 封裝範圍。 |

首次 report 將卷宗 state 標記為 `case-workflow/2.1`，manifest 仍用原本 `case-workflow/2` 目錄。新版讀取 2 與 2.1；沒有新回報的 v2 案件不變。唯讀查核基準提交 `b0ad4d5634d2b98224f7e8a4e81e32057d48acf0` 的 store，舊讀取條件是 `state.format !== FORMAT` 時拒絕，因此不會把 2.1 pending 當成不存在。本輪沒有另外啟動舊版核心的實際程序，這項是來源查核，不誇稱跨版旅程已測。

## RED／GREEN 證據

新 `discoveries.test.mjs` 延續原先 8 案中的 6 pass／2 fail。補入來源鍵、阻塞提交／相依、映射刪除及 reopen 傳播反例後，實際執行為 12 案、6 pass／6 fail：缺 callback、錯誤去重及未拒絕的狀態操作均重現。

新 `pi-discovery-sdk.test.mjs` 第一輪 5 案全部失敗：非 await 驗證提早接受並產生未處理 rejection、寫入競態、final-text 漏驗，以及尚無 case_discover。修正後與既有 SDK 18 案合跑 23／23 通過。

後續反例重現 dismissed duplicate 可偽造映射、重開上游未擋下游、integration 外部等待仍重問 planner、reviewer 外部阻礙提前停止獨立工作、接續 context 缺少處置，以及成功 final-text 重複自查。分別修正後通過。補查需要外部資料後明示重開、既有 verified 獨立輸出不重做、32 項上限保留既有證據、同 session 實際錯誤檔修復、取消與預檢 race。

第一輪全套 153／153 通過後凍結執行本機探測。主代理的 probe01 實際顯示 blocking discovery 已採納、補包及 normalization 產物正確，但模型在 case_result accepted 後再次送出結果，觸發 `RESULT_ALREADY_RECORDED` 而整案失敗（213738 ms）；保留這個失敗，不算完成或效果成功。

第二輪依真實失敗及主代理審閱補 RED：接受結果未主動停止、相同回覆重送變成假失敗；8 筆合法 2000 字元 summary／4000 字元 evidence 令 planner context 超過 48000；新合法重規劃仍殘留舊 waitingReason。51 項相關測試的首次執行為 44 pass／7 fail（包含先前 context 介面改成按需讀取的失敗），修正後全過。額外反例確認 discovery amendment 修好舊 legacy 阻礙也須清除等待，修正前失敗、修正後通過。停止異常與正常 AbortError 另作保存／交接回歸。

第二次凍結探測 probe02：主代理回報 411003 ms、7 sessions，state completed，兩個產物 exact、來源未改、執行期間程式未改；但 `feedbackObserved:false`，模型走舊 blocked 路徑而沒有 accepted discovery，因此目標探測仍為 **FAIL**，不放寬原標準。主代理觀察新 worker 同時收到「用 case_discover 回報缺口」與「缺料回 blocked／改計畫回 changeRequest」兩套重疊提示。這可能影響路徑選擇，但尚未證實因果。

因此第三輪只做 worker 提示去歧義：完成產物才送 summary；缺外部材料、缺前置、跨包調整及原目標所需追加工作，在執行中使用當前已有的 case_discover，依是否妨礙本包選 blocking／nonblocking；包內缺陷先在原 session 修復。程式仍接受舊 blocked／changeRequest，不強制特定工具、不自動改寫 worker 原回覆，也不改測試成功標準。既有 discovery 與 legacy 回饋測試核對相容性；提示對真實模型的影響留待下一次凍結探測，單元測試不冒充行為效果。

Probe03 使用第三輪提示版、仍未含下述嚴格欄位修正：主代理回報 601399 ms、8 sessions，因時間上限 CANCELLED，整案 **FAIL**。首份 report 違反必須使用已核對 normalized 資料的來源約束，被獨立 reviewer 拒絕；後續 worker 確實回報 blocking discovery，planner 讀取權威發現並採納補包。結束時 normalize 已 verified、第三次 report attempt 已 submitted、兩產物外部 exact 檢查 exit 0 且來源未改，但 report 的獨立核對與整案整合尚未完成，不能算整案成功。這是無人工修復下觀察到的恢復路徑，也不等於已證明所有摘要能自動進佇列。首次 case_result 的精確入參未記錄，不能猜測它是否帶有額外欄位。

唯讀審查另發現與上述未知入參分開的確定風險：先前 worker 回覆的額外結構欄位會被忽略。補入 8 個可重現反例，首次全部失敗，涵蓋 summary 的額外 discoveries／evidence、summary 與阻礙混用、兩種阻礙混用、巢狀額外欄位，以及 SDK 工具／final-text。第四輪以共用純形狀驗證修正，8 案轉為通過，且被拒後原 session 仍可修正並送出合法回覆。不分析自由文字、不將舊回報自動轉入 discovery，也不改舊合法阻礙語意。兩處僅測 SDK session／capability 的替身原先把 worker 當 reviewer 回 `{passed:true}`，改為合法 worker summary；reviewer 回覆形狀未改。

最後驗證：

- `npm test --prefix workflow-kit`：**169 tests，169 pass，0 fail，0 skipped，exit 0**。其中 discovery 31 案、SDK discovery／自查 13 案；既有核心、安裝、pi、回饋與 evaluation 測試一併執行。
- `git diff --check -- workflow-kit/integrations/pi workflow-kit/skills/case-workflow/scripts/core workflow-kit/tests workflow-kit/package.json`：exit 0；僅 Git 的 LF／CRLF 提示。
- `node workflow-kit/skills/case-workflow/scripts/case-v2.mjs --help`：exit 0，顯示新動作與版本提示。

新補包／self-repair 程序測試使用真實暫存檔與正式 store／runner／工具；模型回覆與 pi SDK 的外部 session 邊界使用可控替身。此證據不能代替本地模型是否會發現問題、採用工具與修好成果的探測。

## 實際限制與原構想對照

按 [MAINTENANCE 的原始構想參照](../MAINTENANCE.md#原始構想參照)及[分層協作整理](../research/2026-09-05-layered-cooperation-direction.md)回看，這次補的是「發現 → 保存 → 原授權內處置 → 新工作／接續 → 全域驗收」與原 session 修復，而非增加固定角色、任務數或 GitHub 流程。Issue／PR 概念仍是資料與責任分離，不依賴 GitHub；沒有新增排程。

- 保留原總時間、session、attempt 累計上限。Discovery disposition 不耗用反覆失敗重規劃的 2 次額度，但仍耗用原 session／時間預算。工程上限仍為每案 32 發現、每 session 預設 16 turns、runner 累計 `3 * maxAttempts + 2` sessions；沒有無限重試或自動加預算。
- 核心 `startedAt` 時間期限不因外部等待重置。等待很久後可能需要使用者明示變更預算／契約；框架不擅自延長。
- `needs_input` 的外部檔案改動本身不改 state revision，必須明示 reopen／對齊，避免無資訊 resume 重問模型。已結案的 terminal 限制保留；需要重新處置既有完成成果時使用原本明示 revise 流程。
- 沒有已核准 checks 時只有檔案／來源預檢；有 checks 也不等於語意全知，獨立 review 及全域 integrate 仍保留。模型仍可能漏報、錯報、錯誤處置或在預算內無法修好。
- 明確 `case_discover` 立即進 discovery 權威佇列；合法舊 blocked／changeRequest 仍保存於 attempt／run 並交 planner，兩個入口皆保留，但不是同一份 queue。自由文字 summary 中未結構化的新發現不會被 NLP 掃描自動排入；獨立 review 可補查，不保證發現所有問題。
- 工具 scope 與來源雜湊不是 OS sandbox。已核准命令及其呼叫的程式仍有目前使用者權限；來源／測試可信度沿用既有明示授權，不新增任意 shell 或自動擴權。
- 只提供本地 store 的程序／檔案鎖與 revision 協調；不是多機交易或強身分認證，也不保證外部副作用 exactly-once。session 中斷後的未知副作用仍需明示檢查／retry，不能因有 pending 就盲目接手。
- Discovery 大量證據不再整批塞進 planner／integrator／worker prompt；索引明示摘要截短，完整證據與歷史以 `case_discovery_read` 分段查核，仍在唯一 state 中。這不保證任意巨大契約／計畫都放得下：其他必要 context 超出仍安全報 `CONTEXT_TOO_LARGE` 並保存當前卷宗／run；可改成 indexed inputs 或合法調整計畫再接續。模型 session 內的 compaction 設定沿用 pi，但本輪沒有實作或宣稱透明的 context 用滿後自動續跑／無損記憶；中斷中的 worker 維持原本明示復原要求。
- 新即時工具目前只接 pi；其他工具可用相同核心 discovery action。跨工具原生 session 與真實模型成效沒有因程式測試通過而升級宣稱。

本輪使用測試先行技能取得可重現失敗，再以正式 transition 與既有授權檢查修正；完成前驗證技能使交付數字只引用實際最後一輪結果。既有未提交變更和歷史模型失敗均保留。
