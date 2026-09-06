# 執行中發現新工作：復盤、設計與實作接續

日期：2026-09-06。使用者已確認「立即保存發現，由規劃者在原授權內去重／排入，僅暫停受影響工作」的實作方向。本文件可滾動修正；設計不是已通過的模型成效。

## 本次脈絡與應修正的判讀

使用者先指出獨立 context 的執行者應自行檢查、修正，再指出原案早已要求執行中可回饋新 tasks 到 queue。我先前將問題集中在缺產物的提交關卡，沒有完整追蹤「發現 → 持久保存 → 處置 → 新工作 → 接續 → 全域驗收」；已讀的原案研究甚至列過補包，卻未形成完整的行為驗收。這是需求到實作的追蹤缺漏，不應歸因於使用者未事先說清楚。

原案固定版 `2c1d160013c763457269226fcc37b1b18728884a` 的 `references/for_agents.md` §5、§6、§10、§10a、§13a 明訂工具式 `create_subtask`、立即回饋及雙層修正。[來源與限制](../research/2026-09-06-dynamic-work-discovery-sources.md)。保留其意圖，不照抄全域回滾、固定重試次數、每案強制新增任務或自動推送。

[六次固定版比較](../evaluation/case-value-validation-report.md)仍是真實觀察：小案例沒有顯示品質收益且成本較高。但它測的是當時不完整的執行生命週期，不能據此否定完整構想。新修正結果另存，不修改舊證據或合併算成功率。

## 系統化覆蓋：按處置分類，再交叉檢查生命週期

分類採優先判斷順序，避免同一件事同時被當成重試與新需求；MECE 是查漏工具，不是保證未知問題不存在。

| 優先判斷 | 當前工作如何處理 | 後續責任 |
|---|---|---|
| 涉及新授權、改變目標或無法取得的外部資料 | 停止受影響操作，保存證據 | 規劃者確認，必要時請使用者決定；其他獨立工作可繼續 |
| 原工作包內可修復的缺陷 | 原 session 實作／檢查／修正 | 不為每個錯誤另開任務；獨立驗收仍保留 |
| 需另做前置或跨包調整才能達成原成果 | 立即回饋並暫停本包 | 去重、相依／權限檢查、補包後以新 context 接續 |
| 不阻塞本包、但原成果仍需要的後續工作 | 立即保存，本包可繼續 | 在安全交接點排入，不等到所有包做完才知道 |
| 可選改善、與原成果無關或已有人處理 | 保存可重用發現，不自動擴張必做範圍 | 明示延後、不採納或連到同一待辦／既有工作 |

每類再核對：發生於讀取／實作／自查／獨立核對／整合；首次／重送／換 context；同包／跨包／跨卷宗；原授權／新授權；成功／失敗／取消／未知副作用。不能用「有 changeRequest」一個測試代替整張行為表。

## 現況與真正缺口

| 能力 | 修改前證據 | 本次設計 |
|---|---|---|
| 獨立 context | `sdk-session.mjs` 每次 `SessionManager.inMemory` | 保留，不把名稱當隔離證據；非 OS sandbox |
| 補前置與重規劃 | `runner.mjs` 終止回報 blocked／changeRequest；`amendments.mjs` 保留有效包 | 保留，補非終止的即時發現工具 |
| 持久發現及處置 | 只有 attempt 回饋／run pendingFeedback，無完整待辦處置表 | 同卷宗 state 中保存發現、來源與決定；不另建 queue 服務 |
| 完成前自查 | planner 有預檢；worker 缺檔在 session 結束後才發現 | 共用核心提交預檢＋已核准檢查；拒絕時 session 保持可修正 |
| 外部受阻但獨立工作可做 | runner 見 blocked 可立即停止整案 | 有明確待辦處置時，只跳過受影響包；無可做工作再回報阻礙 |
| 接續及來源有效性 | revision、SHA256、attempt／run、總預算已有 | 待辦亦持久化；未知執行副作用仍不得盲目接手 |
| 跨工具 | 可攜核心，pi 自動 session | 同一資料／操作契約；不新增未測的原生整合宣稱 |

## 採用的責任邊界

執行者可提出新工作，但不能自行放寬目標、權限或驗收。框架立即接收並持久化；規劃者處置後才產生可執行的工作包。必要前置優先，獨立工作繼續，局部成果及全域成果分開驗收。

三種選擇：只擴充終止回報最省碼，但仍可能在當前工作中斷時遺失發現；讓 worker 直接建立並派發任意工作容易重複／擴權；採用「即時發現佇列＋原有計畫修正」可補缺口並重用已測核心。使用者已同意第三種。

專案管理負責目標／依賴／處置，context engineering 負責必要資料及接續，harness 負責權限／狀態／工具／驗收。不是新增三套服務或固定角色數。

## 資料與介面

- `report_discovery`：帶當前 `packetId`、`attemptId` 及 `discovery:{key,summary,evidence,impact}`，impact 為 `blocking` 或 `nonblocking`。key 是回報者提供的穩定重送鍵，summary／evidence 為短的非空文字。框架綁定來源工作包、嘗試與契約版本。
- `state.discoveries`：唯一權威佇列。同一來源 packet／attempt 重送相同 key／內容不建立第二個項目；同來源同 key 改內容拒絕。跨 attempt 或不同 key 的相似發現交規劃者合併，不能僅憑同名抹除新證據。對量與文字長度設工程上限，耗盡時保留既有發現，不無限新增。
- `resolve_discoveries`：規劃者以 `decisions` 處置當前 pending 項目；`accepted` 連到實際 `packetIds`，`duplicate` 連到已處置的 `duplicateOf`，`dismissed`／`deferred`／`needs_input` 必須有理由。blocking 不得僅標 deferred 而繼續；錯誤解除阻礙要有明確處置理由。
- 同一 action 可附完整 `packets`、`rerunPacketIds` 與 `reason`，重用 `amend_plan` 的範圍／相依／保留規則；處置與改計畫在同一次寫入完成。沒有改計畫時也可合併或採納已有工作，但不能把不存在的包當承諾。
- `reopen_discovery`：外部資料或決定已補足後，帶 id／reason 明示重新處置，不在每次 resume 盲目再次詢問模型。
- pi 的 `case_discover` 在執行過程立即保存；nonblocking 回傳後可繼續，blocking 封住本 session 後續工具並交回規劃者。不在工具內遞迴啟動 worker。
- 已處置待辦不是另一份進度表：accepted 的進度由引用的工作包推導，不能另寫一個假完成欄位。整合前不得有 pending／needs_input；整合者可看處置理由，避免忽略必要缺口。

相容性：首次使用新佇列動作時，卷宗 state 改標 `case-workflow/2.1`，manifest 仍用現有 v2 目錄。新版讀取 2 與 2.1；舊核心拒讀 2.1，避免忽略 pending 後誤結案。不啟用佇列的既有 v2 卷宗不變；不是 v1 自動遷移。

## 自查、預算與安全

`case_result` 的驗證改成可 await。worker 完成宣告先以核心提交規則查 summary、來源與產物，再執行本包已核准的檢查；失敗回傳具體原因，允許修正，不先結束 session。正式 submit 與獨立 review 仍核對當時檔案，避免預檢後來源已改。沒有已核准檢查就明示只做檔案／來源預檢，不能保證語意正確；不得要求「一定要有新 write 呼叫」而重寫原本正確的產物。

自查、處置、補包都計入既有時間／session／attempt 限制；正常處置發現與反覆失敗的重規劃次數分開。不得自行加預算、改驗收或偷換模型。取消後不接受成功，預檢期間不允許其他工具穿插寫入；中斷未知副作用仍需確認。工具回報是資料，不是新的高優先指令。

當前共用核心只提供程序內與檔案鎖協調，不是強身分認證／跨機交易。多寫者碰到 revision 衝突應重讀，不宣稱 exactly-once 外部副作用；本輪不新增多 worker 平行執行。

## 實作工作與驗收

依 writing-plans／測試先行方式在既有功能分支接續，不搬走未提交成果，不動全域 pi／模型服務／備份。各項先寫可失敗的真實狀態測試，再改程式，最後 `npm test --prefix workflow-kit`；新增測試同步 package 清單。

- [x] 佇列核心：新增 `core/discoveries.mjs`，接 `state.mjs`、`store.mjs`。驗證立即保存、重送／衝突、來源身份、處置原子性、相依環／越權拒絕、不漏 pending 結案及 reopen。舊版拒讀依舊核心來源查核，未冒充跨版實際旅程。
- [x] pi 接線：`sdk-session.mjs`、`runner.mjs`、`approved-checks.mjs`。驗證發現後仍可完成當包、阻塞前置優先、外部缺料時獨立包繼續、重開程序讀回待辦、不因 resume 重置預算。
- [x] 提交前自查：`store.validateAction` 共用 transition 而不寫入；SDK await 驗證。驗證缺檔／檢查失敗可在同 session 修復，無權修改測試／來源，驗證進行中與接受後不能再寫。
- [x] 同步操作參照／V2／英文／READINESS／狀態及 MAP，按 MAINTENANCE 僅處理相關處；保留舊比較。模型探測另外保存新結果，若未完成則明示，不能用程式測試代替模型效果。

端到端反例：執行 report 才發現缺 normalize → 即時記錄 → 補 normalize → 原 report 接續；本包合格但另發現 summary 必做 → 本包不重做 → 新包完成；兩次回報同缺口只做一次；外部缺價表時獨立的欄位檢查先完成；所有已知必做項仍未解決時不得 completed。

工程驗收已完成：完整 kit **169/169 通過**；獨立審閱先重現過期 waitingReason 及合法發現撐爆 context 兩項問題，修正後局部複核 36/36 通過，無新增 Important／Critical。新增有界索引＋唯讀分頁，保留完整證據，不增加另一份資料庫。[程式交付紀錄](2026-09-06-discovery-runtime-report.md)保存 RED／GREEN 與介面。模型 probe 01 的 accepted 後重送失敗另外保留，已修成程式主動停止及相同回報重送收據；真實模型後續結果另存，不用工程通過取代。

## 需求到交付的單一追蹤

以下把先前散在對話、研究與部分實作的承諾連到具體位置。完整回歸、獨立審閱、技能情境及本機模型探測已完成；逐次結果與限制見[驗收復盤](../evaluation/case-discovery-repair-report.md)，不由文件存在推定完成。

| 使用者要求 | 主要實作／操作 | 驗證及證據位置 |
|---|---|---|
| 規劃、執行、核對真正分開 context；大憲法對小憲法 | pi `sdk-session.mjs`、core `context.mjs`／`project-policy.mjs` | 既有 SDK／project-policy 測試；新 discovery context 測試；新 session 不等於 OS sandbox |
| 同回合自查修復，不把缺檔當結案 | runner async validateResult、store.validateAction、核准 checks | `pi-discovery-sdk.test.mjs` 的缺檔修復、並行寫入、取消及 final-text 反例；`discoveries.test.mjs` 真實檢查失敗後修復 |
| 立即回饋新增工作，不等結案 | case_discover → report_discovery → state.discoveries | SDK blocking／nonblocking；核心持久保存、重送、新 attempt 證據；runner 原包完成後補工作 |
| 規劃者自行去重與排入，原授權內不再問人 | resolve_discoveries 與 amend_plan 同次提交 | 原子拒絕、真實前置、重複鏈／偽造處置拒絕、有效成果不重做 |
| 只暫停相關工作，外部資料不足也能接續 | discovery 相依阻擋、needs_input／reopen、runner waiting revision | 獨立包先完成、重新啟動不重問、重開主項與重複項、舊 review 回饋等待 |
| 提交不等於接受，所有必做項解決才交付 | submit／review／integrate＋discovery 門檻 | pending／needs_input、採納包消失、來源變更及原全域整合測試 |
| 控制 context、權限、成本與失敗 | 有界 context／工具、版本、總預算、run artifacts | 既有回歸與本輪探測；不保證零失敗或不需外部協助 |
| skills 適配；借用 Issue／PR 概念而不綁 GitHub | SKILL 按需導航、v2 reference、協作 reference／可選筆記 | 本輪技能情境基線：前三情境缺口／歧義，純技能限制正確；修改後四情境及分頁操作均通過 |
| 所有指定參考與原始構想可追溯 | user-reference-synthesis、instruction-skill-source-check、dynamic-work-discovery-sources | 保留三個連結、貼文脈絡、原案固定版本及不採納理由；不強制 root intent/spec/plan |
| 易讀、臺灣用語、修改不破碎 | V2、ARCHITECTURE、範本、GUIDE.en、MAINTENANCE／MAP／狀態 | 連結／封裝與技能應用核對；不複製第二份權威進度 |

## 尚不能保證（界線）

模型仍可能沒發現問題、錯估相關性、錯寫證據或在預算內無法修復；有限測試不能證明 MECE 全知或零失敗。可保障的部分是發現不因正常交接而遺失、權限不因補包擴大、明確未完成不冒充完成。跨卷宗新目標只保存提案及連結，不自動另啟動不相干專案；長 context 效益與其他模型／工具仍需實測。

## 使用者補充：參考協作概念與意圖工程，不綁 GitHub

使用者提供貼文、Claude Academy、roboco-io/intent-engineering 及 dianyike 的指南，並明確要求只借用 Issue／PR 概念。[逐項來源與採納判斷](../research/2026-09-06-user-reference-synthesis.md)列出全文脈絡及限制。新增待辦須回連原意／驗收缺口，交接產物保存必要理由與未決問題；提案不等於採納，成果提交不等於接受。沿用現有權威資料，不新增平行 intent/spec/plan 根目錄文件，不要求 GitHub、軟體開發流程或逐步人工批准。

技能承載可重用方法與按需導航；核心／AI 工具承載狀態、權限與實際檢查。社群示例需核對官方格式，宣稱性的效果數字不當作 CASE 驗收證據。歷史上，中斷前只有佇列核心與紅燈測試，不能當成交付。接續本輪已完成 runner／SDK、自查、文件與驗收；上述勾選及驗收復盤是目前狀態，原始失敗仍保留。
