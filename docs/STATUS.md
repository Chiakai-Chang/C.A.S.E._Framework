# 目前狀態

更新：2026-09-11。產品版本 **2.0.0-preview.1**。可使用的範圍是可攜技能、版本化工作紀錄及 pi 自動協作；它仍是預覽版，不是已證實普遍提高模型品質的方案。

本次將 pi 初次及返修交辦改為直接執行的分段說明，保留共識、回饋、驗收及材料；核心 JSON、權限與預算不變。完整工程 **323 通過、2 項 Windows 符號連結權限跳過**。不改模型服務或全域 pi。

**新版本正常完整任務通過**：從空白成果完成 planner → worker → reviewer → integrator，**547.780 秒、454,646 SDK 累計 tokens**，成果全部欄位、來源完整性及範圍檢查通過，人工介入 0。另有單獨執行診斷 169.286 秒成功、120,354 tokens，以及一次診斷腳本啟動失敗（零 SDK tokens）；本批合計 **575,000 tokens**，皆含快取。不是成功率或省成本證明。**保留工作分支，未合併／推送**。

仍有已知限制：核對／整合說明中的部分行號或雜湊文字錯誤；成本高，泛用性、異議真實路徑及其他 AI 工具原生整合未因此通過。下一步聚焦可信引用與成本，不再反覆抽同一任務。先前七處錯誤及 489,969 tokens 失敗批次仍見[歷史報告](evaluation/2026-09-11-initial-planning-report.md)，不覆寫成成功。整體交付仍為預覽版。

[最新實測與裁定](evaluation/2026-09-11-worker-grounding-report.md) · [集中驗證範圍](../workflow-kit/docs/READINESS.md) · [接續計畫](superpowers/plans/2026-09-10-recovery-and-delivery.md)

[開始使用](../README.md#開始使用) · [v2 操作](../workflow-kit/docs/V2.md) · [驗證範圍](../workflow-kit/docs/READINESS.md) · [版本紀錄](../CHANGELOG.md)

## 已提供什麼？

| 範圍 | 現況 |
|---|---|
| 專案共識、整體契約、工作包 | 共用核心保存來源版本、限制、驗收與預算 |
| pi 自動協作 | 獨立 session 規劃、執行、核對、整合；工作包依序執行 |
| 執行中發現與修復 | 即時持久回報、去重與補包、同 session 自查修復、只等待受影響工作 |
| 接續 | 保留有效成果、未決工作、來源及成本；不因重試重置預算 |
| Codex／Claude Code／Antigravity | 可攜技能／核心，尚無本套件的原生自動 session 整合 |
| 安裝維護 | pi 原生本機套件、可攜技能複製；更新／移除不刪任務 |
| v1 | 輕量記錄繼續可用，升級 v2 須顯式遷移 |

## 證據與價值

[生命週期驗收](evaluation/case-discovery-repair-report.md)保存即時發現／補前置／獨立整合，以及缺檔拒收後原 context 修復的完整本機模型成功；所有未通過、逾時與成本均保留。

[先前固定版六次比較](evaluation/case-value-validation-report.md)：一般流程三案成功，CASE 兩案成功、一案失敗，成功案成本也較高。它不是最新版可靠度估計，但仍是有效歷史證據；後續修復不能把它改成有品質優勢。

因此採用原則仍是：短工作直接完成；需要版本化交辦、接續或獨立核對時明確選用完整流程。[先前真實專案來源比較](evaluation/2026-09-06-real-task-report.md)兩組都未完成：一般 pi 81.181 秒，CASE 596.062 秒，沒有顯示品質或成本優勢。程式與安裝可用不等於能可靠無人監督完成任務。

## Git 交付與發布

**先前預覽版**已合併並推送至 GitHub main；這不包含上方尚未交付的工作分支。主要交付提交為 `b14ded1`，測試路徑修正為 `8c6d6c0`。新版 README 的 GitHub Skills 入口已實際下載並成功初始化 v2，包含當時的 discovery 與材料保護。修正後 Windows／macOS／Ubuntu × Node 20／24 六組 [CI 全數通過](https://github.com/Chiakai-Chang/C.A.S.E._Framework/actions/runs/34011479357)；首次失敗與修正依據保留於[採用核對](evaluation/2026-09-06-preview-release-checks.md)。

公開授權尚未選定，npm package 保持 private，未發布 registry。Git 推送、套件刊登與開源授權是不同事項，不代替使用者選擇授權。

## 仍未證明或未提供

較早的交辦分界、讀取回條、修復設定與核對結果，集中由 [READINESS](../workflow-kit/docs/READINESS.md) 導航。歷史成功與失敗均保留，不把不同版本、重建起點的診斷串成一次完整任務成功；先前 main 的 CI 也不代表本批跨平台驗證。

- 普遍提升模型品質、省 tokens、長 context 優勢或跨模型可靠度。
- Codex／Claude Code／Antigravity 原生自動協作與真實跨工具交接旅程。
- 多機同步、作業系統沙箱、零失敗或所有問題都能自動發現的保證。

本次沿用使用者授權的既有 BAT 啟動原先未運行的模型服務，未改 BAT／服務參數或全域 pi；不刪除 pi 重建備份，不建立排程。歷史環境修復見[重建紀錄](research/2026-09-06-pi-clean-rebuild.md)，原始設計與研究從 [MAP](../MAP.md) 按需查閱，不作使用前置條件。
