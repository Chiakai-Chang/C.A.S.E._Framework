# 目前狀態

更新：2026-09-06。產品版本 **2.0.0-preview.1**。這是流程已實作、指定本機案例已驗證的預覽版，不是普遍提升模型品質的已證實方案。

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

因此採用原則仍是：短工作直接完成；需要版本化交辦、接續或獨立核對時明確選用完整流程。[本輪真實專案來源比較](evaluation/2026-09-06-real-task-report.md)兩組都未完成：一般 pi 81.181 秒，CASE 596.062 秒，沒有顯示品質或成本優勢。程式與安裝可用不等於能可靠無人監督完成任務。

## Git 交付與發布

本輪已合併並推送至 GitHub main，主要交付提交為 `b14ded1`，測試路徑修正為 `8c6d6c0`。新版 README 的 GitHub Skills 入口已實際下載並成功初始化 v2，包含最新 discovery 與材料保護。修正後 Windows／macOS／Ubuntu × Node 20／24 六組 [CI 全數通過](https://github.com/Chiakai-Chang/C.A.S.E._Framework/actions/runs/34011479357)；首次失敗與修正依據保留於[採用核對](evaluation/2026-09-06-preview-release-checks.md)。

公開授權尚未選定，npm package 保持 private，未發布 registry。Git 推送、套件刊登與開源授權是不同事項，不代替使用者選擇授權。

## 仍未證明或未提供

- 普遍提升模型品質、省 tokens、長 context 優勢或跨模型可靠度。
- Codex／Claude Code／Antigravity 原生自動協作與真實跨工具交接旅程。
- 多機同步、作業系統沙箱、零失敗或所有問題都能自動發現的保證。

本次工作不更動全域 pi／模型服務，不刪除 pi 重建備份，不建立排程。歷史環境修復見[重建紀錄](research/2026-09-06-pi-clean-rebuild.md)，原始設計與研究從 [MAP](../MAP.md) 按需查閱，不作使用前置條件。
