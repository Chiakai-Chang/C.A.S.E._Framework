# 維護關聯與語言原則

目的：接手者先知道修改會影響哪裡，避免程式、技能、文件和翻譯各自演進。這是導航，不是新增審批流程；只處理本次真正受影響的項目。

## 語言與主要定義

主要文件採臺灣慣用的正體中文（zh-TW）：使用「專案、檔案、資料夾、資訊、軟體、程式碼、設定、預設、建立、支援、品質、使用者、相依套件」等用語。保留 pi、Codex、Claude Code 等產品名稱及必要技術名稱；首次出現時可加中文說明。

命令、旗標、JSON 欄位、格式識別碼及檔名是介面，不因翻譯而改名。中文文件沿用現有路徑，不為語系重新搬動整個專案。其他語言以 `GUIDE.en.md` 等清楚標記，從 README 互相導航；新增語言不複製一套程式或資料規格。

目前英文指南對應 Kit README、HOSTS、WORKFLOW、ARCHITECTURE、TEMPLATES 與 READINESS 中的使用說明，不是歷史研究的完整翻譯。技術內容必須一致，無需逐句直譯。翻譯若未同步，明確標記缺漏並連到最新中文來源，不讓過期說明冒充現況。

發生衝突時：使用者已確認的目標以 [GOALS](GOALS.md) 為準；程式描述目前實際行為，文件描述應有用途，兩者不一致要確認並修正，不能直接認定任一方永遠正確。[READINESS](../workflow-kit/docs/READINESS.md) 是實測範圍的集中記錄，翻譯不得擴大宣稱。舊 M0 規格只管 M0。

## 修改影響對照

以下路徑除特別標示外，以 `workflow-kit/` 為起點。

| 修改內容／主要位置 | 必須檢視的連動位置 | 相稱驗證 |
|---|---|---|
| 目標、交付邊界：根目錄 `docs/GOALS.md` | 根 README、STATUS、MAP；Kit README、ARCHITECTURE、技能入口 | 確認是否改變使用承諾，不拿舊計畫當新需求 |
| 任務命令、欄位、狀態：`skills/case-workflow/scripts/case.mjs` | 程式 help、`references/state-and-resume.md`、SKILL、README、WORKFLOW、ARCHITECTURE、GUIDE.en | workflow 與 journey 測試；成功、失敗及接續行為 |
| 安裝位置、更新、移除：`install.mjs` | help、HOSTS、兩份 README、GUIDE.en、ARCHITECTURE、封裝設定 | install 與 journey 測試；共用目錄、備份及既有檔案保留 |
| 工作方法、分工、驗收：`skills/case-workflow/SKILL.md` 與 `references/` | `assets/task-notes.md`、WORKFLOW、TEMPLATES、GUIDE.en；涉及新命令時回查 CLI | 技能與情境核對；工具行為變更才增加對應測試 |
| 範本：`skills/case-workflow/assets/task-notes.md` | TEMPLATES、協作 reference、WORKFLOW、英文範本段落 | 欄位與工具能力一致，不強制重複記錄 |
| 宿主支援與測試證據：HOSTS、READINESS | README、GUIDE.en、根 STATUS；改路徑時回查 installer | 官方來源與實際結果分開，未測不寫通過 |
| 檔案新增、移動或刪除 | 根 MAP、引用連結、兩份 README、`package.json` 的 files；必要時 CI 路徑 | 連結、封裝內容；技能安裝後的相對路徑仍可用 |
| 支援環境／封裝：`package.json` | README、HOSTS、READINESS、根 CONTRIBUTING、`.github/workflows/workflow-kit.yml` | 執行受影響環境測試；設定不等於已實測 |
| 使用文件的技術敘述 | GUIDE.en 的對應主題與其他語言版本 | 語意、命令、限制一致；純中文用字修正不必更動英文 |

## 每次修改的實際做法

先從 MAP 找入口，再以檔名、命令或術語搜尋引用，閱讀必要實作與測試；上表是起點，不取代實際搜尋。完成修改後核對受影響文件與翻譯，再執行相稱驗證。交付時簡述修改與證據即可，不另產生一份例行稽核報告。

Kit 變更跑 `node --test workflow-kit/tests/*.test.mjs`；純文件小修核對來源、連結與命令。若交付壓縮套件，從最新內容重新打包，避免下載檔仍是舊版。只有觸及 M0 才跑 M0 完整套件。保留歷史記錄與原始證據，不為符合新文字而覆寫舊結果。

新增模組、語言或改變責任邊界時更新本表與 MAP。沒有關聯的文件不必為了「同步」而改動；不新增排程或固定審閱輪數。
