# 目前狀態

9/10：[規劃回覆界線](design/2026-09-10-review-dispute-boundary.md)已修正，SDK 與自訂 runner 均拒絕混合角色回覆，265/265 測試通過。未重跑模型；錯誤但格式合法的審查意見／受阻判斷仍可能發生，不改成果的異議流程尚待實作。

9/9 最新：[修復後核對](evaluation/2026-09-09-repaired-review-report.md)約 409 秒，reviewer 通過，但 integrator 提出與來源矛盾的缺陷，planner 隨後錯誤受阻；成果仍正確，未結案。下一步處理既有角色的異議查證與回覆界線，不新增角色或反覆重抽。前次[修復設定對照](evaluation/2026-09-09-repair-thinking-report.md)的 off／medium 都修好，不代表所有角色可靠；以下保留較早結果。

9/9 接續：[既有核對與修復實測](evaluation/2026-09-09-review-repair-report.md)正確發現漏欄並退回，但 worker 未寫入，約 601 秒取消，未到整體驗收。下一步先分離修復執行設定的影響，暫緩新增檢查器；不推定 reviewer 失效或品質目標完成。

更新：2026-09-08。產品版本 **2.0.0-preview.1**。這是流程已實作、指定本機案例已驗證的預覽版，不是普遍提升模型品質的已證實方案。

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

目前接續：[規劃／執行交辦分界及 worker 診斷](evaluation/2026-09-08-planning-handoff-report.md)已保存，完整工程回歸 259/259。先前固定對照兩組皆未產出；使用者完成模型研究後，另一次 worker-only 重播約 211 秒寫出檔案，但缺一個必要欄位，仍不合格。受控 SDK 測試確認角色 schema、工具配對及拒收後寫檔接線正常。下一步聚焦可機械核對的需求如何成為可信檢查及實際修復，不把此診斷當作整案完成率改善。仍未合併或推送。

接續修正已在 `fix/read-receipt-diagnostics` 實作：模型可見讀取回條、有界診斷、保存失敗時停止派工並保留錯誤。本機完整回歸 256/256 通過，獨立程式審閱未發現阻斷問題；新舊格式的有限模型對照另見[驗證與復盤](evaluation/2026-09-06-read-receipt-report.md)。此分支尚未合併／推送，不把先前 main 的 CI 當成本批跨平台驗證。階段預算及停滯控制仍是候選，不是已提供功能。

前批讀取回條比較：短探測成功，完整 CASE 新舊格式兩組皆逾時；舊格式產物正確但未完成驗收，新格式未產出。沒有品質改善證據，未觸發額外 holdout；其後責任分界比較結果見上，不覆寫舊觀察。

- 普遍提升模型品質、省 tokens、長 context 優勢或跨模型可靠度。
- Codex／Claude Code／Antigravity 原生自動協作與真實跨工具交接旅程。
- 多機同步、作業系統沙箱、零失敗或所有問題都能自動發現的保證。

本次沿用使用者授權的既有 BAT 啟動原先未運行的模型服務，未改 BAT／服務參數或全域 pi；不刪除 pi 重建備份，不建立排程。歷史環境修復見[重建紀錄](research/2026-09-06-pi-clean-rebuild.md)，原始設計與研究從 [MAP](../MAP.md) 按需查閱，不作使用前置條件。
