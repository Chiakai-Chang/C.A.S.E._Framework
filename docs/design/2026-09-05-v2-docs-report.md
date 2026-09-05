# v2 文件與技能更新

日期：2026-09-05。範圍：Task 3 的使用文件與可攜技能，不修改程式。

## 修改前的具體缺漏

以現有 SKILL 與其入口套用三個情境，先核對來源，再修改：

| 情境 | 現有指引的缺漏 | 所需修正 |
|---|---|---|
| pi 中要求新 session 規劃、執行、核對 CSV 工作 | 只導向 `case.mjs new`；沒有 `case_workflow`、v2 契約或真正新 session 入口 | 明確分流技能與 extension，提供契約及能力邊界 |
| v1 任務接續時升級 v2 | 開始步驟一律 init；未說明 `MIGRATION_REQUIRED`、外部備份與歷史不等於 v2 pass | 依 manifest 選版本，顯式遷移 |
| v2 來源變更或中斷後接手 | 只說截斷補讀、checkpoint、reopen；會套用不存在的 v2 操作 | 專用參照說明容量錯誤、revision、retry／revise 與 running 不盲重跑 |

這是同一作者的參照應用與缺漏核對，不是假稱獨立模型壓力測試。依 repository 不增加固定儀式輪數的要求，使用 skill-creator 的按需參照及 writing-skills 的先辨識缺漏、再補最小指引方式；未另啟代理或推送。

## 修改與驗證

新增一份使用指南 `workflow-kit/docs/V2.md` 與隨技能複製的 `references/v2-contracts.md`。SKILL 依 manifest 分流，保留 v1 輕量記錄；README、HOSTS、ARCHITECTURE、READINESS 連到 v2，WORKFLOW／TEMPLATES 及舊 references 明示適用範圍。GUIDE.en 同步契約、session、工具能力、資料、遷移、接續與證據限制，未新增另一套範本或 JSON schema。

回查 `case-v2.mjs` help、core/index/store/contracts/state、pi extension/runner/sdk-session/scoped-tools：新建情境能由 SKILL 找到 create 契約及 run 入口；v1 升級情境明確要求遷移意圖及外部備份；v2 接續情境導向 get/context、容量錯誤、來源失效、revision、running 檢查與 retry/revise。這是來源及參照應用核對，沒有假稱另一次獨立模型驗證。

驗證結果：既有必跑 Kit 測試 13/13 通過；技能 quick_validate 首次因 Windows cp950 讀 UTF-8 失敗，以 `python -X utf8` 重跑通過，未修改全域設定。Kit README、docs 與 skill Markdown 共 54 個本地連結存在（不包含遠端有效性及標題 anchor 的自動驗證）；v2 help 命令與旗標已核對。

主線提供的 pi 原生本機安裝及實際 loader 證據已寫入 HOSTS／READINESS／English guide；原生命令模型端到端及移除尚待主線最終確認。第一輪成功 smoke 與後續分離流程整合回覆錯誤均保留為有限證據，不宣稱全部設計驗收完工。完整配對結果、修正後結果、封裝及全套新測試由主線合併驗證，再更新 READINESS 對應段落。

後續同步：依主線擴充授權，已更新根 README、GOALS、STATUS、MAP、MAINTENANCE，明示 v2 已實作、版本 `2.0.0-preview.1`、本輪未合併／推送、main 安裝網址屬既有 v1。根入口連至本地模型開發報告；修正前後配對不混為固定版本統計。已據主線結果補入原生 create/run 124.914 秒、四 session、產物與來源核對成功，以及 59/59 本機回歸；移除結果仍待同步。更新後 126 個本地文件連結存在。

最終窄幅同步：主線完成 61/61 Kit 回歸、原生 remove 且卷宗／產物／來源套件 SHA256 不變，以及三個 holdout（資料彙整、缺料安全停止、保留已核對上游接續）。READINESS、V2、English guide 已同步，技能參照補入非空 `{blocked:{reason}}` 規劃出口。缺料原始 UX 問題與後續回歸修正分開保存，未宣稱已重跑該模型案例或所有設計效益驗收通過。
