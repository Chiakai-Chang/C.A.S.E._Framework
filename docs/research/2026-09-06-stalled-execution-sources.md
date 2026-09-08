# 執行停滯：工具觀察、進度與有界接續的一手來源

查閱日期：2026-09-06。這份研究只整理五個一手來源及可反駁的實驗方向；沒有執行模型生成、修改產品或調整模型服務。來源的工程經驗不等於本機模型的效果證據。

## 已知邊界

[真實任務報告](../evaluation/2026-09-06-real-task-report.md)記錄：一般 pi 未讀來源而反覆寫 placeholder；CASE 規劃者約花 506 秒，讀過完整 155 行 install.mjs 後仍誤判缺少前段，工作者沒有寫出指定成果。兩者不能概括成同一種「讀取循環」。本文不重新分析 raw trace，精確的路徑／範圍判斷仍受當時 CASE 未保存完整 read args 限制。

[recurrent／MTP 查核](2026-09-06-recurrent-cache-triage.md)已有版本與快取對照；[工具相容性筆記](2026-09-06-tool-calling-compatibility.md)已有 history、thinking 與模板診斷。本文只補「如何識別並處理停滯」，不把既有未證實假說升格為根因。

## 五個來源

### 1. 工具回傳必須讓模型知道拿到了什麼

[Anthropic：Writing effective tools for agents — with agents](https://www.anthropic.com/engineering/writing-tools-for-agents)，2025-09-11 發表；重點段落：Returning meaningful context、Optimizing tool responses、Analyzing results。

- **來源事實：** 建議提供與下一步相關的工具內容，使用適當分頁／範圍／截斷，截斷與錯誤需提供可行動說明。重複工具呼叫可能提示分頁或輸出上限不合適；應核對原始呼叫與結果，並量測正確性、時間、tokens、工具錯誤。格式效果依任務與模型而異。
- **CASE 推論：** 讀取結果可用明確的 `path`、實際回傳範圍、總範圍與 `truncated`／EOF 資訊，幫助區分「檔案缺料」和「已讀完整」。對重讀的判斷必須包含內容版本與範圍；來源 hash 可留作 runner 觀察，不必每輪把冗長 hash 塞給模型。
- **限制：** 官方沒有證明這套欄位能解決 CASE 誤判；完整原文已回傳仍被誤讀，也可能是模型理解或 history 表達問題。不能假定「再加 metadata」必然有效。

### 2. 按需取用不等於永遠繼續探索

[Anthropic：Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)，2025-09-29 發表；重點段落：Context retrieval、Context engineering for long-horizon tasks。

- **來源事實：** 輕量索引搭配按需讀取可減少預載；探索會增加延遲，工具或引導不足時仍會浪費 context。文件亦描述先提供部分資料、再自主探索的混合方式，以及保留關鍵決策並移除重複結果的壓縮方式。
- **CASE 推論：** 四份已知凍結來源可比較「同一內容的完整材料包」與「逐工具讀取」。若改用材料包後完成，證據支持探索／交互成本值得改善，仍需進一步拆開格式、長度與 history 的影響。
- **限制：** 來源未給通用最適 context 長度，亦未證明增加 context 或壓縮就能解決本機循環。摘要可能漏掉驗收所需細節，不能以摘要生成的假缺口替代原文。

### 3. 停止條件可控制成本，但不是成果證明

[Anthropic：Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)，原始發表 2024-12-19；頁面會更新，本文採查閱日內容。重點段落：Agents、Combining and customizing these patterns。

- **來源事實：** agent 應從工具結果或執行等環境回饋評估進度；常設最大迭代次數等停止條件。增加複雜度應有可量測的成果改善支持。
- **CASE 推論：** 在既有總時間／turn 上限內，先辨識「觀察覆蓋率、候選成果、驗收狀態均無變化」的連續區段，再提供一次有界接續提示：指出已取得材料、尚缺成果與剩餘預算，要求做下一個可驗證動作或回報具體缺口。規劃預算也應避免吃光後續執行／核對所需時間。
- **限制：** 「一次」、「停滯窗長度」與階段預算配置都是 CASE 候選設計，並非來源已驗證的常數。最大迭代只能保證終止；提早取消但仍缺成果，不能算品質提升。

### 4. 進度應連到可驗收的產物

[Anthropic：Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)，2025-11-26 發表；重點段落：Incremental progress、Testing。

- **來源事實：** 文章描述跨 session 的增量工作、可接續紀錄與端到端驗證；僅有壓縮仍不足，模型也可能在部分工作完成後過早宣稱完成。
- **CASE 推論：** 停滯偵測不要只看 write 次數。只有與使用者指定成果相關、內容有實質變化的候選產物，才算產物進度；仍須區分寫出、結構有效、內容核對通過。CASE 的計畫版本增加是規劃進度，不能自動當成使用者成果進度。
- **限制：** 網頁開發的工程案例不是本機資料整理的對照實驗；不能據此要求所有小任務先增加 initializer、固定角色或更多紀錄檔。

### 5. 工具呼叫相容性要分層核對

[llama.cpp：Function Calling](https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md)，持續更新文件，原始發表日期未在讀取頁面取得；此連結未固定提交。重點段落：Universal support w/ Native & Generic handlers。

- **來源事實：** 文件說明 `--jinja`、原生／generic 工具格式處理器與必要時的模板覆寫；generic 格式可能較耗 tokens。多工具平行呼叫只有部分模型支援，文件列為預設關閉。
- **CASE 推論：** 先核對既有 payload 的工具定義、assistant call、對應 tool result 及下一輪模型可見格式，再判斷是否需模板對照。成功產生可解析 call，與理解工具結果、選擇寫出正確成果，是不同檢查點。
- **限制：** 支援清單不能證明自訂 Qwen／量化／fork 的可靠度；generic handler 也不等於 bug。已有正確 call 但語意停滯，尚不足歸因模板；本機版本仍以既有查核筆記為準，不用 upstream master 取代。

## 可反駁的實驗預測（尚未執行）

各比較保留相同任務、凍結材料、模型／服務、採樣、總成本上限與評分器；一次只動一項。保留全部失敗及未完成生成的未知 usage，事前限制次數，避免挑成功樣本。

| 候選假說 | 最小對照與預測 | 反證或限制 |
|---|---|---|
| 讀取完整性表達造成誤判 | 同一內容僅加明確回傳範圍與 EOF；預測缺前段的錯誤陳述、相同版本重讀下降，且正確成果不降 | 誤判與重讀不變則弱化此介面假說；僅少讀但成果錯誤不算成功 |
| 探索／history 交互成本拖累執行 | 同內容材料包對逐讀，預測較早產出有效候選成果 | 仍不產出則不能靠縮減工具回合解釋；成功亦非直接證明 context 長度是原因 |
| 規劃吃光共用預算 | 同總上限，比較有／無執行與核對保留額度；預測更多流程抵達候選成果並完成驗收 | 有執行時間仍反覆讀或寫錯，說明階段分配不是充分解法；規劃太短也可能降低品質 |
| 可觀測停滯提示有幫助 | 固定無進度窗口後只給一次狀態提示；預測恢復不同且有用的動作 | 僅改寫計畫／換路徑重讀／placeholder write 不算恢復；需納入重讀變更檔、補分頁、修復後覆核等合法重讀反例 |
| history／模板接線有問題 | 先唯讀核對同一相鄰請求的 call/result 關係和格式；只有找到不一致才做隔離修正對照 | 完整結果確實可見且短工具往返成功，僅降低一般協定錯誤的支持度；不排除長 history、模型能力或取樣問題 |

離線觀察的最小單位可包含工具名稱、正規化 args、結果成功／失敗、來源版本與實際範圍、產物變化及驗收變化。讀取覆蓋率代表「取得資訊」而非「理解資訊」；新範圍也可能無關，故不得當成單一成功指標。elapsed time 同時含推論與工具等待，需與 tool count 分開。

## 本輪不推薦的方案

- 固定「同檔讀 N 次即禁止」：無法區分新增內容、分頁、修復覆核與真的停滯，可能讓模型無法完成合法工作。
- 強制 tool choice 為 write／result，或把任何寫檔當進度：可能只把缺成果改成 placeholder 或錯誤完成宣告。
- 把延長總時間、增加角色、更多必讀提示當預設修復：這次已有規劃耗時高的觀察，新增負擔須有對照證據。
- 沒有先隔離就同時更換模板、thinking、sampling、快取和 MTP：無法判斷哪項改動相關，也會混入既有服務風險。

本筆記不修改目前產品承諾；方向仍依 [GOALS](../GOALS.md)：讓本地模型完成正確成果並降低使用者負擔。來源核對完成；產品、模型效果及候選策略的驗收均未執行。
