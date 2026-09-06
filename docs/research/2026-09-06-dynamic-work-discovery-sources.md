# 執行中新工作發現：持久待辦與動態重規劃的一手來源

核對日期：2026-09-06。這是設計研究，不是已實作功能或本地模型成效報告。沿用 [GOALS](../GOALS.md)、[維護原則](../MAINTENANCE.md#原始構想參照)及[分層協作方向](2026-09-05-layered-cooperation-direction.md)；本輪只補「執行者發現缺漏後如何進入後續工作」的依據，不重做既有[來源整理](2026-09-05-layered-cooperation-sources.md)。

## 原案確實要求即時回饋，不只初始拆解

固定版本：`Chiakai-Chang/Local-Agent-Workspace@2c1d160013c763457269226fcc37b1b18728884a`。本輪 GitHub 網頁與 raw URL 取回失敗，改由本機唯讀副本 `D:/MyProject/CKs_PI_Code_Agent_Harness/external/Local-Agent-Workspace` 核對；`git rev-parse HEAD` 為上述完整提交，並用 `git show <commit>:references/for_agents.md` 直接讀版本物件，而非把工作目錄內容當固定證據。

主要來源：[references/for_agents.md 固定版](https://github.com/Chiakai-Chang/Local-Agent-Workspace/blob/2c1d160013c763457269226fcc37b1b18728884a/references/for_agents.md)。精確章節及含義如下：

| 章節 | 原案規定 | 本次解讀與限制 |
|---|---|---|
| §5 Authorized Tool API | `create_subtask(slug, recipe_content, role_content)` 由 orchestrator 在 `02_Task_Queue/` 建立 `PENDING` 任務；worker 不直接越界寫其他任務資料夾 | 「直接回饋」仍經有邊界的工具，不是給 worker 任意修改全域計畫的權限 |
| §6 Worker Agent Protocol、§10a Micro-Level Feedback | 可定義的前置缺口先呼叫 `create_subtask`，再 `escalate_issue` 暫停原工作；不等全域整合 | 發現必須能轉成持久後續工作；只有口頭提醒或記錄失敗而無處理路徑，未承接原意 |
| §10 Escalation and Recovery | 第二層可重訂交辦、拆任務，或由人提供缺料；拆出的任務立即入 queue | 暫停的是受影響工作，不必推論整個專案一律停止 |
| §10a 雙層回饋表 | 微觀是 worker → queue，即時；宏觀是整合發現全域 DoD 未達 → 第二層 → 新工作包 | 執行中缺漏與最後整合缺漏都能補包，時間點不同 |
| §13a Mandatory Task Retrospective | 結案發現的新需求／缺口也呼叫 `create_subtask` | 可保留「不漏掉必要後續」，不能照抄成每次復盤一定新增任務 |

另一個可核對位置是 [C.A.S.E._Framework/README.md 固定版](https://github.com/Chiakai-Chang/Local-Agent-Workspace/blob/2c1d160013c763457269226fcc37b1b18728884a/C.A.S.E._Framework/README.md) 第 47 行的微觀回饋圖連線。

以上是原案協定要求，**未證明其 helper 已強制完成去重、交易一致性、相依環或權限檢查**。舊案固定三次重試、每案強制復盤／git 操作及任意新需求入列，也不能凌駕目前使用者授權、目標及相稱工作原則。

## 三份外部一手依據

### 1. 動態拆解與停止條件：Anthropic

來源：[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)，2024-12-19，`Orchestrator-workers`、`Agents`、`Combining and customizing these patterns`；2026-09-06 重查。

- **來源事實**：協調者可依當次輸入動態拆解子任務；執行以工具／環境結果判斷進展，並保留停止條件。更複雜的方法需要可量測的成果支持。
- **可採用推論**：工作清單可修訂，但每個新增項目必須指出具體缺漏與對原成果的必要性；「模型想到了另一件事」不足以成為必做項目。
- **限制**：這篇方法文章沒有提供耐久 queue、授權判定或去重演算法，也未驗證 CASE 或本地模型效果；頁面已提醒部分工具資訊過時。

### 2. 新工作注入與重複訊息：Temporal

來源：[Handling Signals, Queries, & Updates](https://docs.temporal.io/handling-messages)，`Inject work into the main Workflow`、`Message IDs and handling Continue-As-New`、`Update Validators`，2026-09-06 查閱。

- **來源事實**：訊息 handler 可把工作放進 queue，由主流程處理；序列化處理可降低競態。Update 的伺服器去重按 ID 且限單次 Workflow run；跨 Continue-As-New 需自行維護去重，Signals 也需應用層 idempotency key。Validator 接受與 handler 完成是不同狀態。
- **可採用推論**：區分「收到發現、判定採納、建立可執行工作、完成」；同一回報重送不能建立第二份工作。這些是 CASE 的資料語意建議，不是引入 Temporal 的理由。
- **限制**：Temporal 的訊息 ID 去重不能辨認兩個不同措辭其實在描述相同缺口；也不能替專案判斷新增任務是否在授權內。其服務保證不可移植成檔案式 queue 的 exactly-once 宣稱。

### 3. 接續狀態與知識分開：LangGraph

來源：[Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)，`Checkpointer vs. store`、`MemorySaver does not persist between restarts`，2026-09-06 查閱；`durable-execution` 入口本輪導向此頁。

- **來源事實**：checkpointer 保存單一 thread 的 graph 狀態，store 保存跨 thread 的應用資料；記憶體 saver 在程序重啟後不保留 checkpoints。
- **可採用推論**：未處理發現及其處置屬當次工作狀態，不能只留在聊天或當成知識筆記。真正可重用的教訓可另存，但不得取代待辦與相依。
- **限制**：這份頁面不提供 CASE 的重播、副作用隔離或檔案原子更新方案；這次不由改址後的 persistence 頁面推定已讀到 durable-execution 全部機制。

## 可採納的最小設計

以下是結合原案與來源提出的工程判斷，**不是上述來源已證明的實作規格**。不要求獨立 queue daemon、資料庫、多模型或新排程；同一 agent 也能在既有 session 間承接這些責任。

1. **先保存發現，再判斷處置。** 保存發現 ID、來源工作包與 revision、缺漏證據位置、受阻成果、建議的最小補救及必要權限。不要要求模型複製完整全域計畫。以權威狀態產生人類總覽，避免雙份帳本。
2. **分清修正、前置缺漏與範圍擴張。** 原工作包能處理的缺陷留在原包；必要前置在原授權內就採納補包；額外改善可記為延後／不採納；新權限或重要取捨才回到使用者。worker 的建議不自行成為新授權。
3. **採納時一次核對關係。** 協調者確認目前計畫 revision、與既有工作的重疊、必要輸入及權限、相依是否形成環，然後持久保存處置及任務關聯。找得到已存在的前置，就連到它；不為每個 worker 複製同一工作。實作時需決定單一寫入者或鎖定／版本比對，不能把多檔寫入想成天然原子。
4. **阻擋範圍與失效範圍要精確。** 必要前置未完成時，受影響工作待前置；獨立工作可繼續。前置通過後重新確認輸入版本，再接續受影響部分。來源改變導致下游證據失效時重新核對；不能僅因某個新任務存在就把所有完成工作重做。
5. **重送去重與內容合併分開。** 相同發現 ID 重送回傳同一處置；不同發現 ID 的相似內容則由協調者比較目標、產物、來源版本後決定合併。只用 slug 或文字相似度會誤合併不同版本／不同範圍的需求。
6. **沿用總成本與完成邊界。** 修訂／補包不重置已消耗成本；保留父來源與累積處理歷程。同一缺漏在相同證據下反覆出現時，辨認未解決根因或需要的新資料，不無限衍生子任務。停止可因原成果已滿足、需要外部決定或成本邊界；不得把可選改善全部清空才允許結案。

「收到但未採納」仍需有持久處置，否則接續時會重複研究。對具體必要前置，可由同一工具呼叫完成保存、檢查與入列，保留原案的即時微觀回饋；不要求每次多呼叫一個規劃模型或等待人同意。

## 反例與後續驗證問題

| 情境 | 錯誤做法 | 應觀察的行為 |
|---|---|---|
| 兩個 worker 都缺同一份價格對照表 | 各建一份任務，重複生成並互相覆寫 | 一份必要前置、兩個依賴者，保留兩筆發現來源 |
| 回報已保存，但回應在中斷前未送達 | 接續重送再新增一包 | 相同 ID 對應同一處置；不重複副作用 |
| A 發現缺 B，B 又要求 A 的完成產物 | 兩者永久等待 | 相依環被拒絕或由協調者重新切出可先完成部分 |
| 缺未授權的私人外部資料 | 新任務自行取得資料，或模型填入猜值 | 說明缺料及影響，保留其他有效成果並請求必要決定 |
| 來源從 revision 1 改成 2 | 只因文字相同而把新版缺漏去重掉 | 重新評估來源與受影響驗收，保留版本差異 |
| 報告已符合原要求，worker 提議再做儀表板 | 以「品質更好」不斷擴張清單 | 可選提議不阻止原任務交付 |

這些是未執行的驗證情境。接續測試應至少涵蓋回報重送、兩來源合併、相依環、來源變更及權限外需求，並觀察實際完成品質、漏做／重做、人工介入及總成本；不能只驗 queue 有新增列就宣稱自主重規劃有效。這次僅核對來源與文件，不執行模型實驗，也不判定目前 Kit 是否已涵蓋上述情境。
