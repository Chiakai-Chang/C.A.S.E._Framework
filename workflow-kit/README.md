# C.A.S.E. Workflow Kit

把專案要求、整體計畫與當前交辦分開，讓 agent 在有限 context 下執行、自查、回報缺口並接續成果。可攜技能提供方法，本地核心保存版本與證據，pi 整合自動建立規劃、執行、核對與整合的獨立 session。

獨立 session 不承接其他角色的對話，但 pi 仍會載入適用的使用者／專案指引；它不等於完全空白的 context。

[完整介紹](https://github.com/Chiakai-Chang/C.A.S.E._Framework#readme) · [操作指南](docs/V2.md) · [安裝維護](docs/HOSTS.md) · [English](docs/GUIDE.en.md)

**2.0.0-preview.1 預覽版。** 適合需要版本化交辦、分階段接續或獨立核對紀錄的工作。短問答、小修改直接做即可；完整分工有額外成本，不保證品質更高或 tokens 更少。

2026-09-11 最新驗收：另一個正常任務被流程標為完成，但獨立評分發現一項錯誤，兩層核對均漏驗。先前主案例及引用局部診斷的成功仍保留；有效引用不保證語意正確。本批未合併／推送，不建議無人監督執行重要工作。[最新結果與歷史失敗](docs/READINESS.md)

## pi：完整自動流程

先下載 framework repository，再到你要工作的專案目錄執行：

```text
pi install -l "<CASE下載位置>/workflow-kit"
```

將路徑換成下載位置的絕對路徑並保留它；這是 pi 的本機套件引用，不是複製安裝。不需在 framework 根目錄 npm install。本次驗證使用 pi 0.84.2（需要 Node.js 22.19+）；本地核心需要 Node.js 20+。

重新載入 pi、選好模型後，交代：

> 用 CASE 整理來源資料，產出可追溯的摘要。保留原始檔，只寫 reports/，自行核對結果；總時間最多十分鐘。

agent 使用 `case_workflow` 建立任務。你可以用 `/case list`、`/case show <id>`、`/case run <id>` 查看及執行，用 `/case stop` 請求停止。實際測試命令由你透過 `/case checks <設定檔>` 確認後才執行，並具有目前使用者權限，不是沙箱。

遇到缺口時，執行者立即保存證據，規劃者在原授權內去重、補前置與調整工作。只有受影響工作等待，無關且有效的成果保留；提交遭拒可在原 session 修復，之後仍須獨立核對及整體驗收。這是協作概念，不要求 GitHub Issue／PR。

詳見 [v2 使用與接續](docs/V2.md)。只安裝下方技能，不會得到 pi extension；不要疊裝同名技能。

## Codex／Claude Code／Antigravity：技能與共同資料

在工作專案使用現成 Skills 安裝器：

```text
npx skills add https://github.com/Chiakai-Chang/C.A.S.E._Framework/tree/main/workflow-kit/skills/case-workflow --copy
```

依提示選 AI 工具及專案範圍，再請 agent 使用 case-workflow。Codex 可用 `$case-workflow`，Claude Code 可用 `/case-workflow`。其他工具取得相同技能與核心，不代表本套件已提供其自動 session 整合；Antigravity 完整模型任務尚未實測。

技能帶有 scripts、references 與 assets，複製安裝後本地工具不需原 repository 或網路。更新、移除使用同一個安裝管理工具。離線安裝、共用目錄、同名技能與平台限制見 [HOSTS](docs/HOSTS.md)。

## 如何選擇？

| 工作需要 | 使用方式 |
|---|---|
| 一次可完成 | 直接交代原本的 agent，不必建立 CASE 任務 |
| 輕量記錄與手動接續 | [v1 操作實例](docs/WORKFLOW.md) |
| 來源版本、工作包與獨立核對 | [v2 操作指南](docs/V2.md)，pi 可自動交接 |

v1 與 v2 命令、資料不同；既有 v1 資料必須明示遷移，不能混寫。任務集中在專案 `.case-agent/`，不覆寫 AGENTS.md／CLAUDE.md；更新或移除技能不刪任務資料。跨工具接手前確認舊寫者已停止，不在不同機器同時寫入。

## 證據與限制

本機模型已完成「即時回報新工作 → 補包 → 交付與獨立整合」及「缺檔拒收 → 同 session 修復 → 獨立驗收」。這證明指定流程可完成，不等於所有任務可靠或有品質優勢。先前比較中的失敗與額外成本持續保留於 [READINESS](docs/READINESS.md) 的來源紀錄。

固定版比較未觀察到品質或成本優勢；後續診斷也出現「成果正確，但整體驗收誤判而無法結案」。角色指引、搜尋及壓縮恢復處理後，正常任務仍未產出；局部介面改善不等於實現工作品質目標。請由 [READINESS 的證據索引](docs/READINESS.md#證據索引依問題查閱不串成一次成功) 查看各次結果，不把不同版本的局部成功合成一次完整成功。不建議無人監督執行重要工作。

模型可能漏報、誤判或耗盡預算；核心檢查狀態、來源與實際產物，不替文字證據背書。沒有核准檢查時不宣稱已執行測試。資料雖在本機，仍可能傳至你選定的模型服務。框架不提供作業系統沙箱、跨機同步、強身分認證或零失敗保證。

執行紀錄可能保存讀取內容、檢查輸出及模型回覆；分享或上傳前須檢查私密資料，不保證自動去敏。

[架構](docs/ARCHITECTURE.md) · [範本](docs/TEMPLATES.md) · [驗證範圍](docs/READINESS.md)

## 開發與打包

9/10 已實作混合規劃回覆拒收及有證據的異議重核。一般核對診斷已完成；異議流程的模型效果另測，不能從工程通過推定模型能自行駁回錯誤指控。見[修正範圍](../docs/design/2026-09-10-review-dispute-boundary.md)與[操作界線](docs/V2.md)。

從本套件目錄執行：

```text
npm test
npm pack --dry-run
```

本地核心不需 npm install。封裝包含 skills、pi integration、installer、README、docs 與 package metadata，不含 tests、evaluation、模型、node_modules、任務或快取。pi SDK 由 pi 提供。

公開授權尚未選定，package 保持 private，未發布 npm registry。Git 版本交付不等於授權或 registry 發布。
