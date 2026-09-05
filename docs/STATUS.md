# 目前狀態

更新：2026-09-05。`2.0.0-preview.1` 的 v2 核心與 pi 自動 context 流程已實作，本輪分支尚未合併或推送。採用入口：[v2 指南](../workflow-kit/docs/V2.md)、[原生 pi 安裝](../workflow-kit/docs/HOSTS.md)。

依[完整設計](design/2026-09-05-case-solution-design.md)，目前已接通全域契約、規劃、工作包、獨立執行／核對與整合，保留 v1 輕量記錄。原生本機安裝與實際 loader 已成功；本地模型比較及最終驗收仍依實際結果更新，不宣稱全部設計驗收完工。沒有排程。

| 項目 | 現況 |
|---|---|
| v2 契約、工作包、SHA256、核對與整合、預算、遷移 | 共用核心已實作；case-v2.mjs 與 pi 共用狀態規則 |
| pi 新 session 規劃、執行、核對及整合 | runner 已實作；原生安裝及 loader 成功，真實執行結果見 READINESS |
| Codex／Claude Code／Antigravity | 可攜 skill／core；沒有本套件的原生自動 session runner |
| 任務、context、checkpoint、handoff、證據、完成／reopen／doctor | 本地 CLI 已實作，不需外部服務 |
| 需求至交付、分工、按需載入、恢復、品質與目標判斷 | 可攜 skill、references、範本與實例 |
| pi／Codex／Claude Code 安裝、更新、移除 | 專案安裝器已實作；保留備份與任務資料 |
| 操作實測及限制 | 見 [READINESS](../workflow-kit/docs/READINESS.md) |
| 普遍提升模型品質或降低 tokens | 尚未做足以支持普遍結論的比較 |
| 公開授權／registry 發布 | 授權尚待選定，package private，未發布 |
| 舊 M0 production adapter | 仍未支援，不阻擋 Workflow Kit 使用 |

M0 的 310 核心測試、140 規範案例與 34 份歷史結果只描述該研究成果。r6 B0 四案偵測成功，M0 四案未測到目標行為；見 [基準報告](evaluation/m0-baseline-report.md)。新 kit 不借用這些計數證明產品效果。

後續依真實本地模型的成果、失敗及成本判斷修正，不擴大架構或增加固定儀式。以下保留先前 v1 Kit 交付紀錄，其「通過」只適用當時範圍，不表示 v2 完整驗收或推送已完成。

v2 [本地模型開發驗證](evaluation/case-v2-local-report.md) 保存全部配對及失敗，不將修正前後混為固定版本統計。格式指引修正後一組：單 context 23.538 秒／SDK total tokens 6069，分離 115.405 秒／21198，兩者獨立產物核對通過。這個簡單工作未顯示分離的品質收益，增加成本，因此保留小工作直接完成。原生 pi create/run 另已成功；最新安裝維護與測試結果集中於 READINESS。

安裝體驗修正：README 改以現成 Skills 安裝器為主要入口，內部 Node 安裝器降為進階／離線選項。GitHub 技能發現、隔離複製安裝及安裝後 init／doctor 已驗證；pi 原生 Git 封裝限制仍明示。公開使用文件改稱 AI 工具，避免直譯術語造成閱讀負擔。

先前 v1 已依授權推送 GitHub main。交付驗收見 [ACCEPTANCE](ACCEPTANCE.md)；v1 提交 `2a81bc8` 的 Windows／Linux／macOS × Node 20／24 六組 CI 全數通過，實際結果連結見 READINESS。本輪 v2 未合併／推送；公開授權及 npm 發布仍未決定，不能與 Git 推送混為一談。

文件收尾：目前 Kit 架構／術語、範本導航及英文指南已獨立整理；MAP 是版本化 Wiki 首頁。舊 CONTEXT 只適用 M0。Antigravity 共用路徑的採用方式與未測邊界已納入 HOSTS，沒有新增AI 工具實測宣稱。
