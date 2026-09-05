# 分層協作與缺口接續：實作計畫

依據：[使用者確認的修正方向](../research/2026-09-05-layered-cooperation-direction.md)。基準 `ef498a3`；在既有 `feat/case-context-workflow` 工作目錄接續，保留尚未提交的研究記錄。

目標：讓工作者能回報缺口，由規劃者在原授權內修正計畫並接續有效成果；必要材料能按需取得，實際檢查能進入工作流程。不是另建 agent 平台，也不以流程通過宣稱模型效益。

## 全域限制

- 不改 v1 或 M0；不改全域 pi、不建立排程、不自動改模型或上傳資料。
- 目標、驗收、授權與總預算不能由重規劃放寬。未知副作用不自動重播。
- 保留有效且未受影響的核對成果；變更與相依影響保守失效，保留原始嘗試與失敗證據。
- 可攜核心與 pi 自動化分開描述。正體中文為主，英文操作同步；一份權威資料，不另維護 Markdown 狀態副本。
- 測試先行，使用真實檔案及核心，只替換昂貴的模型／SDK 邊界。完整驗證用 `npm test --prefix workflow-kit`。

## Task 1: 有界的計畫修正與回饋接續

修改 `skills/case-workflow/scripts/core/{contracts,state}.mjs`、`integrations/pi/runner.mjs`，新增對應測試（均位於 workflow-kit）。必要可新增同目錄小模組，但不改 store/context/extension/scoped-tools，避免與 Task 2 衝突。

新增核心 `amend_plan` 動作：完整新 packets、reason；契約不變。新增契約可選 `writeScope` 作為授權上限，初次與修正計畫皆不得超出；舊契約未設定時修正上限為原計畫寫入範圍，不能藉重新命名工作包擴權。拒絕仍在 running 或 submitted 的不明副作用；原嘗試、時間／次數預算及計畫變更理由保留。沒有實質變更的修正拒絕。相同語意且來源／成果仍有效的 verified packet 保留；改動、移除、寫入重疊或相依受影響者重新執行，避免只看 ID。舊嘗試不重複計數。新增工作包仍需涵蓋驗收、合法相依與有效來源。可用明確 `rerunPacketIds` 表達整合發現需重做的既有包。

runner 接受 worker `{blocked:{reason}}` 或 `{changeRequest:{reason}}`，先保存並 block 該嘗試，不能當成功提交。blocked 表示需外部資料時停止；changeRequest 交給新 planner context。review 修正達上限、無可執行工作包、全域整合有實質 false 時可交回 planner，不能用格式重試消除 false。planner 使用完整既有計畫的精簡定義、有效狀態與失敗證據，回覆 `{packets,rerunPacketIds,reason}` 或明確 blocked。只由 core 驗證後採用；無變更、不安全範圍、超出總預算停止。既有兩次整合格式更正可保留，但只能更正格式。最多 2 次自動重規劃（跨 run 累計），計入既有 session 總預算，不重設 maxAttempts/maxDurationMs。新 session 不繼承 worker 對話。

紅燈測試涵蓋：補前置後完成；外部缺料不捏造；局部已驗證成果保留；整合 false → 實際重做 → 重新整合；重複無變更停止；權限／驗收／預算不放寬；來源變更及寫入重疊不錯誤保留；中斷未知副作用不得自動接管。現有 runner 測試依新語意更新，保留安全保障。

## Task 2: 必要脈絡與實際檢查接線

主責在 Task 1 同時處理不重疊檔案：`core/context.mjs`、新 `core/project-policy.mjs`、`extension-core.mjs`、必要的 scoped-tools 與新增測試。完成後再串接 store 或 runner 的小介面，避免雙方同時編輯。

專案共識採既有 `.case-agent/workflow.json` 的可選版本化欄位，不增加根目錄檔名；引用既有專案指引的相對路徑及雜湊，保留摘要、限制與修改歷程。建立 case 時繼承快照；來源變動需明示對齊，不能悄悄放寬舊 case。沒有跨任務共識需求時可不設定，不強迫填表。

必要輸入支援 `delivery:"indexed"`：required 仍須存在且驗證來源，但 context 只放版本、用途與路徑，使用現有分段 read 工具取用。預設仍 inline，不靜默截斷規則；規則／共識不能因索引化遺失。

pi 以明確的人類命令信任檢查清單；模型不能自行註冊任意 shell。命令及引數讀入後留在該 extension 記憶體，不修改全域設定。runner 的核對／整合階段由程式執行已授權清單並保存 exit code、stdout、stderr；真實失敗不能被模型 passed 覆蓋。無清單時維持來源／內容核對，明示沒有可執行測試。這不是作業系統 sandbox，信任命令亦包含其執行的專案程式。

## Task 3: 使用旅程、整合驗證與誠實交付

同步根／Kit README、V2、核心參照、READINESS、GUIDE.en、GOALS／STATUS／MAP 中有連動的敘述；歷史研究保留。展示專案共識 → 整體計畫 → 小憲法 → 回饋 → 接續，先說實際使用，再說安裝及版本；移除首頁難懂的歷史階段標題。

跑完整 kit 測試與修改面審閱，修正實際缺陷。使用本機既有模型、隔離 pi 設定執行多來源工作的回饋接續探測；留下設定、輸出、失敗、成本及未測範圍。工程探測與效果比較分開，不能將新的單次結果和舊配對合併算效益。跨工具真實旅程、三組比較若本輪未完成必須列出，不宣稱框架已普遍提升品質。

## 執行記錄

核心、pi 接線及操作文件已實作；完整 kit 測試 110/110 通過，原生 SDK loader 與封裝檢查通過。實測促成結構化回報及從真實工具產生的能力資訊，但四次本機探測均未完成任務，因此效果驗收未通過，不合併為已完成產品。完整失敗、成本與下一步判斷見[實作報告](../evaluation/case-feedback-report.md)。此計畫仍可依證據修正；不新增固定角色、會議輪數或排程。
