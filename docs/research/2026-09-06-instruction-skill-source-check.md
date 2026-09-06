# CLAUDE.md、技能與分工參考查核

查核日期：2026-09-06。使用者指定的[社群指南](https://github.com/dianyike/claude-code-insights/blob/main/claude-md-best-practices.zh-TW.md)供設計參考，不作產品契約或效果證據。本次讀取其全文，重點核對第 3、6、8、9、11、15 節；指南為 `main` 當時頁面，未取得固定提交識別碼。官方文件也可能更新；以下是當日文件查核，沒有安裝驗證或本機模型實驗。

## 可採用的方向

- 共用指令保留跨任務必要的目標、限制與入口；具體工作方法放技能，細節提供有觸發條件的參照。官方同樣建議簡明、可核對的指令，將多步驟流程移到技能。這支持 CASE 減少重複脈絡，並不要求刪除使用者意圖或交接必要材料。[官方 memory](https://code.claude.com/docs/en/memory)
- 技能與獨立執行是兩個選擇：技能可以在原對話執行；`context: fork` 才建立子代理脈絡。後者不取得原對話歷史，因此交辦仍須自足，不能假設「隔離」已自動保留目的與驗收。[官方 skills](https://code.claude.com/docs/en/skills#run-skills-in-a-subagent)
- 能由程式判斷的條件可交給既有測試、檢查器或工具攔截；自然語言仍負責目的、取捨與必要脈絡。採用機制要按 AI 工具實際支援，不把 Claude 專有設定直接套到 pi。[官方 hooks](https://code.claude.com/docs/en/hooks)

## 必須修正或不可直接採用

| 主題 | 查核與採用邊界 |
|---|---|
| 指令載入 | `.claude/rules/` 未設 `paths` 的規則才在啟動時載入；有 `paths` 可按檔案條件載入。單純拆檔不省 context，但不能概括全部 rules 都常駐。`@` 匯入會展開載入，不是按需連結；巢狀 CLAUDE.md 是追加脈絡，不是可靠的設定覆寫機制。[官方 memory](https://code.claude.com/docs/en/memory#organize-rules-with-clauderules) |
| Hook 範例 | 指南的事件名稱 `pre-tool-use` 應為 `PreToolUse`；`matcher` 應是字串（例如 `Bash`），不是 `{tool_name: ...}`；處理器放內層 `hooks` 陣列並指定 `type: command`。事件 JSON 從 stdin 取得，不能假設有 `$TOOL_INPUT`。以 exit 2 拒絕時，回饋文字應寫 stderr。該範例不能原樣安裝。[官方 hooks](https://code.claude.com/docs/en/hooks#configuration) |
| 確定性承諾 | 正確的前置 hook 可攔截符合條件的工具呼叫；不能保證模型下一次必然改對。`PostToolUse` 執行時操作已完成；只查命令開頭也不是完整 shell 政策。不可承諾全部 hook 零成本或所有操作都受控。[官方 hooks](https://code.claude.com/docs/en/hooks#exit-code-output) |
| 技能成本 | 技能描述供選用，完整內容在呼叫時進入脈絡；不等於未啟動時零成本或每個技能都隔離。`context: fork` 需明確任務，僅有一般慣例可能無法產生有意義成果。[官方 skills](https://code.claude.com/docs/en/skills) |
| 維護責任 | 「只能人工寫、不得讓 AI 更新」及固定每週審閱是社群偏好，並非官方必要條件。官方提供 `/init` 後再精修的工作方式。CASE 依本 repo 授權與維護原則保留可追溯修正，不增加固定排程。[官方 memory](https://code.claude.com/docs/en/memory#set-up-a-project-claudemd)、[本 repo 維護原則](../MAINTENANCE.md) |

## 研究數字的適用範圍

指南引用的 [Evaluating AGENTS.md v1（2026-02-12）](https://arxiv.org/html/2602.11988v1)不是 CASE 實測。§4.2 對 SWE-bench Lite／AGENTbench 分別報告自動產生檔案的平均解題率變化 −0.5%／−2%、平均成本 +20%／+23%；其引言另用平均 −3% 概述，不能把「下降 2–3%」視為所有情境定律。手寫檔案的平均 +4% 也不代表 Claude Code 改善：§4.2 明列 Claude Code 是未改善的例外。

研究使用四組 agent／模型、以 Python 為主的兩個 benchmark，每案抽樣一次；主要衡量測試通過率。論文保留其他語言、安全性與程式效率的未知。因此可採用「減少無必要要求、驗證額外成本」的方向，不能推出「自動生成必定有害」「手寫必定更好」「文件越短越好」，更不能替本地模型的意圖保留、長任務交接或多代理效果背書。[論文 §4–5](https://arxiv.org/html/2602.11988v1#S4)

本次判斷：用參考文協助分配資訊位置；CASE 的專案共識、整體計畫與工作包各保留其必要語意。任何刪減或分工仍以成果品質、可接續與總負擔驗證，不以字數、技能數或角色數代替效果。
