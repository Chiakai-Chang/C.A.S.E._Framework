# C.A.S.E. Framework

**讓 AI 工作能接續、能核對，不必每換一段對話就重新交代。**

C.A.S.E. 是給 pi、Codex、Claude Code 等 AI 工具使用的「工作方法＋本地任務記錄工具」。你照常交代工作，agent 依技能整理目標、保存進度、核對成果；換對話或換工具後，能從專案中的記錄接續。它不是另一個模型、聊天介面，也不會自動指揮不同產品互相派工。

Portable workflow skill and dependency-free local task tools for Pi, Codex and Claude Code. Supports task setup, bounded context, session recovery, delegation guidance, evidence tracking and delivery. Model quality and cost improvements remain empirical questions.

## 解決什麼問題？

當一項工作跨越多段對話、需要分工，或中途被打斷時，重要資訊容易散落在聊天裡：原本不能改什麼、哪個測試失敗、目前改到哪裡，以及「完成」究竟要符合哪些條件。

C.A.S.E. 把這些資訊保存在專案裡，而不是只依靠模型記住對話。它的目標是減少重述、重做與漏驗收；**目前已驗證記錄與接續機制，尚未證明所有模型使用後都會更好或更省 token。**

適合長任務、中斷後接續、分工整合及需要驗收的修改。短問答、單次小修改通常直接做即可；若你現有的專案筆記已足夠，也不必多加一層流程。

## 實際怎麼用？

例如，你請 agent：「修好 CSV 匯出，逗號、引號、換行都要正確，不能改欄位順序，並補使用說明。」

1. **開始：** agent 從需求整理目標、限制與驗收條件，不讓你再填一張表。
2. **執行：** agent 修改程式、執行相關測試；把「空資料案例失敗、文件還沒改」記成目前狀態，留下來源及下一步。
3. **接續：** 新對話先讀精簡任務記錄，再查看相關程式與測試；摘要有截斷時先補讀，不猜省略內容。
4. **交付：** agent 實際核對每項驗收，記錄證據後結案。發現缺陷可重新開案，舊的通過記錄不直接沿用。

這是操作示例，不是已執行的模型效果實驗。[完整範例與指令](workflow-kit/docs/WORKFLOW.md)

## 有哪些實質設計？

| 設計 | 為什麼這樣做 | 代價或邊界 |
|---|---|---|
| 任務狀態存檔，不綁聊天記錄 | 換對話、換工具仍能找到目標與下一步 | 仍需讀原始產物，摘要不保證永遠正確 |
| 精簡接續內容＋按需讀來源 | 不必把所有歷史一直塞進 context | 太長的欄位會截斷，必須補讀；不是自動壓縮模型記憶 |
| 有驗收條件才能記錄完成 | 把「說做完了」改成逐項對照成果 | 工具檢查記錄是否齊全，不判斷證據真偽 |
| 重新開案會重置驗收 | 避免修改後仍拿舊的通過結果交差 | 需要重新核對各條件 |
| 一位主責 agent 整合分工 | 避免多個 agent 同時改任務狀態、互相覆蓋 | 不提供跨產品自動派工或多機同時寫入 |
| 技能與本地工具分開 | 工作方法可調整，資料操作保持一致；沿用既有 AI 工具 | agent 是否遵循技能，仍取決於模型及執行環境 |
| 短任務不強制建檔 | 不讓管理流程比工作本身還重 | 是否值得建任務需依情境判斷 |

這些設計不是宣稱發明全新的技術，而是把專案筆記、交接、驗收與按需讀取組成一套可重複使用的做法。[架構與責任邊界](workflow-kit/docs/ARCHITECTURE.md)

## 和一份 TODO／提示詞有什麼差別？

TODO 或 Markdown 筆記本來就能保存脈絡；CASE 的額外價值是提供一致的欄位、可執行的任務操作、精簡接續輸出，以及拒絕缺驗收結案的檢查。**不是讓記錄變神奇，而是減少每次重新設計記錄方式的成本。**

代價是需要 Node.js，agent 也要花時間維護記錄。因此真正應比較的是「少掉的重述、重做、遺漏」是否大於記錄成本，而不是文件多寡或測試數。

## 可以相信到什麼程度？

- **可查看實作：** 核心只有 [技能](workflow-kit/skills/case-workflow/SKILL.md)、[任務工具](workflow-kit/skills/case-workflow/scripts/case.mjs)及必要的參考資料；本地任務工具不需 API key 或伺服器。
- **已有操作證據：** 任務建立、失敗保存、獨立程序接續、驗收、重開及安裝移除有測試；[Windows／Linux／macOS × Node 20／24 六組 CI 已通過](https://github.com/Chiakai-Chang/C.A.S.E._Framework/actions/runs/33968299883)。
- **不擴大解讀：** CI 驗證的是程式操作，不是模型是否理解需求，更不是品質或成本改善的對照實驗。安裝成功也不等於所有 AI 工具已跑過完整任務。
- **權限仍要留意：** 技能能引導 agent 使用它已有的工具；CASE 不是安全隔離。任務資料存在本機，但 agent 讀到的內容仍可能送往你設定的模型服務。

失敗記錄、安裝實測及未驗證範圍見 [驗證說明](workflow-kit/docs/READINESS.md)。公開授權尚未選定，請勿把可見的 repository 當作已授予開源使用權。

## 開始使用

先準備 Node.js 20+、Git 與你使用的 AI 工具。在實際工作的專案資料夾執行：

```text
npx skills add https://github.com/Chiakai-Chang/C.A.S.E._Framework/tree/main/workflow-kit/skills/case-workflow --copy
```

依提示選擇正在使用的 AI 工具，採專案範圍安裝（不加 `--global`）。這是 [Vercel Labs Skills](https://github.com/vercel-labs/skills) 提供的現成安裝器，不是 CASE 自製指令；`--copy` 使用一般檔案，避免 Windows 符號連結權限差異。安裝前請先查看技能內容，AI 工具原有權限仍適用。

從 GitHub 安裝的流程已在隔離專案驗證；不等於各工具的模型行為均已實測。更新、移除、pi 原生套件及離線方式見 [安裝指南](workflow-kit/docs/HOSTS.md)。

在目標專案啟動或重新載入 agent：

| Agent | 使用方式 |
|---|---|
| pi | `/skill:case-workflow 請完成……，驗收條件是……` |
| Codex | `$case-workflow 請完成……，驗收條件是……` |
| Claude Code | `/case-workflow 請完成……，驗收條件是……` |

若技能未載入，明確請 agent 讀取安裝位置的 SKILL.md。專案信任、權限及設定仍由你使用的 AI 工具控制，見 [安裝說明](workflow-kit/docs/HOSTS.md)。

## 文件入口

以臺灣慣用的正體中文為主要版本，另提供英文指南。維護時按 [修改關聯](docs/MAINTENANCE.md) 同步相關文件與翻譯；命令、路徑和資料格式保持一致。

- [English guide](workflow-kit/docs/GUIDE.en.md)
- [架構與用語](workflow-kit/docs/ARCHITECTURE.md) · [範本入口](workflow-kit/docs/TEMPLATES.md)
- [套件使用與手動指令](workflow-kit/README.md)
- [完整操作實例](workflow-kit/docs/WORKFLOW.md)
- [安裝、更新、移除及疑難排解](workflow-kit/docs/HOSTS.md)
- [功能覆蓋與驗證範圍](workflow-kit/docs/READINESS.md)
- [目標](docs/GOALS.md) · [現況](docs/STATUS.md) · [貢獻方式](CONTRIBUTING.md) · [全域地圖](MAP.md)

## 舊 M0 與發布

[MAP.md](MAP.md) 是隨程式版本維護的 Wiki 首頁，不另維護 GitHub Wiki 副本。新使用者只需本頁與操作實例；歷史研究無需預讀。

Antigravity（agy）可在上述安裝器選擇，不需冒用 `codex` 選項。平台差異與驗證範圍見 [安裝指南](workflow-kit/docs/HOSTS.md)。

`workflow-kit/` 是目前產品；根目錄 `src/`、`conformance/` 與 `evaluation/markdown-baseline/` 保留 M0 完整性研究。格式不同，既有 `.case-agent/` 的衝突會被拒絕，不自動遷移或覆蓋。

舊 M0 production adapter 仍未支援；不要用根目錄的 `case-agent init` 作為 Workflow Kit 入口。見 [M0 參考](docs/M0-REFERENCE.md)。

公開授權尚未選定，npm package 保持 private，未發布 registry。程式可本地使用與驗證；授權與正式發布由擁有者決定。
