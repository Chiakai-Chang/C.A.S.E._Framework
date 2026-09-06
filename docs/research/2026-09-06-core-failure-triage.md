# 核心失敗：先排除環境與接線，再判斷架構

日期：2026-09-06。目標仍是讓本地模型在有限 context 下可靠完成工作；本次是研究與診斷，不是功能修復或效果驗收。

## 中斷與恢復

使用者插入 AppData 曾被刪除重建的背景。中斷前主線工具呼叫均已返回，沒有仍在等待的模型探測或安裝作業；當時 git 工作區乾淨。資料查證代理被中斷，已在原任務恢復，未重複建立研究。現存其他 node 與 llama-server 程序未任意終止。沒有需要回滾的產品修改，也未刪除／重裝全域 pi。

## 已確認的事實

### 1. 平常使用的 pi 確實有安裝缺損

`pi --version` 在 Node 24.19.0 下得到 ERR_MODULE_NOT_FOUND：全域 `@earendil-works/pi-coding-agent/node_modules/typebox/build/type/action/index.mjs` 不存在。PATH 中 pi 啟動器指向 AppData/Roaming/npm 的 0.84.2 套件。對應 package.json 和 typebox 入口存在，缺的是被匯入的相依檔案。

CASE 隔離副本 `.npm-cache/pi-host-validation/node_modules/@earendil-works/pi-coding-agent/dist/cli.js --version` 則成功回報 0.84.2，缺失檔案在該副本存在。抽查 system-prompt.js、agent-session.js、typebox/package.json 與 typebox/build/index.mjs，兩份 SHA256 相同。這不是完整套件完整性鑑識，不能說其他檔案全都正常。

目前預設 `.pi/agent` 目錄不存在，未找到 PI 前綴環境變數。這不能單獨證明設定遭刪除或沒有其他自訂設定位置。AppData 重建與安裝缺損相容，但沒有事件紀錄證明因果，不歸責於特定程式。

### 2. 四次 CASE 探測不是經由上述全域啟動器

探測使用明確 SDK 路徑、臨時 project／agentDir、記憶體設定、停用 skills／extensions；參見 [探測程式](../../workflow-kit/evaluation/feedback-probe.mjs)與[既有證據](../evaluation/case-feedback-development-evidence.json)。因此不能把全域 pi 啟動失敗直接當成四次讀取迴圈的原因。兩者仍共用 Node 與本機模型服務，隔離不代表完整供應鏈驗證。

### 3. 工具 schema 存在，但自然語言工具清單不一致

既有零模型呼叫診斷 `.npm-cache/feedback-tool-diagnosis-20260906.json` 保存的 systemPrompt 含 `Available tools: (none)`，接著說可能有自訂工具；同份證據的 active/model-visible 清單卻包含 case_write。

本機 pi 0.84.2 原始碼 `dist/core/system-prompt.js` 只把有 toolSnippets 的工具列入該清單；`dist/core/agent-session.js` 從自訂工具的 promptSnippet 收集它。CASE 的工具只有 description、沒有 promptSnippet。這是可定位的整合缺口，不是工具真的不存在，也不是已證明的唯一模型失敗根因。第四次追加能力 JSON 沒有移除前方的 `(none)`。

### 4. 「thinking off」只是 SDK 宣告，不能當成服務端已關閉

[探測程式](../../workflow-kit/evaluation/feedback-probe.mjs)註冊 model.reasoning=false、supportsReasoningEffort=false。已安裝 pi-ai 的 `dist/api/openai-completions.js` 在 model.reasoning=true 且相容格式匹配時，才會產生 Qwen 的 enable_thinking／chat_template_kwargs 關閉值；目前註冊沒有走該分支。

本次 GET `/props` 確認服務當下使用 froggeric-v22.4 模板，預設 enable_thinking=true，auto_disable_thinking_with_tools=false。再以相同合成訊息呼叫 `/apply-template`（只排版、不推論）：預設回傳的 assistant 前綴開啟 think；明確傳 chat_template_kwargs.enable_thinking=false 時，前綴立即關閉 think。兩次皆 HTTP 200，沒有模型生成、沒有改服務設定。

因此舊報告中的 thinking off 應理解為「請求端設定」，實際服務端狀態未被當時證據確認。不能以這次觀察倒推四次歷史請求的全部參數，也不能因此斷言重複讀取就是思考模式造成。`/props` 當下預設抽樣有 temperature=1，probe 未明確固定抽樣參數；這是後續對照要控制的變因，不是建議直接改成零。

## 處理順序與可否證的判斷

| 優先 | 行動 | 判定方式 |
|---|---|---|
| 1 | 全域 pi 維修獨立處理：備份確認過的套件／設定位置，以可用的 Node 隨附 npm 重裝固定版本，先不恢復舊 harness 擴充 | 啟動與 SDK import 成功；不把修好 CLI 算成 CASE 成功 |
| 2 | 修正 CASE 工具提示接線，沿用 pi 的 promptSnippet 介面，避免再追加一份矛盾說明 | 真實 SDK 組裝的清單與工具 registry 一致，讀／寫／回報實際可完成 |
| 3 | 對齊模型設定與最終請求；記錄實際 enable_thinking、抽樣值、輸出上限及停止原因 | 模板與 payload 核對；不以 UI 或 SDK 標籤代替證據 |
| 4 | 固定相同模型／資料／工具，以單一 worker 完成目前失敗的正規化包 | 產物獨立核對；逐項改動，不同時換模型、提示、量化與迴圈 |
| 5 | 加回正確的兩包計畫，再測缺前置 → 回報 → 修正 → 完成 | 必須實際補做並通過最終成果核對；不能只看有回報或安全停止 |

這是縮小診斷範圍，不是把完整產品降級為最小版本。未確認全域套件修復授權／必要寫入權限前，不直接覆寫 AppData。既有隔離副本可繼續研究，但正式效果比較前應核對固定版本來源完整性。

如果單 worker 也失敗，先比對最終送出的工具呼叫與 tool_call_id／工具結果歷史，再查模板、模型或服務；如果單 worker 成功但分包失敗，才將主要調查轉向交辦內容與規劃回饋。重複讀取可加有界停滯偵測以降低浪費，但「更快停止」不是「完成核心功能」。

## 暫不採取的方向

不先更換整個框架、不清空全域設定、不把舊 harness 的 JSON 假工具轉譯器搬回來，也不先強迫所有工作改為產物一次提交。候選產物模式只在排除接線問題後，作為特定工作類型的對照方案。全域權限、契約與驗收不因診斷放寬。

舊 harness 的 `docs/retro/2026-07-27-pi-stall-root-cause-and-prompt-diet.md` 記錄過假工具呼叫、工具名對不上與過量技能索引；本次實際有成功 read 工具結果，且禁用技能，不能套用舊根因。該文件是歷史線索，不是本次原因證明。

## 一手研究依據

- [Anthropic：工具設計與實際評估](https://www.anthropic.com/engineering/writing-tools-for-agents)：工具介面需以 agent 實際行為評估，檢查冗餘呼叫與無效參數，不能只核對 schema。本文用於決定診斷方法，不當成 CASE 效果證據。
- [Anthropic：context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)：必要且清楚的 context、精簡工具與按需資料。推論：應先消除互相牴觸的能力資訊，再討論更複雜編排。
- llama.cpp 與工具歷史相容性另見 [查證筆記](2026-09-06-tool-calling-compatibility.md)；實際行為仍以此機版本與模板測試為準。

結論：已找到全域安裝缺損，以及 CASE 提示／模型設定接線問題；尚未完成修復或證明哪一項造成重複讀取。研究優先順序由「改執行架構」修正為「先修可確認的接線缺口，再驗證核心旅程」。
