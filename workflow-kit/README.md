# C.A.S.E. Workflow Kit 1.0

完整 agent 工作流程：需求、執行、有限 context、跨 session、分工、驗收與交付。Agent Skills 格式搭配零相依 Node.js 工具，不依賴 M0 的 adapter。

簡單說：agent 把目標、不能違反的限制、目前結果與下一步保存在專案裡，換對話後不必只靠聊天記憶接續。與普通 TODO 相比，額外提供固定資料欄位、精簡接續輸出及驗收記錄檢查；代價是需要維護記錄，短工作通常不必使用。

工作方法由技能指引，資料由本地工具保存；模型、工具權限及真正的工作仍由 pi、Codex 等提供。程式測試已驗證操作與接續，但不能因此宣稱普遍改善模型品質或節省 token。[設計與邊界](docs/ARCHITECTURE.md) · [具體工作例](docs/WORKFLOW.md) · [可信範圍](docs/READINESS.md)

## 安裝

文件導航：[English guide](docs/GUIDE.en.md) · [完整例子](docs/WORKFLOW.md) · [架構與用語](docs/ARCHITECTURE.md) · [可取用範本](docs/TEMPLATES.md) · [AI 工具與疑難排解](docs/HOSTS.md) · [驗證範圍](docs/READINESS.md)。

一般使用者請在工作專案使用現成的技能安裝器（Node.js 20+、Git）：

```text
npx skills add https://github.com/Chiakai-Chang/C.A.S.E._Framework/tree/main/workflow-kit/skills/case-workflow --copy
```

選擇 AI 工具，以專案範圍安裝；更新與移除交給同一工具。來源、差異與驗證見 [安裝指南](docs/HOSTS.md)。以下是已下載本套件後的進階／離線安裝方式，不是主要上手入口。

從本目錄執行：

```text
node install.mjs --project "D:/Projects/MyProject" --host pi
```

可選 pi、codex、claude、all。pi／Codex 共用 `.agents/skills/case-workflow/`，Claude 使用 `.claude/skills/case-workflow/`。在目標專案使用 pi 的 `/skill:case-workflow`、Codex 的 `$case-workflow` 或 Claude 的 `/case-workflow`，附上工作要求。

見 [AI 工具與更新／移除](docs/HOSTS.md)。技能包含需要的 scripts、references、assets，安裝後不需原 repository 或網路即可執行本地工具。pi 也可由 package loader 使用本目錄的 `pi.skills` 清單；專案安裝器是主要驗證路徑。

## 手動操作

可不安裝，直接從本目錄使用工具。project 換成存在的目錄；task ID 使用 `new` 回傳值。

```text
node skills/case-workflow/scripts/case.mjs init --project "D:/Projects/MyProject"
node skills/case-workflow/scripts/case.mjs new --project "D:/Projects/MyProject" --title "修正匯出" --goal "CSV 正確處理逗號" --criterion "逗號案例通過" --constraint "保留欄位順序"
node skills/case-workflow/scripts/case.mjs list --project "D:/Projects/MyProject"
node skills/case-workflow/scripts/case.mjs checkpoint --project "D:/Projects/MyProject" --task "<id>" --summary "已定位 export 函式" --next "修改引號處理並執行相關測試"
node skills/case-workflow/scripts/case.mjs context --project "D:/Projects/MyProject" --task "<id>"
```

完成實際修改和驗證才能 record pass。以下 evidence 須替換成真正觀察到的來源和結果：

```text
node skills/case-workflow/scripts/case.mjs record --project "D:/Projects/MyProject" --task "<id>" --criterion 1 --result pass --evidence "tests/export.test.js：逗號案例已執行且通過"
node skills/case-workflow/scripts/case.mjs finish --project "D:/Projects/MyProject" --task "<id>" --summary "CSV 逗號修正並通過驗收"
node skills/case-workflow/scripts/case.mjs doctor --project "D:/Projects/MyProject"
```

所有 criteria 都需 recorded pass，否則 finish 失敗。CLI 不替你執行測試或驗真證據。失敗、handoff、reopen 與分工見 [完整實例](docs/WORKFLOW.md)。

## 資料與限制

資料只在 `.case-agent/workflow.json` 與 `.case-agent/tasks/<id>.json`。context 是精簡視圖，show 是完整當前狀態；事件只留最近 30 筆。重要證據留在來源檔，不把事件當永久稽核。文字欄位最多 2,000 字元、驗收與約束各最多 20 項；大量內容以引用保存。

只由一名協調者更新任務，worker 回傳產物後由協調者整合。CLI 有合作式寫入鎖，不提供多機同步、強身分認證、秘密掃描、不可竄改稽核或斷電恢復。handoff 不發訊息，checkpoint 不自動 compact，finish 不冒充人類批准。

BUSY 時先確認工作是否仍在進行。只有全部寫者停止且資料檢查後，才由人處理遺留 `.write-lock`。部分初始化、foreign namespace 或格式損壞會停止；先備份查明，不自動覆蓋或把舊 M0 匯入。勿在同步目錄／不同機器同時寫入。

技能移除保留任務資料及安裝備份；自訂安裝不被覆蓋。資料可能敏感，是否提交版本控制由專案決定。

## 驗證與打包

```text
node --test tests/install.test.mjs tests/workflow.test.mjs tests/journey.test.mjs
npm pack --dry-run
```

不需 npm install。封裝含 skills、installer、README、docs 與 package metadata，不含 tests、模型、依賴、任務資料或快取。見 [功能與驗證範圍](docs/READINESS.md)。package 目前 private，授權及 registry 發布尚未決定。
