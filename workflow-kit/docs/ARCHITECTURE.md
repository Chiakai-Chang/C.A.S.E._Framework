# 架構與用語

本頁只描述 Workflow Kit；根目錄 M0 的 revision、submission、accept 等規則不適用。先使用 [完整例子](WORKFLOW.md)，需要理解責任或接手開發時再讀本頁。

## 四個部分各做什麼

| 部分 | 負責 | 不負責 |
|---|---|---|
| AI 工具：pi、Codex、Claude 等 | 模型、工具權限、session、可用的 subagent | 不由 Kit 更換模型或接管設定 |
| Skill 與按需 references | 需求理解、讀取範圍、工作方法、分工與成果判斷 | 不是強制執行或安全隔離 |
| 本地 CLI | 初始化、結構驗證、任務狀態、精簡接續、驗收記錄 | 不呼叫模型、不執行測試、不驗真證據 |
| Installer | 專案級技能安裝、更新、備份、移除 | 不修改全域設定、不刪任務、不自動遷移 M0 |

表中的 Installer 是套件內進階安裝器。一般使用者改用既有 Skills 工具安裝同一份技能；它的路徑、更新與移除以自身規則為準，不繼承此表的備份承諾。見 [安裝指南](HOSTS.md)。

使用者給需求 → agent 按技能執行實際工作 → CLI 保存必要狀態 → 新 session／另一AI 工具讀狀態及來源 → 繼續工作與交付。產物仍存於原專案，不塞進任務摘要。

## 安裝與資料

```text
採用者專案/
  .agents/skills/case-workflow/  pi／Codex 共用技能
  .claude/skills/case-workflow/ Claude 技能（選裝）
  .case-agent/
    workflow.json              Kit 格式與歸屬標記
    tasks/<UUID>.json          每個任務的狀態
  原有程式、文件與測試           實際成果及證據來源
```

安裝不等於 init：installer 只放技能，agent 在值得持續追蹤的任務才初始化資料。工具沒有 runtime 依賴，需 Node.js 20+。技能安裝後包含 scripts、references、assets，不依賴原 framework repository。

Antigravity 的當前標準路徑亦為 `.agents/skills`，相容範圍見 [HOSTS](HOSTS.md)。不同AI 工具分享同一 project 和 task ID，並非自動互傳訊息或同時協調執行。

## 目前產品的詞彙

| 名稱 | 在 Kit 中的確切意思 |
|---|---|
| 任務／卷宗（task） | 一個目標、約束、驗收及工作狀態，由 UUID 識別；不是聊天 session |
| 協調者 | 唯一更新任務記錄的人或 agent；由工作分工約定，非身分認證 |
| checkpoint | 保存摘要、下一步及 active／blocked 狀態，不替AI 工具壓縮 context |
| context | 有長度限制的接續視圖；有截斷警示時先用 show 補讀 |
| handoff | 記錄接手對象、摘要與下一步；不發訊息、不要求協議式 accept |
| evidence | 已觀察結果及可追溯來源的文字；CLI 不判斷內容真偽 |
| finish | 所有條件已記錄 pass 才設為完成；不代表獨立審查或人類批准 |
| reopen | 因缺陷重新開案，重置驗收，要求重新核對 |

## 狀態與責任

新任務為 active；遇阻礙可 checkpoint 為 blocked，解除後可回到 active。所有條件通過才 finish；完成後修改需 reopen。目標變更建立新任務，引用舊 ID，不改寫舊驗收讓它通過。

Workers 回報指定產物與證據，協調者核對後更新資料。交接前停止原寫者；寫入鎖只是合作式衝突防護，不是多機協作系統。單欄文字上限 2,000 字元、約束與驗收各最多 20 項；最近 30 筆事件不是永久歷史，重要決策與證據留在來源檔。

## 開發者入口

`install.mjs` 管安裝；`skills/case-workflow/scripts/case.mjs` 管任務；`tests/install.test.mjs`、`workflow.test.mjs`、`journey.test.mjs` 分別驗證安裝、狀態及安裝後接續。修改 Kit 跑 `node --test workflow-kit/tests/install.test.mjs workflow-kit/tests/workflow.test.mjs workflow-kit/tests/journey.test.mjs`（repository 根目錄）。只有改 M0 才需要舊完整套件。
