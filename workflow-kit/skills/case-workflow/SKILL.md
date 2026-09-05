---
name: case-workflow
description: Manage an AI agent task from agreed outcome through execution, bounded context, session recovery, optional delegation, and evidence-based delivery. Use for sustained tasks or handoffs that benefit from durable state; do not create task records for an ordinary short answer.
---

# C.A.S.E. 工作流程

目的：在有限 context 與跨 session 下完成使用者要的成果，降低重述、監督及抉擇負擔。文件與工具的維護成本也算成本；不為流程完整而增加工作。

## 先選入口

- 短問答或一次可完成的小修改：直接做，驗證與交付保持相稱；不強制 init。
- 新的持續任務：先確認成果、可觀察的驗收與不能違反的約束；長且相依的工作可分階段接續，可獨立驗收的產物才拆工作包。選最少有用的分工，預設依序執行。
- 需要版本化契約、工作包或 pi 新 session 執行：讀 [v2 契約與接續](references/v2-contracts.md)。pi 安裝 extension 才有 `case_workflow` 與 `/case`；只安裝 skill 不具備自動 session 執行。
- 已有資料先讀 `.case-agent/workflow.json` 的 format：`case-workflow/2` 使用 v2 reference；`case-workflow/1` 使用下列 v1 流程。既有 v1 只有明確升級意圖才 migrate，不自動切換格式。
- v1 接續／即將壓縮 context：讀 [接續與 CLI](references/state-and-resume.md)。
- 需要分工或整合不同意見：讀 [協作與驗收](references/collaboration-and-quality.md)。
- 只有需要額外說明時，從 [範本](assets/task-notes.md) 取所需段落；不要複製整份空表。

## v1 任務記錄的開始與執行

1. 依使用者現有要求建立目標與驗收。已授權的工作自行執行；只有必要資訊、權限或重大取捨缺失才詢問。保持目標的原始意義，避免為容易測量而縮小交付。
2. 若使用 CLI，找到**目前載入這份 SKILL.md 所在的目錄**，以下以 `<skill-dir>` 表示，執行 `node "<skill-dir>/scripts/case.mjs" --help`。不要假設技能在當前專案、某個 home 或固定AI 工具路徑。
3. `init --project "<project>"` 初始化；`new --project "<project>" --title "..." --goal "..." --criterion "..."` 建立任務。多項驗收重複 `--criterion`，約束重複 `--constraint`。保存回傳 task ID。完整命令說明按需讀上面的 CLI reference。
4. 選擇最直接可完成的實作路線。複雜工作以幾個可驗證步驟規劃；一般工作不先產生設計報告。先讀與下一步直接相關的程式／資料，不預載完整歷史。
5. 在有意義的里程碑記錄目前狀態、關鍵觀察及下一個具體動作；大輸出留在檔案並引用路徑。失敗、未知成本及限制照實保留。不要逐次工具呼叫寫日誌。

CLI 需要 Node.js 20+。它保存工作狀態，不執行模型、接管AI 工具或保證 agent 會遵守指引。AI 工具沒有 skill loader 時，可由使用者明確指定讀取此檔；不要宣稱已自動載入。

## v1 Context 與狀態紀律

- 目標、驗收、約束是持續工作的依據；當前摘要是閱讀入口，原始程式、資料與實際驗證才是結果依據。
- 接續先讀 bounded `context`，再按引用讀取必要證據。目標、驗收或約束被截斷時，行動前必須使用 `show` 或核對完整來源；不要猜省略內容，也不把未載入的內容當成不存在。
- 只由一位協調者透過 CLI 修改任務狀態。其他 agent 提交有界結果與指定產物，不同時修改協調者記錄。
- `checkpoint` 是可覆核的接續點，不是AI 工具 context 壓縮指令。寫好後才能依AI 工具既有方法開始新 session／壓縮。
- 不把祕密、完整敏感資料、冗長終端輸出放進摘要；保留適當的受控來源引用。
- 目標或驗收需要改變時明示原因；此版本不提供 amend，建立新任務並在新摘要引用舊 task ID。舊任務仍在 active／blocked 時才補反向引用；已完成的舊紀錄維持原狀，不為補連結而 reopen。不能默改舊標準使任務通過。

## 品質、偏移與完成

在準備擴大範圍、增加依賴／角色、同一問題第二次修補，或準備交付時，判斷「這一步如何幫助原目標？現有證據支持嗎？繼續還是換方法？」把答案用於下一步；只有決策有變才記錄，不設排程或固定討論輪數。

核對每項驗收，執行與變更風險相稱的檢查。v2 的提交、獨立核對與全域整合依 v2 reference 操作。以下完成命令屬 v1：`record` 的 pass 是有來源的觀察，不代表證據內容經 CLI 驗真；不得以測試數或 agent 自述代替成果。需要使用者核准的條件，收到核准才記為 pass。

全部驗收有有效通過觀察後 `finish`。交付成果位置、實際完成與未完成、驗證及必要限制；已授權的交付行動繼續執行。驗收未過就修正或明示阻礙，不能為關閉任務而繞過。完成後發現缺陷用 `reopen --reason` 接續；它重置全部驗收，需重新核對並記錄。重要失敗與證據保存在來源檔，CLI 最近 30 筆事件不是永久歷史。

沒有可用 CLI 時，可在事先確認不衝突的 Markdown 檔保存同樣的目標、驗收、約束、狀態、證據與下一步；由一位協調者編輯。這是人工流程，不宣稱完成 CLI 初始化、鎖定或格式驗證；CLI 恢復後也不要自動覆蓋／匯入人工紀錄。
