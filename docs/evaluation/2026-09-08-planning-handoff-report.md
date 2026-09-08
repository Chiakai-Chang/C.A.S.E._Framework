# 規劃與執行責任分界：修正及實測

日期：2026-09-08。基準 `037966b`。使用者已確認本批只調整交辦資訊，保留驗收、回饋、權限與總預算；目標仍是本地模型完成正確成果、降低監督負擔。

## 復盤與取捨

[上一批原始證據](2026-09-08-read-receipt-evidence.json)顯示：A／B 規劃分別用 219.641／346.735 秒；B 把來源推得的大量答案寫進 `checks.text`。A 的 worker prompt 為 9,269 字元，B 為 18,621；B 已附 HOSTS.md、MAINTENANCE.md 全文，仍再次讀取。這些是可觀察行為，不是對隱藏推理的推測，也不能證明唯一根因。

不能只再加一句「不要先做工作」：既有指引已寫過。也不先加硬性階段截止，因為較早失敗不等於較高品質。本批沿用原案大小憲法與按需取用脈絡：

- 規劃者用 `case_list` 取得有界、非遞迴的名稱／類型／大小概況，不為估計大小讀完整正文。概況不證明內容、相關性或授權；不得略過適用指引。
- 計畫交付工作方法、相依與驗收依據，不將規劃者新推得的答案變成不可挑戰的標準；使用者要求的精確值仍保留。必要調查仍可讀取；大量調查可形成有成果／相依的工作包，不固定增加角色。
- 執行者區分 `requiredMaterials` 的已附全文和 `materialIndex` 的待讀參照。不禁止因來源改變、具體疑點、成果核對或 context 壓縮而重讀。

## 實作與驗證

修改 pi 規劃工具／交辦指引及共用 context 材料說明，沒有新增設定、任務欄位、排程或權限，也不是語意正確性的程式保證。兩個材料概況反例先失敗再修正，涵蓋不讀正文／不遞迴／排除設定目錄及超量拒絕。比較器另測載入基準前的版本核對，重現先載入才核對的順序問題後修正。完整回歸 259/259 通過；文字指引須看模型行為，不以比對提示字串冒充效益。

交付前完整回歸再次 259/259 通過（Windows／Node 24.19）；Node 隨附 npm 的封裝 dry-run 包含 34 檔，實驗工具未加入套件。修改文件的本機連結及 Git whitespace 核對通過；尚無此批新的跨平台 CI，不拿先前 main 的 CI 代稱。

## 固定比較

基準為 `037966b` 的完整 workflow-kit Git 快照，新組為本批修正；兩組皆用新讀取回條、相同觀測器邏輯與模型設定。主案例沿用四份凍結來源／逐欄 oracle，不拿上一批結果代替新基準。開發期 `planning-comparison.mjs` 重用有限比較器選擇版本，不加入安裝套件。

開始前固定兩版程式／SDK／來源／答案及設定。一次短 probe（90 秒），A／B 各 600 秒；僅新組完整通過且舊組失敗時做一次事前凍結 holdout（600 秒）。關鍵證據未知或安全問題停止，不補抽；兩組皆敗就保留結果，不自動加控制器。分列產物、流程、約束、trace、階段及總成本；隨機性、固定順序與快取仍限制因果判讀。

獨立只讀審閱未發現阻擋比較的缺陷；確認 A 使用基準的「新讀取回條」分支，僅重映射隔離目錄。這是規劃指引、概況工具與材料說明的整體調整，不能將結果歸因於其中一項。

## 完整結果與裁定

[事前 manifest](2026-09-08-planning-handoff-manifest.json) · [原始證據](2026-09-08-planning-handoff-evidence.json)。pi 0.84.2、Qwen3.8-27B-Uncensored-orcarouter-STRIX_LEAN、server `b11502-764051bfb`；未改服務或全域 pi。兩組適用政策相同，來源／需求不變，約束及 trace 核對完整；沒有人工提示救援。一次 probe、A、B 結束，`both-fail`，不觸發 holdout、不補抽。

原始證據 SHA256：`70e67fe0665dce7adf30428d93b375ca33c28c838cacd62f341b97c84bcab379`；manifest：`f1692ea1b5e71b862d48e510ad4718c95dfddf8d02a4103b9bfa00dbe6778ef3`。按原始位元組保存，舊結果不覆寫。manifest 保留本機絕對路徑供稽核，換機須另建快照，不直接重播此批。

| 組別 | 產物／整案 | 批次記錄耗時 | 規劃 session | 執行 session | SDK total tokens |
|---|---|---|---|---|---|
| 短 probe | 正確／完成 | 25.773 秒 | — | 21.799 秒 | 9,985 |
| A：基準交辦 | 無產物／逾時 | 602.298 秒 | 521.345 秒 | 76.692 秒 | 61,563† |
| B：交辦調整 | 無產物／逾時 | 601.995 秒 | 49.461 秒 | 548.335 秒 | 66,606† |

表列整組耗時包括準備、版本核對及匯出；runner 的實際執行紀錄為 A 598.187／B 597.992 秒。兩組保存紀錄耗時約 1.626／0.480 秒。† SDK total 不是完整運算成本：A 的 worker 取消前已運行約 77 秒，但 SDK 回傳 tokens 全為零；B 最後取消的請求也不能保證用量完整。這些原值保留，不當作免費或拿累計 tokens 宣稱省成本。主代理、準備及電費成本未完整量測。

### 哪裡改善、哪裡沒改善

- B 規劃者只列材料概況、讀 requirements.md 後交辦，沒有先從四份來源抽取全部答案；驗收描述是查證方法，不是規劃者新推得的答案。本次規劃明顯較快，但單次順序對照不足以估計穩定改善幅度。
- 執行者 prompt 為 A 27,180／B 26,444 UTF-16 單位，沒有大幅縮小；不能宣稱本批已降低 context 負擔或證明長 context 優勢。
- B worker 第一個回覆在約 236 秒以 `length` 結束，trace 顯示有 thinking 區塊；只知道回覆達上限，沒有保存／檢查隱藏推理，不能推算其中的 token 比例。
- 隨後 worker 向 `case_result` 提交 `summary` 加 `packets` 的規劃形狀，被 SDK schema 拒絕；再提交 summary 時因缺少 adoption-map.json 被 preflight 拒絕。這是執行者行為與角色不一致的直接證據，不等於已證明 session history 洩漏。
- 拒收後 worker 重新讀取三份已附全文的來源，沒有呼叫 `case_write`。最終文字說正在寫入，實際檔案仍不存在。沒有 reviewer／integrator，不能降低驗收把它算成功。

### 下一步與停止點

保留這次有界概況與交辦分界，但不再把規劃當作唯一瓶頸、不繼續加長規劃提示。產品品質目標仍未達成。

下一步集中成一個可重現的「執行者收到工作包後，能否寫入並修復」問題：使用本批已生成的工作包與相同材料，先獨立核對 worker 實際工具 schema、角色提示與請求／回覆關聯，再以工作包重播分離規劃成本。應保留首次達輸出上限、錯誤角色回報、缺檔拒收及其後實際工具動作，驗收仍看真實產物；不能把修正回報 JSON 當成修好檔案。

不直接把責任推給 pi、模型或 context 大小。只有邊界核對及固定 worker 測試指向特定原因，才選擇一項後續改動（例如更明確的修復回饋，或另行確認模型呼叫額度／推理設定）；不一次調整多個因素、不改全域設定。本批生成至此停止，沒有再跑整案找成功樣本。

## 使用者完成模型研究後的接續：2026-09-08

使用者先要求停止模型以便自行研究，完成後要求接續。重新完整閱讀本機 `C:\models\AGENTS.md`／`README.md`：使用者比較後已回到 STRIX_LEAN 主力，Flash-Next 為備援。README 的工具測試與速度是模型研究紀錄，不是 CASE 任務品質證據。本輪不修改模型、BAT、全域 pi 或產品提示；只縮小到 worker 的接線與產物診斷。

### 真實 SDK、受控回覆的離線核對

開發診斷 `workflow-kit/evaluation/worker-boundary-audit.mjs` 使用 pi 0.84.2、上一批 B 的原工作包及來源，連到本機臨時 HTTP 服務；服務回傳五個事前寫好的回覆，不呼叫模型。順序：只有合成思考的 `length` → planner 形狀回報 → 缺檔的 summary → 寫入合成檔 → summary。這不是模型能力測試，合成檔也不是正確 adoption-map。

[原始接線證據](2026-09-08-worker-boundary-evidence.json)確認：每次實際請求都是 worker 系統指引、原工作包與 worker 專用 result schema；schema 沒有 packets、拒絕額外欄位，且有 case_write。每個 tool result 都有對應 assistant tool call ID；缺檔拒收後，同 session 寫入再提交可以被接受。來源雜湊未變。

首次診斷程式將 SDK 的 user content array 誤當字串而失敗，尚未送出合成回覆；修正為抽取文字後比較 SHA256，第二次五步通過。不是產品修正的 RED→GREEN，也不能忽略首次診斷失敗（本機 `.npm-cache/worker-boundary-audit-1.json` 保留）。

可重現的接續限制：第一次只含合成思考的 assistant 回覆，在第二個 wire request 中消失，只剩 system/user/user。已核對該 SDK `pi-ai/dist/api/openai-completions.js` 的 `convertMessages`：沒有正文或 tool calls 的 assistant message 會被略過。這解釋上一批觀測到的 message 形狀，**不證明隱藏推理內容、不證明角色混淆的唯一根因，也不表示應直接把隱藏推理改成正文**。

本機請求的 thinkingLevel=medium 經目前 qwen-chat-template 相容設定變成 enable_thinking=true／preserve_thinking=true，不是明確的 medium 推理額度。保留 max_tokens=4096，不將設定標籤誤當伺服器實際額度。後續如測推理設定，應另列變因，不能與本批默默混合。

### 單次真實 worker 重播

`worker-replay.mjs` 沿用上一批 B 的完整 prompt（SHA256 `c4658e83afda15076164dad3b038bb247b6bd498dc03ad32f13e82b8d52564be`）、凍結來源與 oracle，在新臨時目錄及新 pi 設定目錄執行一次。只交辦 worker，沒有規劃／核對／整合，也不把 oracle 答案送入模型。前置檢查僅檔案存在與來源未變，沒有註冊語意檢查；這是分離成本的診斷，不是完整 runCase 的重跑。允許回饋留在本次證據，未實作後續 planner 採納。

沿用 medium、32768 context 宣告、4096 回覆上限、16 turns、單次 600 秒，不改產品指引／全域設定。重新啟動既有 BAT，server 仍回報 `b11502-764051bfb`；沒有凍結 GGUF／執行檔全部位元組，不能稱與前批完全同環境或因果比較。wire 未指定 temperature/top_p，服務預設記錄為 1／約 0.95，不是 temperature=0。`/props` 的預設值不代表所有逐請求或 MTP 旗標實際生效。

[原始重播證據](2026-09-08-worker-replay-evidence.json)：210.787 秒，7 次送往模型的請求，工具順序為 list → 四次 read → write → result；所有配對正常、來源未變、無額外檔案。SDK tokens 為 input 18,835／output 3,610／cacheRead 91,427／total 113,872；不是純新增推理 tokens 或全成本。沒有 reply correction，沒有重現 length 或 planner-shaped 回報。接受後結束過程 trace 另有 error 事件，不能將「7 次 wire 請求」改稱所有 trace 事件都成功。

**產物仍不合格**：缺少明列的 `maintenance.installerRelated`，應為 `["ARCHITECTURE","GUIDE.en","HOSTS","README","help","封裝設定"]`；其餘既定欄位與 oracle 相符。summary 宣稱完成不能代替完整欄位檢查。沒有獨立 reviewer，不能據此斷言完整 CASE 一定也會漏掉，亦不能宣稱問題修好。本批到此只跑一次，不補抽成功樣本。

原始重播 SHA256：`85790b1d67099ffa8202f5b755a8a1c3c500341e46598aa12a83ea98026d3d7e`；離線接線證據 SHA256：`fe0158551d710b8a2d74944396e53534219be78f2b64bc0acb331d3b8fc4eeb2`。完整 kit 回歸 259/259；新增兩支開發診斷不隨套件發布。

### 下一步裁定

已排除本次受控路徑上的錯誤 worker schema／工具配對；尚未排除模型隨機性、角色理解或回覆額度的影響。不能再把「完全不寫」當成每次必然發生的單一故障。

優先處理可重現的驗收缺口：將使用者明列、可機械核對的輸出結構化為工作包可用的可信檢查，回報具體缺欄而不是只判存在；讓 worker 用自己的來源補齊，檢查本身不餵正確值、不取代獨立核對。先以這份確實缺欄的成果建立拒收／修復驗證，再決定是否需要一般化核心能力；不要把任務專用 oracle 硬編進框架，也不重建 pi 或追加規劃角色。這承接原案的小憲法、實際驗收及微觀修復，而非增加記錄工具。
