# 角色指引與精確定位：修正、結果及限制

2026-09-10。接續[受控異議失敗](2026-09-10-controlled-dispute-report.md)。使用者要求在原授權內持續完成，不再以每一步徵詢拖延。

## 角色指引修正：未證明解決問題

只修正 SDK 系統與工具的角色指引後，診斷約 410.054 秒未通過。reviewer 約 172.764 秒／45,922 SDK tokens，誤稱來源沒有 FORMAT 字面值；worker 約 236.130 秒／298,200 tokens，耗盡 16 turns，仍未完成修復。成果雜湊及獨立評分保持正確，來源未變。錯誤否決重播尚未發生，故不能比較 planner 反證效果；這也不證明角色指引修正造成退步。

核對實際工具回傳：reviewer 的 install.mjs 全文包含 MARKER／FORMAT 定義。角色指引一致性是工程修正，不足以保證模型正確使用來源。沒有追加相同設定抽樣、放寬驗收、修改模型或增大預算。[完整證據](2026-09-10-role-guidance-evidence.json)保存凍結程式與成本，`codeUnchanged=true`；公開版僅增加檔尾 LF，原始檔仍在 `.npm-cache/dispute-role-guidance-2026-09-10.json`。

## 有界搜尋：事前設計與驗收

補齊常見 agent 工具能力 `case_search`，不是新角色或新的驗收制度。原先只有列目錄／讀全文或分頁，要求模型從長檔案記憶精確事實。新工具讓各角色對單一已可讀檔案做大小寫敏感字面搜尋，回傳完整匹配行、行號及來源雜湊；需要語意判讀時仍讀周邊脈絡，不把字串匹配當成任意語意真偽判決。

權限沿用 case_read 的專案路徑／受保護設定／符號連結檢查。單檔至多 1 MiB，查詢單行且至多 256 UTF-16 units，每頁最多 20 個匹配，完整 JSON 至多 24,000 UTF-16 units。超量分頁明示 nextStartLine，單行過長拒收，不截短證據；noMatches 只適用指定檔案及起點後範圍。沒有 shell、regex 或任意目錄遞迴搜尋。trace 只記來源、雜湊與匹配數，不複製 query／匹配文字。

缺工具／trace 接線反例先紅後綠；helper 額外涵蓋 CRLF、字面比對、多頁、輸出邊界、長行、多行查詢及特殊檔。完整工程回歸 299 項：297 通過、2 項 Windows 符號連結權限跳過。不能把這些工程測試視為模型改善。

### 先驗正常完整旅程

原先安排異議通過才跑正常旅程；這次角色修正的診斷在重播之前已分流，繼續只測重播不能回答產品是否能完成工作。因此調整驗證順序：在具備精確定位工具的固定版本，先以同一主案例由空白成果開始規劃→執行→獨立核對→整合；不注入答案、不注入否決、不預建已通過狀態。整案沿用 off／32,768 context／4,096 輸出／16 turns／5 attempts／600 秒。這是回到產品目標，不是取消異議驗收或降低完成標準。

入口 `workflow-kit/evaluation/single-journey.mjs` 重用既有 freeze、executeArm B、評分及軌跡。一次 claim，持續保存中途結果，凍結工具與模型設定；額外準備目錄不生成模型。未測或失敗的異議能力仍另列，不以正常旅程通過抵銷。若正常旅程未通過，依第一個有證據的失敗邊界處理，不機械增加診斷輪數。

### 正常旅程結果：未通過

固定版本執行 332.123 秒，planner 完成交辦，worker 未建立 adoption-map.json，未進入 reviewer／integrator。累計 435,405 SDK tokens（包含快取讀取，不是峰值 context）；來源與任務說明保持不變，未多寫其他成果。planner 首次誤用 B 及 B/requirements.md，得到 ENOENT，之後改用正確相對路徑；測試仍如實標記工具路徑違規，沒有因後來自行更正而抹除。此違規不代表成功越界讀檔。

worker 已收到全文，也以 case_search 取得 MARKER／FORMAT 的正確完整定義，仍重複搜尋與讀取。最後兩次模型回覆為 length，僅留下繼續核對的文字；同 session 的格式更正未取得有效結果，最終 INVALID_REPLY。這是可觀察的失效鏈，不足以單憑 length 判定 context 耗盡、輸出設定錯誤或模型本身損壞。搜尋能力已接通，但本次沒有證明改善了成果品質；不得標示產品目標完成。

[完整證據](2026-09-10-normal-search-evidence.json)與[凍結清單](2026-09-10-normal-search-manifest.json)保留設定、來源、程式及 SDK 檔案雜湊。兩份公開檔相對原始檔僅增加檔尾 LF，已逐位元驗證；原始檔保存在 .npm-cache，未覆寫。

| 檔案 | 原始 SHA-256 | 公開 SHA-256 |
|---|---|---|
| evidence | 999475cf4063099ac86400be3c51eb0c7039a1bfaaa46fbaa4e9781a0177f457 | 90479c16abe57155db7043e32bf5e24981658187992f68c4e3e3c87ec3781cb3 |
| manifest | 46ebceadf73d3e98a58ea31bab90b8777d6193dc328456d6c38e54f8a7d28512 | bf1b4f96ea306cfc8d04da50d01a18dc0e8332c235a8807512262bb762a07b9f |

目標復盤：CASE 的價值不在增加角色或檢查次數，而在必要資訊可用、執行能產出、失敗能合理恢復。目前問題集中在 session 內沒有從查證轉入產出；再反覆測試後段異議不能修復這個前段問題。接續先核對實際模型請求與 pi 壓縮／輸出邊界，再決定修正；不原樣抽樣直到成功，也不靠使用者手工提供答案。

### 輸出只剩 1 token：後續定位與修正

進一步核對保存的實際 payload，worker 第 11–14 次的 maxTokens 是 **3195 → 842 → 1 → 1**，先前十次為 4096。最後兩次 length 並不是只有含糊的截斷訊號：SDK 在送出前已因估算的 context 佔用，把可生成額度壓到 1。此證據確定了最後無法產出的直接原因，不代表已解釋為何前面反覆讀取。

凍結 SDK 的 `pi-ai/dist/api/simple-options.js` 以 contextWindow 減去估算 context 與 4096 安全餘裕限制輸出；`pi-coding-agent/dist/core/agent-session.js` 在整段 agent run 結束後檢查壓縮，不是每個工具回合都切斷。預設近期保留 20,000 tokens，`core/compaction/compaction.js` 的切點估算採字元／4，觸發條件則可採實際 usage：中文及工具內容可能使兩種估算不同，出現「應壓縮但沒有可切前綴」。

離線合成 fixture（不是原始 history 重播）已確認這個機制：12 份各 4002 中文字元的工具結果、26 個 message entries，末尾 usage 為 28,010；context 估算 28,010、字元估算合計 12,160。reserve=16,384 時應壓縮，但 keepRecent=20,000 的 prepareCompaction 回傳 undefined；改為 8192 可產生 9 則前綴的壓縮準備。沒有呼叫模型，因此尚未證明摘要品質。

修正保留 SDK 的壓縮機制，不建立另一套 runtime：近期保留量取模型 context 的 1/4、最多 20,000；預留取 1/2、最多 16,384。32K 模型對應 keepRecent=8192、reserve=16384。模型未提供有效 context 時維持 SDK 原預設。session 證據保存實際設定；總時間、turn、重試額度及模型均不變。這是工程配置，不是已證明普遍最佳比例。

另外，SDK 自身恢復結束後仍為 length 且沒有已接受結果時，回報 MODEL_OUTPUT_TRUNCATED，不再把不可完成的回覆當作 JSON 語法問題追加同 context 格式重試。SDK 邊界測試已觀察修正前 INVALID_REPLY 的紅燈、修正後正確分類及設定的綠燈。下一次正常旅程驗證此固定修正版，結果獨立保存，不覆寫上面的失敗。

### 壓縮修正版結果：恢復成功，任務仍未完成

此修正版正常旅程已結束：601.856 秒、CANCELLED（600 秒整案上限後收尾），planner → worker，沒有 adoption-map.json，未進入 reviewer／integrator。來源及任務說明未變、沒有額外成果；測試仍保留錯誤相對路徑的工具範圍違規，不把 ENOENT 當成成功越界讀取。

worker 明確記錄 overflow 壓縮，session 相對時間 270,543 → 370,904 ms，耗時 **100.361 秒**，aborted=false；後續實際請求 maxTokens 從 1 恢復為 **4096**。這證實新配置讓此次壓縮與恢復走通，不代表摘要完整保留所有語意，也不能解釋或修復前面所有反覆查證。回覆在原整案上限被取消，沒有調高額度、注入答案或替模型補寫產物。

SDK 累計 234,469 tokens（planner 44,701、worker 189,768，含快取）；不是峰值 context、不是全部新生成成本。SDK 摘要用量是否全部納入此累計尚未獨立核對，不能聲稱成本已完整量測；時間包含上述壓縮。本次觀測值與前次不同，不作單次因果效益或成功率推論。

[完整證據](2026-09-10-normal-compaction-evidence.json)及[固定版本](2026-09-10-normal-compaction-manifest.json)均相對 .npm-cache 原始檔只增加檔尾 LF，已驗證：

| 檔案 | 原始 SHA-256 | 公開 SHA-256 |
|---|---|---|
| evidence | b114a5bc5def3bfa9a0e17afd42b159b4da013c75bae4c8d7dec143ddb0d7b4e | 4c885e28a03b8fb26fc42e3d19daababc8949c8f0544da9a989b04c76b9d6cc5 |
| manifest | 1d0764030f70479c36a54092eeb8e99b3cf2982c00f120ce9c3929c9ef1eff1d | b9b5838ef91c2be34939a653d2f677c9d9f933a5de678364d728a2b0a22750ad |

離線 SDK 診斷可重現：`node workflow-kit/evaluation/compaction-budget-probe.mjs <pi-coding-agent/dist/index.js>`。它只使用合成資料與 SDK 計算，沒有模型生成或檔案修改。產品完整回歸 **304 項：302 通過、2 Windows 符號連結權限跳過**；已核對 SDK 恢復先完成再分類、已接受結果不誤判、取消及預算超限優先，以及 36 檔的封裝預覽。這些只能證明所列工程行為。

**本輪裁定：** 壓縮預設不合小 context 的缺口已修復且實際觀察恢復；普通任務的查讀停滯仍未解，核心品質目標未達成。保存工作分支，不把本次模型驗收標成成功、不據此發布可靠度保證；不再原樣重跑。後續需要針對「必要材料已足夠時仍不進入產出」建立短的失效重現，並檢查交辦負荷與迴圈行為，不能再以後段審閱／異議成功替代前段交付。這不是請使用者代替實測。
