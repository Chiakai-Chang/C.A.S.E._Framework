# 目前狀態

更新：2026-09-05。產品為 [Workflow Kit 1.0](../workflow-kit/README.md)，完整工作方法與工具已實作，可從原始碼直接使用。每週目標排程已依指示刪除。

| 項目 | 現況 |
|---|---|
| 任務、context、checkpoint、handoff、證據、完成／reopen／doctor | 本地 CLI 已實作，不需外部服務 |
| 需求至交付、分工、按需載入、恢復、品質與目標判斷 | 可攜 skill、references、範本與實例 |
| pi／Codex／Claude Code 安裝、更新、移除 | 專案安裝器已實作；保留備份與任務資料 |
| 操作實測及限制 | 見 [READINESS](../workflow-kit/docs/READINESS.md) |
| 普遍提升模型品質或降低 tokens | 尚未做足以支持普遍結論的比較 |
| 公開授權／registry 發布 | 授權尚待選定，package private，未發布 |
| 舊 M0 production adapter | 仍未支援，不阻擋 Workflow Kit 使用 |

M0 的 310 核心測試、140 規範案例與 34 份歷史結果只描述該研究成果。r6 B0 四案偵測成功，M0 四案未測到目標行為；見 [基準報告](evaluation/m0-baseline-report.md)。新 kit 不借用這些計數證明產品效果。

後續優先處理實際使用發現的具體問題。不以更多規劃取代功能交付。

安裝體驗修正：README 改以現成 Skills 安裝器為主要入口，內部 Node 安裝器降為進階／離線選項。GitHub 技能發現、隔離複製安裝及安裝後 init／doctor 已驗證；pi 原生 Git 封裝限制仍明示。公開使用文件改稱 AI 工具，避免直譯術語造成閱讀負擔。

已依授權推送 GitHub main。交付驗收見 [ACCEPTANCE](ACCEPTANCE.md)；提交 `2a81bc8` 的 Windows／Linux／macOS × Node 20／24 六組 CI 全數通過，實際結果連結見 READINESS。公開授權及 npm 發布仍未決定，不能與 Git 推送混為一談。

文件收尾：目前 Kit 架構／術語、範本導航及英文指南已獨立整理；MAP 是版本化 Wiki 首頁。舊 CONTEXT 只適用 M0。Antigravity 共用路徑的採用方式與未測邊界已納入 HOSTS，沒有新增AI 工具實測宣稱。
