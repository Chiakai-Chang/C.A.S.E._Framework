# 既有獨立核對與修復：缺欄成果接續驗證

日期：2026-09-09。產品基準 `f63822f`；研究方案已獲使用者同意。目的：先驗證既有防線，不因 worker-only 漏欄直接推論 CASE 缺少驗收。這一批不改產品指引、核心或模型設定。

## 方法與事前界線

沿用 9/8 真實 worker 產出的 adoption-map.json 原始位元組，以當次成功 case_write 回條核對 SHA256：`db872a6d5ee4ea930ad70c0093efe460107cd98490baf85e2595027135268431`。另複製原四份來源與 requirements.md，保留原契約和工作包，不重跑 planner。隔離目錄與新的 pi 設定目錄不載入使用者全域 extension。

開發診斷 `workflow-kit/evaluation/review-repair-replay.mjs` 透過正式 store 的 plan → start → submit 重建「待核對」狀態，起始 session 明示 `synthetic-import-not-model`。這是**合成恢復起點**，不是先前 worker-only session 的產品原生接續；狀態轉換保存在證據。之後呼叫正式 runCase，讓 reviewer／worker／integration 依現有行為運作。沒有註冊額外 checks，也沒有將 oracle 答案或已知缺欄提示交給 reviewer。

一次診斷，追加的核對／修復總預算 600 秒，沿用契約 maxAttempts=5；不是重置原任務成本。先前 worker 約 210.787 秒及 tokens 另列，早前 planner、研究準備與主代理成本未完整量測。若逾時或失敗，保留結果，不追加抽樣換成功。medium／32768 context 宣告／4096 回覆上限／每 session 16 turns 沿用原設定。

準備時凍結產品 pi/core 程式、診斷程式與輸入證據雜湊。獨立只讀審查確認 oracle 留在 agent 無權讀取的外部證據，模型 prompt 來自原始需求與工作包；未發現需中止的接線問題。

## 可重現性限制

- prepare 到 run 之間未再次驗起始成果／狀態，須以 reviewer 首次讀取回條補核，不把準備檢查當成持續完整性保證。
- 完整 SDK 相依與模型檔未凍結；模型建置版本與服務預設另記，不能稱逐位元可重現。
- 評分模組不在事前 codeHashes；執行期間只讀補記 `read-receipt-spec.mjs` SHA256 `b7ee7b4527fa46f247fada302c9b485fe4bb7d8aefe6ca83ea84d5a6cae34735`、`real-task-spec.mjs` SHA256 `d93f9ab7a2db7313c324b3cdb9c65c0cd4c7abe1d7c87434e90858c234839257`。沒有因此改寫事前清單。
- 原 worker-only 不是完整流程，本次結果亦只描述從壞成果出發的修復旅程，不估計一般成功率。

## 結果

[原始證據](2026-09-09-review-repair-evidence.json)，SHA256 `19397ed0bff1413aff16dbf51a8d13fb834725b652d26a4d560224fe9bf8fb13`。server `b11502-764051bfb`；本次未改產品程式，codeUnchanged=true。首次 reviewer 讀成果的回條與起始 artifact SHA256 相符，補上初始成果的讀取核對；這不補足未做的完整狀態凍結。

| 階段 | 實際觀察 | 結果 |
|---|---|---|
| reviewer | 約 339.704 秒；讀來源與成果，自行指出缺 installerRelated，引用維護表並提出值 | 正確否決；沒有人工提供缺欄或答案 |
| worker 修復 | 約 260.128 秒；第一次回覆約 192.669 秒達 length，補交要求後讀成果，之後取消 | 沒有 case_write；成果仍缺欄 |
| 再核對／integration | 未到達 | 未驗證，不計成功或錯誤放行 |

總記錄耗時 601.089 秒，CANCELLED；產物不合格，來源未變，沒有多餘檔案。兩個 session traceComplete=true。reviewer 曾遇到長度上限，SDK 拒絕執行可能被截斷的 case_result 參數，重新提交後成功記錄否決；這個安全拒絕不是工具接線壞掉。reviewer 的排序疑慮屬其自述限制，不冒稱所有值已由機械檢查驗證。

reviewer SDK tokens 74,399（input 17,348／output 6,433／cacheRead 50,618）；worker 27,275（11,593／4,168／11,514），本次合計 101,674。取消請求用量可能不完整，total 包含 cacheRead，不能當成純新增推理成本。加上已記錄的前次 worker 為約 811.876 秒／215,546 SDK tokens；**不是整案全部成本**，尚未含最初規劃及研究準備。完整 kit 回歸 259/259，開發診斷不納入安裝套件。

## 復盤與下一步調整

1. 既有 reviewer 在本案例能發現問題，回饋與 retry 也有生效；不能再說框架缺少獨立驗收。
2. 具體回饋已到 worker，且其最後文字明確說只缺該欄，仍沒有寫入。因此下一個問題不是「不知道哪裡錯」，而是修復執行與成本。這是觀察，不證明推理上限是唯一根因。
3. 暫不開始結構檢查器一般化或繼續增加 reviewer。下一個有界對照應針對同一修復包、同一成果／來源、同一明確 review findings，單獨比較執行設定（例如目前 thinking 開啟與關閉），並保留相同工具／驗收及各組預算；不得同時縮包、改工具與調額度，也不能拿本次只剩 260 秒的 worker 當完整公平基準。
4. 若設定對照能穩定完成，再評估便宜的結構檢查前移、以及修復時只重驗受影響部分以降低成本；來源與成果版本必須綁定，不能把前次核對當成永久有效。如果設定沒有幫助，再分離修復包大小、完整覆寫工具的成本與回饋後行動介面。

本次到此停止生成，沒有追加成功樣本；模型已關閉。需求與原案的分層、自查、獨立核對、回饋目標不變，調整的是診斷優先序。這是「能發現但尚未修好」的證據，不是品質目標完成。
