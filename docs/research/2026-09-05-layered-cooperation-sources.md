# 分層協作與雙層回饋：一手來源核對

核對日期：2026-09-05。問題是如何沿用現有 coding agents，讓專案目標、工作包、執行回饋與可重用知識形成接續流程。本筆記只提供設計依據；未呼叫本地模型、未驗證 CASE 效果，也不改變[交付邊界](../GOALS.md)。

## 四份來源

### 1. Context engineering：以索引、按需讀取與外部筆記維持脈絡

來源：[Anthropic, Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)，2025-09-29，Context retrieval、Structured note-taking、Sub-agent architectures 段落。

- **事實**：文章描述輕量路徑索引、按需載入、context 外的持久筆記，以及主代理保留高層計畫、子代理處理聚焦工作的做法。也指出探索有延遲成本，壓縮可能遺失關鍵細節。
- **CASE 可採用推論**：大憲法保留目標與限制，小憲法帶入本工作包必要資訊和來源；可重用教訓另存索引，按需要取用。完整性應靠可追溯來源補足，不能只靠摘要。
- **不可外推**：這不是 CASE、本地模型或所有任務的效益實測；context 越小、子代理越多，不代表結果必然越好。

### 2. Long-running harness：角色分層可沿用同一執行工具

來源：[Anthropic, Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)，2025-11-26，Incremental progress、Future work 與註腳 1。

- **事實**：案例用需求清單、逐項進展、測試、進度檔和 git 接續。initializer 與 coding agent 的差別是初始 user prompt；system prompt、工具及 harness 相同。文章明示多代理是否勝過單代理仍是開放問題，案例針對全端網頁開發。
- **CASE 可採用推論**：專案規劃與工作包執行可以是既有工具中的不同任務／session，無須先建立不同 runtime；回報須包含驗證證據、未完成部分與下一步。
- **不可外推**：初始化後持續逐項完成，不等於已解決專案中途重規劃；也未證明通用領域或本地模型效果。

### 3. Effective agents：分工與回饋是可組合的方法

來源：[Anthropic, Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)，2024-12-19，Orchestrator-workers、Evaluator-optimizer、Agents 段落。頁面已提醒部分工具資訊過時，本筆記僅引用方法。

- **事實**：orchestrator 可動態拆解並整合 worker 結果；評估回饋循環適合驗收清楚且迭代有可衡量效益的任務。執行需用環境結果判斷進展，保留停止條件；複雜度應有成果證據支持。
- **CASE 可採用推論**：工作包內先依工具結果修正；若發現前提失效、跨包相依或驗收矛盾，再回到專案層調整路線與受影響工作包。這是雙層回饋的設計組合。
- **不可外推**：來源沒有直接驗證 CASE 的雙層閉環，亦不要求固定角色數、固定審閱輪數或採用 multiagent framework。

### 4. LangGraph persistence：接續狀態與跨任務知識分開

來源：[LangGraph, Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)，2026-09-05 查閱；原 durable-execution 路徑於本次核對導向此頁。

- **事實**：checkpointer 保存單一 thread 的 graph 狀態；store 保存跨 thread 的應用資料。RAM 型 saver 在重啟後失去資料；持久化需要適合的儲存實作。
- **CASE 可採用推論**：區分「本次做到哪裡」與「未來可重用知識」；保存任務修訂、產物／證據參照和下一步，接續時重新核對來源是否仍有效。
- **不可外推**：檔案式交接不等於 LangGraph checkpoint、故障復原或 exactly-once 執行保證。借用狀態分層概念，不構成引入 LangGraph、DB 或伺服器的必要性。

## 首要三個決策建議

以下是依上述來源與本專案邊界提出的設計判斷，不是來源已證明的 CASE 成效：

1. **把雙層回饋補成可操作規則。** 工作包內的修正依局部驗收與證據；涉及全域目標、前提、相依或成本取捨時，回報專案層重新判斷。回報應能導出「繼續、修訂工作包、重規劃、需要使用者取捨」，而非只更新完成狀態。
2. **先用現有工具與可攜文件承接責任。** 專案層保存目標、限制、路線與決策；工作包保存範圍、輸入、驗收、預算及回報；AI 工具負責 session、工具執行與權限。補回雙層回饋不意味需要自建 queue daemon、DB 或 multiagent framework。
3. **讓回饋成為選擇性更新的知識。** 只將有證據、可重用的教訓更新到相應規則／範本／索引，標示適用範圍、來源和失效條件；保留當次失敗與未知成本。先檢查這是否改善後續成果、接續與使用者負擔，再擴大自動化。

這次沒有比較模型、執行實驗或核對各 AI 工具的原生整合能力；工具支援現況仍以 [READINESS](../../workflow-kit/docs/READINESS.md) 為準。
