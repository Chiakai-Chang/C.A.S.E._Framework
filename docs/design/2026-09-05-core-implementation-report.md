# CASE v2 核心實作結果

日期：2026-09-05。範圍：實作計畫 Task 1；未修改 v1 `case.mjs` 或 M0。

已實作同步本地 `createStore(project)`：`init/migrate/create/get/list/dispatch/context`。`create/get/dispatch` 回傳卷宗本體；錯誤不輸出 stdout。新 CLI 為 `case-v2.mjs`，契約與操作使用 `--data FILE` 讀取 JSON，拒絕未知旗標，錯誤 JSON 寫入 stderr。

## 已落定介面

- 包狀態：`planned/ready/running/submitted/verified/blocked/cancelled`；`attemptId` 為 `state.packets.find(p => p.id === packetId).attempts.at(-1).id`。
- 材料版本使用 `sha256`。明示相依包的產物可作為尚未存在的必讀輸入：`producerPacketId` 記錄來源包，初始雜湊為 null；來源包驗證後，下游 ready 時綁定 `sha256` 及 `producerAttemptId`。
- 原地修改保留 attempt 的原始 inputs 雜湊；submit 保存產物雜湊；review 對比 submitted 產物與其餘唯讀來源。不要求已修改的輸入仍等於修改前版本。
- `retry` 可明示重跑已 verified 包，並使下游 blocked。契約修訂後必須 `plan` 重新對齊，不能以 retry 偷渡舊條件；舊包保存在 `packetHistory`。重規劃不重置累計 attempt 或首次開始時間。
- 配合 pi 整合，額外提供 `saveRun(id, runId, record)` 與 `listRuns(id)`；runId 使用 UUID。紀錄寫入 artifacts，排序按 createdAt，不修改權威 revision。

## 驗證

先執行不存在核心的行為測試，8/8 以明示 assertion 失敗；後續原地修改、run 保存、重規劃、DAG 產物、遷移中斷及重試回歸均先看到預期失敗，再實作修正。

最後執行：

```text
node --test workflow-kit/tests/core-v2.test.mjs workflow-kit/tests/install.test.mjs workflow-kit/tests/workflow.test.mjs workflow-kit/tests/journey.test.mjs workflow-kit/tests/pi-runner.test.mjs workflow-kit/tests/pi-tools.test.mjs
```

44/44 通過，包含核心 23 項、既有 Kit 13 項、當時主線 pi runner 5 項及工具 3 項。所有核心檔案測試使用真實暫存目錄；遷移中斷測試在子程序的 manifest 切換前故障注入，確認 v1 manifest 保留，程序確定退出且人工清理殘留鎖後可續接。

## 邊界與取捨

核心為共同可寫檔案系統上的合作式狀態儲存，不提供身分認證、防竄改或 OS sandbox。鎖不依年代自動刪除。檔案寫入採同目錄暫存檔替換，不宣稱斷電持久性；陌生狀態不保證自動修復。

顯式 v1 migration 在 `.case-agent/` 外保留備份與可辨識的暫存日誌，驗證備份後最後切換 manifest。舊任務留作歷史，不升格為獨立驗收。原始 legacy CLI 拒絕 v2 為預期保護。

context 依 maxChars 控制字元數，容量不足報錯，不宣稱精確 token。核對 session 不同只證明 API 中紀錄不同 session；證據內容與語意正確性仍依賴實際工具及核對者。attempt 用量在未知時記 unknown，整合層真實 session 資料另存 run artifact。本報告沒有本地模型品質或效益驗收宣稱。

## pi 審閱修正

同日依主線審閱及本地試驗回報，窄修三項問題，均先新增失敗測試重現後修改：

- integrator 的模型 JSON 原先可覆寫 action type/sessionId，造成取消卷宗卻誤報 run completed。現在只接收 results/summary，固定 integrate 與真實 sessionId，完成後再確認卷宗 completed。
- worker writeScope 指向尚不存在的資料夾時，現在能建立首個子路徑產物；仍檢查路徑邊界、符號連結與受保護設定。已設定的檢查 timeout 必須為正整數，拒絕零、負數、NaN、Infinity 及數字字串，執行上限仍為 120 秒。
- SDK 失敗／取消會在 dispose 前保存工具觀察與可取得的 stats，透過 failure.sessionEvidence 交 runner 寫入 run artifact。缺少統計明示 unknown；空 final reply 等 runner 邊界驗證失敗也保留已知用量。這些測試的 SDK 替身只替代外部模型迴圈，不代表真實模型測試。

另依主線實測的額外 constraintId 回覆問題，integrator prompt 現在列出實際 acceptance IDs 與 JSON 形狀；INVALID_REPLY 或 ACCEPTANCE_INCOMPLETE 時，在相同總預算下最多使用一次新 integrator session 修正，要求重查產物。舊回覆與 validationError 保留，不篩除錯誤資料、不重跑 verified worker。測試確認 a1+c1 被拒絕、下一次 a1 可通過且 worker 僅執行一次。

本次最終回歸：core-v2、pi-runner、pi-tools、pi-sdk、install、workflow、journey 共 53/53 通過（pi 17 項）。未改套件、文件入口、評估資料或 v1；本段為主線要求的修正附記。
