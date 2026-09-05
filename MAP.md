# 文件地圖

先讀 [README](README.md)。實際採用以 [Workflow Kit](workflow-kit/README.md) 為入口；下面的 M0 設計、計畫與測試是歷史研究，無需先讀才能使用。按目的載入，不預載完整 repository。

| 目的 | 入口 | 內容與權威範圍 |
|---|---|---|
| 直接採用完整工作流程 | [套件](workflow-kit/README.md)、[實例](workflow-kit/docs/WORKFLOW.md)、[宿主](workflow-kit/docs/HOSTS.md) | 初始化、接續、分工、驗收與使用入口 |
| 功能與實測狀態 | [READINESS](workflow-kit/docs/READINESS.md) | 已交付能力與實測／未測範圍 |
| 對齊目標、避免偏移 | [目標](docs/GOALS.md) | 完整交付範圍與工作判斷；沒有排程 |
| 確認能用到哪裡、下一步 | [狀態與路線](docs/STATUS.md) | 當前可用性、尚未通過的門檻 |
| 接手開發與驗證 | [CONTRIBUTING](CONTRIBUTING.md) | 環境、指令、修改與證據規則 |
| 判斷修改的連動範圍 | [維護關聯](docs/MAINTENANCE.md) | 主要定義、程式／文件／範本／翻譯同步及臺灣用語 |
| 理解目前架構與用語 | [Kit 架構](workflow-kit/docs/ARCHITECTURE.md) | 目前產品的責任邊界、資料與術語 |
| 取用工作範本 | [範本入口](workflow-kit/docs/TEMPLATES.md) | 任務補充、工作包、回報與交付，不強制填表 |
| English user guide | [Guide](workflow-kit/docs/GUIDE.en.md) | Installation, workflow, recovery and maintenance |
| 查舊 M0 用語與取捨 | [CONTEXT](CONTEXT.md)、[分層](docs/adr/0001-layered-protocol-boundary.md)、[命名空間](docs/adr/0002-fixed-project-namespace.md)、[品質與負擔](docs/adr/0003-quality-per-unit-of-burden.md)、[技術選型](docs/adr/0004-node24-typescript-cli.md) | 歷史 M0 範圍，不是 Kit 操作規則 |
| 實作或查規格 | [M0 規格](docs/superpowers/specs/2026-09-04-local-dossier-integrity-design.md) | 規範性行為；schemas 與 conformance 必須對齊 |
| 查任務拆解 | [M0 實作計畫](docs/superpowers/plans/2026-09-04-m0-local-dossier-integrity.md) | 歷史執行計畫；進度以結果與帳本為準 |
| 了解效果證據 | [基準報告](docs/evaluation/m0-baseline-report.md)、[復盤](docs/evaluation/m0-retrospective.md) | 方法、結果、無效樣本與適用限制 |
| 查設計演進 | [探索紀錄](docs/design/2026-09-04-case-agent-protocol-discovery.md) | 按日期保留推論；早期段落不代表現況 |
| 查先前研究 | [跨平台封裝](docs/research/2026-09-04-cross-platform-packaging.md)、[MECE-Autopilot](docs/research/2026-09-04-mece-autopilot-fit.md) | 研究來源與當時的評估 |
| 查完整審閱與裁定 | [進度帳本](.superpowers/sdd/2026-09-04-m0-local-dossier-integrity/progress.md)、[最終報告](.superpowers/sdd/2026-09-04-m0-local-dossier-integrity/task-12-report.md) | 原始工作脈絡及 45 條裁定 |

目前產品：`workflow-kit/install.mjs` 安裝技能；`workflow-kit/skills/case-workflow/SKILL.md` 指導工作；其 `scripts/case.mjs` 保存任務狀態；`references/`、`assets/` 按需提供說明及範本；`workflow-kit/tests/` 驗證操作。

舊 M0 程式路徑：根目錄 `src/`、`schemas/`、`tests/`、`conformance/` 與 `evaluation/markdown-baseline/`，保留研究實作、規範與結果，不是 Kit 的依賴。

本頁就是隨版本維護的 repo 內 Wiki 首頁；不另維護可能不同步的 GitHub Wiki 副本。

規格、實作與測試若不一致，應記錄並修正差異，不能僅以測試通過推定規格正確。更新現況時同步維護 README 與狀態頁；保留歷史結果並附修正說明。
