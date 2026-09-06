# llama.cpp 工具呼叫相容性：先隔離設定與 history

日期：2026-09-06。範圍：pi SDK 0.84.2 的 `openai-completions` 接本機自訂 Qwen3.8-27B Orcarouter FP4；已回報反覆讀取、沒有寫入。這份筆記查核官方文件，沒有執行模型生成，也不由模型名稱推定實際能力。以下 upstream `master` 連結是查閱當日資料，未固定提交；不能代替本機版本的行為證據。

## 官方來源可以確認什麼

- llama.cpp 的工具支援依賴 Jinja 與能表達工具的 chat template。官方建議用 `/props` 查看 `chat_template`／`chat_template_tool_use`，必要時才覆寫模板。支援 generic 格式不等於每個模型都有可靠工具能力。`parallel_tool_calls` 僅部分模型支援，文件列為預設關閉；首次隔離問題應明確設為 `false`。[function-calling.md](https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md)
- `reasoning_format: "none"` 代表不解析推理文字，不等於停止 thinking。現行文件另外提供 `chat_template_kwargs: {"enable_thinking": false}`，以及 `reasoning_effort: "none"` 等控制；本機版本是否支援、client 是否真的送出，都須核對。`/apply-template` 可回傳格式化 prompt 而不進行推論，適合檢查設定和 history 是否進入模型可見內容。[server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
- llama.cpp 官方工具結果測試先放 `assistant.tool_calls`，再放 `role: "tool"` 的結果，使用相同 `tool_call_id`，並檢查模型是否以結果回答、停止再呼叫工具；同時涵蓋串流與非串流。這提供最小 history 往返的參照，不代表這個自訂模型已通過。[test_tool_call.py](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/tests/unit/test_tool_call.py)
- 模板與 parser 的連動值得獨立檢查：官方 autoparser 文件描述從模板辨識工具、推理標記並產生 parser，另有 template analysis/debug 工具。模板能輸出文字與 server 能把生成解析成正確 `tool_calls`，是不同的檢查點。[autoparser.md](https://github.com/ggml-org/llama.cpp/blob/master/docs/autoparser.md)
- Qwen3-32B 原版模型卡確實區分 thinking／non-thinking 設定，並警告 thinking 模式下 greedy decoding 可能反覆生成；這只能說明取樣與模板是潛在變因，不能直接套用至本案自訂模型，更不能據此認定 FP4 是原因。[Qwen3-32B 官方模型卡](https://huggingface.co/Qwen/Qwen3-32B)

## 本機查核與仍未證明的部分

下列是本輪主代理回報的本機查核，並非網路來源或本研究子工作自行重跑的結果；原始輸出與程式位置由本輪診斷主報告保存：

1. 已保存的診斷 `systemPrompt` 出現 `Available tools: (none)`，即使 HTTP payload 有 `tools`。自訂工具缺少 `promptSnippet`，SDK `system-prompt.js` 以 snippet 篩選；因此工具描述存在互相矛盾的兩層輸入。
2. 探測設定為 `reasoning: false` 且 `compat.supportsReasoningEffort: false`，使 SDK 的 `qwen-chat-template`／`enable_thinking` 分支沒有執行。介面上的 thinking off 尚不足以證明 template 收到停用值。
3. 本機 `/props` 顯示 froggeric22.4 模板，`enable_thinking` 預設為 true、`auto_disable_thinking_with_tools` 為 false。`/apply-template` 的預設輸出留下開啟的 think 前綴；明確送入 `chat_template_kwargs.enable_thinking:false` 則關閉 think 區塊。這是格式化結果，尚非生成行為或工具成功率。

以上已支持「先修正或隔離工具描述與 thinking 設定傳遞」的優先順序；尚未證明它們就是反覆讀取的充分原因。主代理後續確認全域 pi 因相依檔案缺失而無法啟動、隔離副本可啟動，見[環境診斷](2026-09-06-core-failure-triage.md)；是否由 AppData 事件造成仍未證明，也不能直接當成 CASE 迴圈原因。

## 最小隔離診斷建議（尚未執行生成）

先保存既有相鄰兩輪的 HTTP request／response 與工具執行結果，去除私人資料。核對每個 call 的 id、name、完整 arguments、回傳結果及下一輪 history；確認成功結果沒有遺失、重複插入、被截掉或誤標角色。若問題只存在串流，才比對 arguments 分段組合與 finish reason。這些是針對協定錯誤的診斷推論，不是已發現的 bug。

在已確認的本機版本，用 `/apply-template` 對照實際 payload 與修正後 payload：工具清單、上一輪工具結果、下一個 assistant 前綴、thinking 開關都要可見且一致。不要先換整套架構或臆測另一個 Qwen 模板適用。

需要生成驗證時，先用一個只回傳固定值的假工具、短提示、`parallel_tool_calls:false`、明確 thinking 設定與有界輸出做一次兩輪往返：呼叫工具 → 回傳帶 id 的結果 → 要求回答該值。先測 `auto`；若未呼叫，才以 `required` 隔離「格式能否生成」與「自主選擇工具」。不執行真實寫入。若直接 HTTP 正常而 pi 不正常，優先查 client/history；兩者都失敗才往模板/parser／模型與取樣排查。

只有在這個最小往返正常後，再加入一個假寫入工具檢查讀取 → 寫入的選擇。若最小流程正常、完整 CASE 流程仍重複讀取，才把提示衝突、context 負荷或任務策略列為較強假設。即使 history 與格式皆正確，單次失敗仍不足以判定模型普遍無能力；需保留相同設定下的有限重試與失敗成本。
