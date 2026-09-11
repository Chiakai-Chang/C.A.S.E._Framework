# 跨 session 目標、驗收修復與有界接續：一手做法

查閱日期：2026-09-11。範圍限 Anthropic 與 LangGraph 官方材料；這是供現有 CASE 接線復盤的研究，沒有新增 runtime、排程或其他模型實測，也不代表 CASE 已具備或已驗證以下全部能力。

## 可以直接對照的做法

| 關切 | 官方材料所支持的做法 | CASE 採納判斷／限制 |
|---|---|---|
| 目標跨 session | Anthropic 保存完整功能驗收清單、進度及版本歷史；新 session 先定位現況、檢查基本功能，再做下一項未完成工作。壓縮本身不足以避免半成品與提前結案。[長任務 harness](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | 沿用既有共識、計畫、驗收與成果索引；接續必須能看見「原目標尚缺什麼」。不需再造同義清單；摘要不得取代尚未驗收項目。 |
| 驗收與修復閉環 | Anthropic 要求實際測試後才標記通過，並指出單元測試或 API 請求仍可能漏掉端到端錯誤；案例工具本身也有盲點。[長任務 harness](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | 對應使用者成果核對，不用合法回條或角色完成標記代替內容正確。每個缺口接回可執行修復；完成需重驗成果，不只重驗提交格式。這是 CASE 應核對的條件，不是來源替本地模型效果背書。 |
| 反覆修正是否值得 | evaluator–optimizer 適用於驗收明確且反覆修正有可量測收益；每步從工具／環境取得事實回饋，並設停止條件。[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) | 返修回報應指出失敗條件、依據、受影響成果及下一步。連續重讀或換措辭不算改善證據；原授權及預算內能修便接續，超出才停留在未完成狀態。 |
| 可接續的狀態 | LangGraph 區分單一 thread 的 checkpoint 與跨 thread 的 store；記憶體 saver 在程序重啟後會失去資料。[Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) | 檢查現有持久狀態是否保存目標版本、進度、缺口、成果位置與剩餘預算；新模型 session 不應等於新任務或預算歸零。這些欄位選擇是 CASE 推論，非 LangGraph 固定 schema。 |
| 暫停與安全重播 | LangGraph interrupt 以同一 `thread_id` 接續，但會從節點開頭重跑；interrupt 前的副作用應具冪等性，或移到另一節點。中斷不應被一般 catch 吞掉。[Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts) | 檢查提交、回饋新增與成果寫入的重複執行邊界；不得把「已存 checkpoint」等同外部操作恰好一次。等待輸入是保存未完成狀態，不是放寬驗收。 |
| 停止與成本 | LangGraph 將單次 timeout、有限 retry 與耗盡後的 recovery 分開；timeout 在每次重試重設。協作停止會等目前步驟及其 retry 結束，並非立即中止。[Fault tolerance](https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance) | 單次上限不能代替整案預算。所有 session、返修與重試都應計入原帳本；停止需保存成果、缺口及原因。取消到實際停用的額外成本仍須觀察，不宣稱零成本停止。 |

## 本次應優先核對的最小接續鏈

以下為綜合來源後的 CASE 判斷，不是導入 LangGraph 的建議：接續先讀原目標與未過驗收 → 檢查既有成果及版本 → 在原授權／剩餘預算內處理一個具體缺口 → 以成果事實重驗 → 將新狀態持久化。只有所有必要驗收通過才結案；預算用完、取消、缺權限或無法接續都保留未完成及可重啟位置。

檢查重點是 runner 是否確實把失敗帶回可執行下一步，以及新 session 是否沿用同一任務／預算。若已有接線，應先修缺口並用相稱案例核實，不能因外部文章有多角色就增加角色或強制輪數。Anthropic 明確主張只在結果改善有證據時增加複雜度。[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)

## 來源與適用界線

- Anthropic 長任務文章發布於 2025-11-26，案例針對 Claude 的全端網頁開發；文中仍將單一／多 agent 優劣及其他領域泛化列為開放問題，不能推定本地模型有相同效果。[原文](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- LangGraph 是機制參照，持久化與控制流程不保證語意驗收正確。此次 `durable-execution` JavaScript 網址實際導向 [Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)，因此引用查閱當日落地頁。Fault tolerance 文件的節點 timeout／error handler／graceful shutdown 標示要求 `@langchain/langgraph>=1.4.0`；本研究未安裝或驗證該 SDK。[版本限制](https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance)
- 本筆記未提出可保證收斂的通用輪數、token 上限或成本收益；這些值需要依既有授權、模型與成果驗收設定，並保留失敗及未知成本。
