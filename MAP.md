# 文件地圖

先讀 [README](README.md)。實際採用以 [Workflow Kit](workflow-kit/README.md) 為入口；下面的 M0 設計、計畫與測試是歷史研究，無需先讀才能使用。按目的載入，不預載完整 repository。

| 目的 | 入口 | 內容與權威範圍 |
|---|---|---|
| 最新不同任務的假完成反例 | [整案結果與根因追查](docs/evaluation/2026-09-11-holdout-journey-report.md) | 完成標記與錯誤成果分開；有效引用仍漏驗，舊雜湊重現待查；完整成本及證據保留 |
| 核對引用的可信邊界與成本 | [引用解析及復盤](docs/evaluation/2026-09-11-receipt-review-report.md) | 模型選回條 ID、程式解析來源；單獨模型正反判斷及重讀成本，不代替普遍可靠度 |
| 執行者讀過卻寫錯 | [來源使用診斷](docs/evaluation/2026-09-11-worker-grounding-report.md) | 26 次來源回傳核實、角色混淆時序、直接交辦診斷與正式呈現接線；不以單獨成功代替整案驗收 |
| 初始交辦與規劃品質 | [初始規劃實測](docs/evaluation/2026-09-11-initial-planning-report.md) | 初始／回饋角色分流；兩次計畫的格式修復、冗餘核對包與文字矛盾，及原預算接續 |
| 核對、停止修復與交辦瓶頸 | [核對格式與證據缺口](docs/evaluation/2026-09-11-review-boundary-report.md) | 匯入成果診斷完成核對／整合；正常流程仍止於規劃查讀，未交辦。新舊成本與限制分列 |
| 返修為何破壞原本正確內容 | [局部返修與完整脈絡](docs/evaluation/2026-09-10-localized-repair-report.md) | 正常流程返修引入缺漏；新增受限 case_edit，局部模型修復成功，整案仍未通過 |
| 定位執行停滯與精簡交辦效果 | [單獨執行與索引交辦](docs/evaluation/2026-09-10-worker-focus-report.md) | 四次診斷含成功與失敗；完整成果單獨執行成功不等於完整協作通過，不把變動預算／檢查混算因果 |
| 查看最新角色／搜尋／壓縮與正常任務 | [實測與裁定](docs/evaluation/2026-09-10-search-and-role-report.md) | 壓縮完成且輸出額度恢復，約 602 秒取消仍未產出；前次約 332 秒失敗另存，不混算 |
| 查看 9/10 受控異議失敗 | [受控診斷與裁定](docs/evaluation/2026-09-10-controlled-dispute-report.md) | 約 422 秒未通過；成果保留，planner 格式／來源判斷失敗；當時角色指引缺口的依據，不取代後續正常任務結果 |
| 核對 9/10 已保存成果與目標關聯 | [結果與復盤](docs/evaluation/2026-09-10-dispute-review-report.md) | 一般核對通過、異議未觸發；工程與封裝結果、成本及限制分開 |
| 中斷後如何接續與收斂交付 | [接續計畫](docs/superpowers/plans/2026-09-10-recovery-and-delivery.md) | 先保存證據、分開收尾與權限問題，再補異議診斷、正常旅程及使用文件 |
| 拒絕混合規劃回覆、處理錯誤審查 | [介面修正與異議設計](docs/design/2026-09-10-review-dispute-boundary.md) | 異議資料、權限、一次重核與中斷接續設計；目前工程及模型結果見 READINESS，不以設計代替驗證 |
| 修復後為何仍無法結案 | [核對分歧與復盤](docs/evaluation/2026-09-09-repaired-review-report.md) | reviewer 通過，integrator 誤判、planner 錯誤受阻；當時成果仍正確但未結案；後續異議實作與診斷見 READINESS |
| 選擇明確修復的執行設定 | [思考開關對照](docs/evaluation/2026-09-09-repair-thinking-report.md) | off／medium 均修好；單次 132／458 秒，不外推所有任務 |
| 接續驗證既有核對與修復 | [9/9 修復旅程](docs/evaluation/2026-09-09-review-repair-report.md) | reviewer 找出缺欄，worker 未寫入即逾時；不等於整案完成 |
| 改善漏驗、修復與驗收負擔 | [復盤與建議](docs/research/2026-09-08-acceptance-improvement-review.md)、[一手來源](docs/research/2026-09-08-acceptance-feedback-sources.md) | 先驗既有 reviewer／repair，再比較結構檢查；研究方案非已實作能力 |
| 規劃是否提前解題、執行是否重讀或漏驗 | [交辦分界修正與實測](docs/evaluation/2026-09-08-planning-handoff-report.md) | 材料概況、交辦分界、SDK 接線及單獨 worker 重播；保留失敗與驗收限制 |
| 回查讀取回條與未產出診斷 | [驗證與復盤](docs/evaluation/2026-09-06-read-receipt-report.md)、[執行計畫](docs/design/2026-09-06-read-receipt-implementation.md)、[修正設計](docs/design/2026-09-06-stalled-execution-resolution.md)、[審閱裁定](docs/design/2026-09-06-stalled-execution-review.md)、[一手來源](docs/research/2026-09-06-stalled-execution-sources.md) | 讀取語意、context／trace 邊界與有限對照；工程修正與模型效果分開，不宣稱唯一根因 |
| 查看預覽版交付與升級 | [版本紀錄](CHANGELOG.md)、[採用與發布核對](docs/evaluation/2026-09-06-preview-release-checks.md)、[本輪交付計畫](docs/design/2026-09-06-preview-release-plan.md) | 安裝、獨立審閱、Git 交付與授權界線 |
| 比較真實專案資訊整理 | [結果與復盤](docs/evaluation/2026-09-06-real-task-report.md)、[事前設計](docs/evaluation/2026-09-06-real-task-plan.md)、[原始證據](docs/evaluation/2026-09-06-real-task-evidence.json) | 相同凍結來源，一般 pi 原生工具與 CASE 兩組均失敗；沒有顯示品質優勢，不追加抽樣美化結果 |
| 採用 pi v2 工作流程 | [v2 指南](workflow-kit/docs/V2.md)、[安裝](workflow-kit/docs/HOSTS.md)、[套件](workflow-kit/README.md) | 2.0.0-preview.1 核心與原生 runner 已實作；Git 交付見 STATUS，實測另列 |
| 使用 v1 任務記錄 | [實例](workflow-kit/docs/WORKFLOW.md)、[接續參照](workflow-kit/skills/case-workflow/references/state-and-resume.md) | 保留既有公開版本，與 v2 不混用命令或資料 |
| 理解原始構想與重構方向 | [大小憲法與 context 分離](docs/design/2026-09-05-constitution-context-reconstruction.md) | 使用者目標、成立條件、差距與下一步；效果待驗證 |
| 接續執行中發現、補包與自查 | [需求追蹤與設計](docs/design/2026-09-06-discovery-and-repair.md)、[程式交付](docs/design/2026-09-06-discovery-runtime-report.md)、[動態回饋來源](docs/research/2026-09-06-dynamic-work-discovery-sources.md) | 持久待辦、同回合修復、局部等待與有界索引已實作；程式測試與真實模型結果分開 |
| 核對最新生命週期驗收 | [驗收及復盤](docs/evaluation/case-discovery-repair-report.md)、[公開證據](docs/evaluation/case-discovery-repair-evidence.json) | 169 項回歸；即時新增工作與同 context 修復的本機模型流程完整通過，所有失敗及成本保留 |
| 核對使用者補充的意圖／Skills 參考 | [三份來源與貼文整合](docs/research/2026-09-06-user-reference-synthesis.md)、[指引技術核對](docs/research/2026-09-06-instruction-skill-source-check.md) | 借用協作概念、不綁 GitHub；官方方法、社群建議與 CASE 推論分開 |
| 研究如何補回完整分層協作 | [修正方向](docs/research/2026-09-05-layered-cooperation-direction.md)、[一手來源](docs/research/2026-09-05-layered-cooperation-sources.md) | 原始版本對照、保留與補齊建議；歷史研究提案，後續實作與限制見下列 |
| 核對分層回饋實測 | [實作與失敗報告](docs/evaluation/case-feedback-report.md)、[證據](docs/evaluation/case-feedback-development-evidence.json) | 110 項測試通過，四次本機模型探測失敗；機制與效果分開判讀 |
| 接續核心修復與實測 | [修復報告](docs/evaluation/case-core-repair-report.md)、[先前證據](docs/evaluation/case-core-repair-evidence.json)、[接續證據](docs/evaluation/case-core-repair-followup-evidence.json) | 119 項回歸測試；第 14–15 次同版整案連續通過，所有失敗仍保留，不等於普遍可靠度 |
| 判讀模型快取是否造成循環 | [recurrent／MTP 查核](docs/research/2026-09-06-recurrent-cache-triage.md) | 本機版本、上游修正與 cache 對照限制；未證實為本機根因，不改現用模型服務 |
| 診斷核心失敗與本機 pi 異常 | [環境與接線查核](docs/research/2026-09-06-core-failure-triage.md)、[工具協定查證](docs/research/2026-09-06-tool-calling-compatibility.md) | 全域安裝缺檔與隔離探測分開；先對齊提示／設定，重複讀取根因尚待驗證 |
| 核對 pi 重建與本機模型接線 | [重建與真實工具驗證](docs/research/2026-09-06-pi-clean-rebuild.md) | 安裝已修復；保留心算失敗與程式計算成功，不等同 CASE 驗收；備份未刪除 |
| 接續分層回饋實作 | [計畫與記錄](docs/design/2026-09-05-feedback-implementation.md) | 專案共識、計畫修正、必要材料與實際檢查；現行操作見 V2／技能參照，實測見 READINESS |
| 接手 v2 設計與實作 | [完整解決方案](docs/design/2026-09-05-case-solution-design.md)、[實作計畫](docs/design/2026-09-05-case-implementation.md)、[核心結果](docs/design/2026-09-05-core-implementation-report.md) | 設計與當時紀錄；目前能力以程式、V2／READINESS 為準，不把設計當效果證據 |
| 判斷技能與框架的效益依據 | [價值與證據](docs/research/2026-09-05-case-value-evidence.md) | 原始研究來源、限制與比較方法，不是本專案效果結果 |
| 比較 context 管理與分工方案 | [研究與替代方案](docs/research/2026-09-05-context-isolation-alternatives.md) | 強模型的限制、分工反例、按需讀取、壓縮及 RLM；不預設多代理較好 |
| 功能與實測狀態 | [READINESS](workflow-kit/docs/READINESS.md) | 已交付能力與實測／未測範圍 |
| 查 v2 本地模型結果 | [開發驗證](docs/evaluation/case-v2-local-report.md) | 全部開發配對、失敗與原始紀錄；修正前後不是固定版本效果統計 |
| 查本次交付驗收 | [驗收](docs/ACCEPTANCE.md) | 目標對照、結果及未證明範圍 |
| 對齊目標、避免偏移 | [目標](docs/GOALS.md) | 完整交付範圍與工作判斷；沒有排程 |
| 驗收分工是否值得成本 | [比較結果](docs/evaluation/case-value-validation-report.md)、[證據](docs/evaluation/case-value-validation-evidence.json)、[事前設計](docs/evaluation/2026-09-06-value-validation-plan.md) | 六次已完成，簡單流程三案通過、CASE 兩案通過一案失敗；未觀察到品質優勢，不預設完整分工 |
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
| 查安裝方式的選擇依據 | [安裝慣例調查](docs/research/2026-09-05-installation-conventions.md) | 官方與既有社群方案、實際限制，不另造套件管理器 |
| 查完整審閱與裁定 | [進度帳本](.superpowers/sdd/2026-09-04-m0-local-dossier-integrity/progress.md)、[最終報告](.superpowers/sdd/2026-09-04-m0-local-dossier-integrity/task-12-report.md) | 原始工作脈絡及 45 條裁定 |

目前產品：`workflow-kit/skills/case-workflow/scripts/core/index.mjs` 是 v2 核心入口，`case-v2.mjs` 為 CLI；`workflow-kit/integrations/pi/` 提供原生 extension／SDK runner。`install.mjs` 安裝可攜技能，`SKILL.md` 依任務與資料版本分流，`references/v2-contracts.md` 提供操作參照；v1 `scripts/case.mjs` 保留。`assets/` 是可選筆記，`workflow-kit/tests/` 驗證操作，不是模型效益替代品。

舊 M0 程式路徑：根目錄 `src/`、`schemas/`、`tests/`、`conformance/` 與 `evaluation/markdown-baseline/`，保留研究實作、規範與結果，不是 Kit 的依賴。

本頁就是隨版本維護的 repo 內 Wiki 首頁；不另維護可能不同步的 GitHub Wiki 副本。

規格、實作與測試若不一致，應記錄並修正差異，不能僅以測試通過推定規格正確。更新現況時同步維護 README 與狀態頁；保留歷史結果並附修正說明。
