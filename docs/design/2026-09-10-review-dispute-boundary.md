# 審查異議與規劃回覆界線

2026-09-10。接續使用者同意的[9/9 復盤](../evaluation/2026-09-09-repaired-review-report.md)。目標仍是保留正確成果、減少錯誤返工與人類判斷負擔，不以增加驗收角色取代品質。

## 已完成：拒絕混合規劃回覆

規劃者回覆只可為以下類型：

- 計畫：`packets`，可附 `reason`／`rerunPacketIds`。
- 發現處置：`decisions`，可併附實際計畫修訂；這是原有合法用法，不因互斥檢查被誤擋。
- 受阻：恰為 `{"blocked":{"reason":"具體原因"}}`，不得混入其他回覆類型或巢狀額外欄位。

`results`、`summary` 等其他角色欄位不再被默默接受。SDK 的工具 schema、實際工具處理、最終文字回覆與自訂 runner 回傳邊界均檢查規劃者形狀。初次／修訂計畫的前置檢查仍依請求限制類型；實際計畫內容、權限與相依繼續由核心驗證，不把格式檢查當語意驗收。

錯誤工具回覆不會終止 session，仍可在原 session 修正後提交；若自訂 runner 忽略前置檢查而回傳混合 JSON，仍拒收、保留回覆及成本，不修改卷宗。這不保證模型不再提出錯誤但格式合法的 `blocked`。

驗證：4 個反例先在原版失敗，修正後通過；另驗證 SDK 同 session 拒收後接受合法 discovery amendment。獨立審閱另找到 custom runner 可略過請求專用檢查，已補反例與回傳端驗證，初次計畫不可夾帶 decisions 後被默默捨棄。完整 kit **265/265** 通過。舊 SDK 測試中規劃者回傳 reviewer／worker 格式的替身已改成合法角色回覆；未通過文字修正的測試現在驗證拒收及失敗保存。9/9 真實混合回覆亦經離線重播確認拒收。未啟動本機模型，因此沒有新的模型效果結論。

## 不改成果的異議處置（已實作，模型效果另列）

本次完成核心快照、逐字引用驗證、pi 互斥回覆與一次重核接續。以下保留採用的設計；程式只能核對來源存在與版本，不能保證模型語意判斷。完整工程測試 279 項：278 通過、1 項 Windows 符號連結權限不足跳過。

不能只把 integrator 的否決改成提示「請再想一次」，也不能讓 planner 宣布通過就結案。現有 `NO_PLAN_CHANGE` 防止反覆詢問直到改口，應保留這個目的，但加入有新證據的例外。

建議沿用既有 planner → integrator，不增角色或任意寫入權限：

1. integrator 的失敗回報應指出驗收條件、爭議主張及來源位置；純敘述不是裁定事實。planner 只針對爭議查證，不重新解整份任務。
2. 真缺陷沿用 amend_plan／rerunPacketIds；缺外部資料或新增權限才受阻。planner 本身唯讀不構成阻礙，應依工作契約的 writeAuthority 交辦。
3. 若主張與來源矛盾，planner 可提出「保留成果並重核爭議」申請，附原失敗項目、當前來源／成果版本、來源位置及反證；不得直接設 completed 或略過任何驗收條件。
4. 程式核對引用存在、版本未變、申請對應本次失敗且未重複；保存原否決與反證，再讓既有 integrator 在新 context 核對。引用存在不等於語意成立，最後仍須核對整體驗收。
5. 同一成果版本與失敗項目最多一次這類重新核對，沿用總時間／session／重規劃預算且跨接續累計；再有分歧則保存為未解爭議，不靠循環「洗通過」。來源變更要依既有過期處理，不能借此刷新免費預算。

持久化使用 run 的 `reviewDisputes` 與 `pendingReviewDispute`；狀態為 prepared／issued／accepted／rejected／superseded。舊 run 缺欄位視為無爭議，不改核心資料版本。引用格式見下方實作計畫；工作包 inputs／最後成果為引用白名單。prepared 可在原版本接續，issued 若結果未知則拒絕自動重播。操作者確認後透過既有 retry／amend_plan／revise 變更卷宗 revision，舊申請記為 superseded 並記錄新 revision，不需手改 run JSON；歷史成本仍累計。

驗收應同時包含：真缺陷不能被駁回、正確成果不被迫改寫、假引用／過期引用拒絕、混合回覆拒絕、重複申請有界、重啟不重置成本、失敗保存，以及缺外部權限仍停止。保存的 9/9 模型回覆供反例使用，不把該任務 oracle 注入產品。

## 連動與取捨

### 本輪實作計畫（使用者已同意繼續）

沿用上述設計，分成可獨立驗證的兩部分；不新增角色或資料庫。

- [x] 核心提供唯讀的 `store.reviewSnapshot(caseId)` 與 `store.validateReviewDispute(caseId, snapshot, dispute)`：已核對工作包的來源／成果版本，以及引用路徑、雜湊、起訖行與逐字引文驗證。對未知、過期、越界、假引用先寫反例，再實作。
- [x] pi 增加互斥的 `reviewDispute` 回覆，僅限 integrator 語意否決後的 planner。用原 run 紀錄保存待核對反證及已用額度；同成果版本／驗收條件最多一次，跨重啟不重置。先寫 reviewer→integrator 否決→planner 反證→integrator 全項驗收的測試，確認零 worker 重做；另測真缺陷、再否決、中斷與過期。
- [ ] SDK schema、操作參照與中英文現況同步；完整 kit 測試及獨立審閱。模型效果與工程行為分開，不因工程通過宣稱 9/9 模型已完成。

具體回覆為 `{"reviewDispute":{"reason":"反證如何推翻原主張","criterionIds":["失敗的驗收 ID"],"citations":[{"path":"來源或成果相對路徑","sha256":"目前雜湊","startLine":1,"endLine":2,"quote":"此範圍全文"}]}}`。必須覆蓋本次全部失敗 ID，最多 16 處引用、每處引文最多 4,000 字元；沒有反證不開放重新核對。來源／成果版本由程式保存，模型不能自行宣告已驗證。

早期修正只涉及 `runner.mjs`、`sdk-session.mjs` 及既有測試；後續已新增 `core/review-dispute.mjs`、`integrations/pi/material-search.mjs` 與對應測試／診斷入口，沒有改核心資料版本。現況同步 README、READINESS、STATUS、GUIDE.en、V2、協作參照與 MAP；最新實測及限制見[角色指引與精確定位](../evaluation/2026-09-10-search-and-role-report.md)。

依 agent 架構技能採用「模型提出判斷、程式守住格式／權限／預算」的責任分離；不以多個模型意見一致代替來源證據。原始 CASE 的獨立核對與雙層回饋仍保留，但要補上錯誤回饋可被反證的路徑，而不是要求每次由使用者指出問題。

## 9/10 收尾中斷復盤

使用者回報 Codex 停止，但用量頁仍有每週 79%。實際工具錯誤為 `Automatic approval review failed: You've hit your usage limit`：停止本次模型程序的請求在建立程序前被拒絕，並非 CASE 驗收途中失敗，也不是安全審查已完成後判定指令具破壞性。該次呼叫把停止模型、封裝檢查及證據整理依序串在一起；第一項失敗，後兩項也未執行。這是不必要的收尾相依，後續應將獨立的證據保存與需權限的清理分開處理，不繞過被拒絕的操作。

事後兩次查詢目前 Codex 額度均為每週已用 21%、未標示達上限，另有 2 次可用重置；其他時間窗資料未提供，不得當成零用量或耗盡。這證明目前可見額度與審查錯誤不一致，尚不能證明是另一時間窗、登入狀態或服務端額度判斷問題。官方文件說明自動審查需要額外模型呼叫，且審查失敗時不執行操作；未說明本次帳號為何遭拒。參考：[Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security)，查閱日期 2026-09-10。

中斷前的本機測試已保存於 `.npm-cache/dispute-review-2026-09-10.json`：`status=completed`、`codeUnchanged=true`，約 220.292 秒，角色只有 reviewer 與 integrator。因此本次不能宣稱真實模型已走過 planner 的異議申請與重新核對。原始結果仍待整理到正式證據位置；文件同步與封裝亦未完成，不視為已交付。

事後唯讀檢查仍見 llama-server 程序；未重送停止請求、未兌換重置、未購買額度、未修改全域設定或清理 AppData。GPU 使用率 0% 的截圖本身不能證明模型崩潰。另有本機 npm 相依套件缺失的封裝問題，與本次自動審查用量錯誤分開追蹤，不以重建環境處理未證實的根因。
