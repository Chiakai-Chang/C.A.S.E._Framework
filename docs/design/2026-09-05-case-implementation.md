# CASE context 工作流程實作計畫

規格：[完整設計](2026-09-05-case-solution-design.md)。使用者於設計交付後同意復盤並繼續。工作分支：`feat/case-context-workflow`，保留目前工作目錄與所有先前研究文件。

使用 test-driven-development 寫可失敗的行為測試，再實作；具體獨立工作以 subagent-driven-development 分工。依 repository 指示，不增加固定角色或儀式性審閱輪數，完成後核對規格與程式品質。已有 13 個 Kit 測試全數通過。

## 全域限制與復盤裁定

- Kit 核心維持 Node.js 20+、無新增 runtime 依賴；pi 的專屬依賴留在 integrations/pi。
- 不改 M0、不清除全域 pi、不自動啟動雲端模型、不推送未驗收程式。
- 所有新命令／資料不可破壞 v1；顯式 migration 後舊工具拒絕是保護。
- 驗收必須引用輸入與成果版本；不同 session 不是防竄改或 OS sandbox。
- 正體中文文件為主，對既有測試與安裝維持回歸。
- 大憲法改變不得偷偷重用舊 pass。相依更新使下游需重驗；單純摘要更正不更動成果。
- 核心只控制經 API 的行為，不能宣稱可阻止同權限程序直接改 JSON。
- 復盤：並行修改同檔與不受控 shell 都不安全；預設單写者、序列化執行。pi 真實模型試驗先在可丟棄的隔離專案運行。

## Task 1：版本化核心與操作入口

擁有檔案：`workflow-kit/skills/case-workflow/scripts/core/*.mjs`、`workflow-kit/skills/case-workflow/scripts/case-v2.mjs`、`workflow-kit/tests/core-v2.test.mjs`。

輸出介面（同步、純本地）：`createStore(project)` 從 `core/index.mjs` 匯出。物件方法：`init()`、`migrate()`、`create(contract)`、`get(id)`、`list()`、`dispatch(id, action, {expectedRevision, requestId})`、`context(id, packetId, {maxChars})`。所有成功資料為 JSON 可序列化；失敗 Error 有 code，不印 stdout。CLI 直接使用此介面。

契約輸入：`{goal, constraints:[{id,text}], acceptance:[{id,text}], budget:{maxAttempts,maxDurationMs}}`。
初始卷宗：`{format:'case-workflow/2',id,revision,status,contract,packets:[],integration:null,requests:{},createdAt,updatedAt}`。
action 固定為 `{type,...}`：
- `plan`：`packets:[{id,purpose,constraintIds,inputs:[{path,required}],dependsOn,writeScope,deliverables:[{path}],checks:[{id,text,criterionIds}],unknowns:[]}]`。核心在接收時為輸入計算 SHA256，檢查所有路徑在 project 中、來源安全且必要檔存在、ID/相依/涵蓋合法。
- `start`：`packetId, sessionId`，回傳卷宗，running packet 的 `attempts` 最後一項有 `id,sessionId,status`。新 session 不得與該包以前 attempt 同 ID。
- `submit`：`packetId,attemptId,summary`。只對預定產物取雜湊，保存 submitted 證據。
- `review`：`packetId,attemptId,sessionId,passed,findings,evidence`。sessionId 必須不同於執行者，且核對當前來源與成果雜湊未變；成功 verified，失敗 blocked，可 retry。
- `retry`：`packetId,reason`；`block`：`packetId,reason`；`cancel`：`reason`；`revise`：`contract,reason`（保守失效全部包與整合）；`integrate`：`sessionId,results:[{criterionId,passed,evidence}],summary`（全部必需包有效及每项全域條件pass才completed）。
- 預算按 attempt 計入；時限從首次 start 計；重送同 requestId 同 action 返回目前狀態，不重複副作用，不同內容同 ID 拒絕。

context 輸出為字串，含 goal、全部全域限制、包及必要材料、其他材料索引，不含其他 worker history。過長報 CONTEXT_TOO_LARGE，不默默截斷必要內容。這個 API 用 maxChars 明示字元預算，不當成精確 token。

- [x] 先寫完整循環、越權狀態、陳舊材料、缺驗收、循環依賴、路徑逃逸、重送、revision 競爭、context 不遺漏、v1 migration 安全測試；動態 import 不存在模組時用 assert 明示功能尚未存在，再看到測試失敗。
- [x] 實作小型模組，真實暫存目錄測試，不用模擬檔案系統。
- [x] 執行 core-v2 與既有全部測試，回報實際結果；核對規格與安全限制。

## Task 2：pi session 執行與全流程

擁有檔案：`workflow-kit/integrations/pi/`、`workflow-kit/tests/pi-runner.test.mjs`。消費 Task 1 介面，不另寫狀態機。

runner `runCase({store,caseId,runSession,signal})` 依序呼叫 planner→worker→reviewer→integrator。runSession 消費 `{role,prompt,signal}`，返回 `{sessionId,text,usage}`；每次全新 context。planner JSON 對應 plan action；worker 改產物後回報；reviewer回報 `{passed,findings,evidence}`；integrator回報 `{results,summary}`。JSON 解析只接受完整 JSON 或單一 fenced JSON，不用模糊截取子字串。

runner 保存每階段結果／用量，不把執行者敘述當驗收。錯誤、取消、無輸出、context容量不足保存可接續結果，已verified工作不重跑。逾時取消 session；不允許重疊 worker 修改。SDK adapter 固定 0.84.2，明確提供模型／資源，不能 fallback雲端。

- [x] 先用真實 store 和替代昂貴模型呼叫的腳本 session 測試整合：完成、核對失敗、取消、中斷、來源陳舊。
- [x] 實作 SDK adapter，不影響無 pi 的核心。實測修正：原生 extension 必須使用 pi 支援的靜態 SDK 匯入，operation factory 注入 SDK；獨立 SDK adapter 保留動態載入的明確缺依賴錯誤。
- [x] 以隔離環境對實際 SDK／本地模型執行 smoke；若不可用，記錄確切原因，不把脚本測試標成模型成功。

## Task 3：產品入口、說明與配對證據

擁有檔案：Kit README、HOSTS、ARCHITECTURE、SKILL及refs（依skill-creator）、GUIDE.en、READINESS、`workflow-kit/evaluation/`、根 STATUS/MAP。

- [x] 給 pi 原生安裝與 /case 入口；直接工作、階段與分工說明，不覆寫既有指引。
- [x] 初次安裝／更新／移除在隔離專案實測，包括技能複製後新核心仍可用；既有安裝器回歸與原生 pi 安裝／執行／移除另列證據，不混淆兩種分發方式。
- [x] 固定本地模型與 SDK 推論設定，執行相同任務的單context與分離context比較，保存結果及總成本；開發期間程式有變更，詳見[全部開發結果與限制](../evaluation/case-v2-local-report.md)，不當成固定版本效果研究。
- [ ] 最終跨模組審閱、全部 Kit 測試、文件連結、套件内容檢查後才決定合併；不擴大研究。

## 進度

- 起始：既有 Kit 13/13 通過；設計主要差距已轉成具體介面與測試。
- Task 1：已實作，23個核心行為測試與既有13個通過；見 core-implementation-report.md。獨立審閱未指出核心阻擋問題。介面補充 saveRun/listRuns；producer 輸入在ready時綁上游產物版本，修訂後必須replan。
- Task 2：pi SDK／scoped tools／runner／extension 已接通。審閱的 action 注入、新資料夾 scope、失敗證據遺失已修正；追加禁止對 `passed:false` 重問，保留真實失敗。原生載入發現 dynamic import 不適用 pi alias，改薄靜態入口後真實 create/run 通過。完整 Kit 回歸 59/59 通過；CI 改採同套件測試入口，修正三個測試依賴啟動目錄的問題。
- Task 3：正體中文／英文與技能參照已同步，原生安裝、模型執行及移除通過。CSV 所有開發結果（包含失敗）已去除本機路徑保存至版本化 evaluation；資料整合、缺資料與接續 holdout 各一次通過。缺料安全停止但錯誤不清楚，另補明確 blocked reason 出口及紅綠回歸；最新整套 61/61。效益尚無普遍證明，不以新增角色迴避結果。

## 本輪保存決定

核心功能、pi 實際工作鏈、文件與本地探測已落地；原設計的多策略、多任務重複效果比較仍未全數執行。本輪保留 preview 分支與原始失敗，不合併／推送為完整驗收。下一步應是有界效果比較與必要可用性改善，不能再增加架構或把小樣本包裝成結論。此決定不是等待使用者實測。
