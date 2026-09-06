# 使用者補充來源：意圖、接棒產物與技能分工

日期：2026-09-06。這份筆記補上使用者明確指定、前次回覆漏未整合的三個連結與貼文。不是新產品完成報告，也不是 GitHub 整合計畫。使用者再次釐清：Issue／PR 只借用協作概念，框架須適用於非 GitHub、非軟體開發任務。

## 1. 貼文：作為研究線索，不直接當成官方承諾

使用者附件 `pasted-text.txt` 為 2026-08-26 brewbytes.ai 貼文及頁面介面文字。其重點是：前階段產物成為後階段 agent 的 context，並串接意圖、設計、計畫、成果、驗證及維運回饋。已讀附件；不將私人頁面資訊、頭像 URL 或整篇貼文複製進 public repo。

本輪回查下列 Claude Academy 原文。貼文中的速度敘述、Git 身分／批准推論及完整 SDLC 自動化，不作 CASE 已驗證效果或安全保證。Git 提交者也不必然等於實際決策人，批准仍須明確綁定內容與版本。

## 2. Claude Academy：將需求原意保存成可接續產物

指定來源：[Capture as intent.md](https://academy.claude.com/courses/ai-native-sdlc-playbook/capture-intent)。另按關聯閱讀 [Requirements and design](https://academy.claude.com/courses/ai-native-sdlc-playbook/requirements-and-design)、[Skills as institutional knowledge](https://academy.claude.com/courses/ai-native-sdlc-playbook/skills-as-institutional-knowledge)、[Give Claude a feedback loop](https://academy.claude.com/courses/ai-native-sdlc-playbook/give-claude-a-feedback-loop)。查閱日期同上；動態網站無固定提交版本。

- **來源事實**：意圖可來自人的想法、ticket 或事件；記錄想要什麼、為什麼及限制，讓下一階段可直接使用。課程要求負責人核對原意，需求／設計階段延續未決問題。重複方法可以編成技能。
- **採用**：把使用者原意、AI 的解讀／方案、實際驗收結果分清楚，以版本與引用串接。交接不只帶「下一步做什麼」，還要帶必要理由、限制與未解問題。
- **不照抄**：不強制新增根目錄 `intent.md`／`spec.md`／`plan.md` 三份檔案，不要求所有任務走六階段 SDLC、使用 GitHub 或每階段人工批准。沿用既有共識／contract／packet，按原授權與風險決定何時詢問。
- **技能邊界**：官方明示技能屬指引性控制，不能強迫每個 session 遵守。CASE 的去重、權限、版本與拒絕錯誤結案，仍由核心／AI 工具的執行機制保障；技能教 agent 如何使用。
- **自查不等於獨立核對**：feedback loop 課程明確區分工作期間反覆檢查／修正與新 context 的最後驗收，並要求防止為了通過而弱化檢查。這直接支持先前使用者指出的缺口；仍不是零失敗保證。

## 3. roboco-io/intent-engineering：Why／What／Not／Learnings

指定來源：[repository README](https://github.com/roboco-io/intent-engineering)、[INTENT.template.md](https://github.com/roboco-io/intent-engineering/blob/main/INTENT.template.md)，2026-09-06 查閱 main。未取得固定提交 SHA，因此只作當日內容研究，不宣稱可逐位元重現。

- **來源事實**：作者將方法定位為一份文件與工作紀律，不是框架或工具。意圖涵蓋原因、要做什麼、不做什麼與探索所得；允許探索、釐清或依證據放棄。
- **採用**：工作不能只有操作清單；每個必要新增任務應能回連原問題、預期成果或驗收缺口。保留未知與不採納的理由，避免執行者將猜測固化成需求。
- **不照抄**：不新增同名根目錄文件，也不把「交給 AI 完成驗證與部署」解讀成無限授權。`Not` 中的硬性禁止、範圍排除及品質門檻在 CASE 要分清楚，不能以普通待辦處置取消硬限制。
- **證據限制**：這是作者提出的方法／範本，不是本地模型遵循率或工作品質提升的實驗。

## 4. dianyike/claude-code-insights：指引、技能與強制機制分開

指定來源：[CLAUDE.md 最佳實踐指南（zh-TW）](https://github.com/dianyike/claude-code-insights/blob/main/claude-md-best-practices.zh-TW.md)，2026-09-06 查閱。

- **參考用途**：作為社群整理與查漏線索，尤其是常駐指引、按需文件、技能及工具檢查的分工；不是 Anthropic 官方規格。
- **採用方向**：共識只放需要一直維持的目的與限制；方法按需載入；當前工作與待辦留在持久狀態；歷史研究以 MAP 導航，不全部塞進每個 worker。
- **不直接採信**：文中 hooks 範例、載入優先順序和研究百分比須回到官方文件／原論文核對，不複製成可執行設定；不能由特定 benchmark 推導「所有 init 都有害」或固定文件行數能保證品質。
- 技術核對另見[官方來源對照](2026-09-06-instruction-skill-source-check.md)，將實際誤差及適用範圍獨立列明。

## 5. 對本次設計的實際調整

| 資料／責任 | 要回答的問題 | CASE 對應，不另造平行帳本 |
|---|---|---|
| 原意 | 為什麼做、誰受益、何謂成功、不能做什麼 | 專案共識與本次 contract，必要時引用既有需求材料 |
| 發現與工作提案 | 發現什麼、證據、影響、是否需要另做 | discoveries 佇列；received 不等於 accepted，更不等於完成 |
| 工作交辦 | 如何在範圍內取得可驗收成果 | packet 的目的、來源、相依、writeScope、checks |
| 成果與核對 | 實際交了什麼、哪些通過、還缺什麼 | attempt、產物版本、檢查與 review／integration |
| 接續與經驗 | 哪些仍有效、哪些需更新、為何改決定 | 修訂／處置歷程與有來源的知識筆記 |

**Skills 適合承載協作方法，不適合充當唯一工作資料庫或權限邊界。** 技能內可以包含範本與腳本，但資料保存與執行保障不能因此被說成「模型會遵守指引」。不同 AI 工具支援程度仍需分別驗證。

Issue／PR 概念在此只意味「提案與採納分離、成果與接受分離、討論有處置、修訂可追溯」；不增加 GitHub API、遠端 ticket、固定六階段或所有工作都要程式碼 diff 的要求。

## 接續狀態

此節保存來源整合當時的狀態，不是最新交付表。後續需求到程式／技能／測試的對照已集中到[同一份設計的追蹤章節](../design/2026-09-06-discovery-and-repair.md#需求到交付的單一追蹤)，目前實測以 [READINESS](../../workflow-kit/docs/READINESS.md) 為準。

已批准的[動態發現與修復設計](../design/2026-09-06-discovery-and-repair.md)繼續適用，以上是補充來源與語意修正，不撤銷已批准的工作。本輪沒有因這些來源新增外部服務或變更使用者目標。中斷前新增的 queue 核心與測試仍是未完成工作：pi 即時回報接線、完整自查流程及整體驗證尚未完成，不能以先前 125 項測試宣稱新功能通過。
