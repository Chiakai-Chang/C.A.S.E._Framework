# CASE v2：本地模型開發驗證

日期：2026-09-05。目的不是證明分工必勝，而是確認真實本地模型能走完流程、找出會增加使用者負擔的失敗，並據此調整實作。此頁保留開發過程，不把修正前後樣本混成固定版本的效果研究。

## 設定與重現

Windows、Node.js 24.19.0、pi SDK 0.84.2，使用本機 llama.cpp 的 `Qwen3.8-27B-Uncensored-orcarouter-STRIX_LEAN.gguf`。由使用者提供的 ROCmFP4 STRIX LEAN 啟動設定執行，聊天範本為 froggeric v22.4；未切換雲端模型。SDK 宣告 contextWindow 32768、maxTokens 4096、thinking off、每 session 最多 12 turns；伺服器配置的 context 上限較大，兩者不是相同度量。

入口：[local-comparison.mjs](../../workflow-kit/evaluation/local-comparison.mjs)。從 repository 根目錄執行，`--sdk` 指向已安裝 pi 的 `dist/index.js`，`--output` 指向不存在的新檔案；僅接受 loopback endpoint。每組使用新的暫存專案及相同起始資料。執行模型產生的程式碼並非作業系統安全隔離，請只在受控測試環境使用。

```text
node workflow-kit/evaluation/local-comparison.mjs --sdk <pi-dist/index.js> --output <new-results.json> --repeats 3
```

CSV 題目要求保留具名匯出、只修改一個函式檔案、不得新增依賴。獨立驗收涵蓋一般文字、逗號、雙引號、CR、LF、空字串，以及需求檔未被更改。單 context 使用相同 scoped tools，自行修改與核對；分離流程使用 planner、worker、reviewer、integrator。這不是三種架構的消融實驗，也沒有驗證技能是否會自行被模型選中。

## 全部開發配對結果

| 階段／次序 | 單 context：完成／秒 | 分離流程：完成／秒 |
|---|---|---|
| 初次接通 | 通過／23.781 | 通過／98.352 |
| 重複 1 | 通過／23.884 | 通過／112.025 |
| 重複 2（先分離） | 通過／26.766 | **失敗／103.357** |
| 重複 3 | 通過／26.710 | 通過／125.556 |
| 格式指引修正後 | 通過／23.538 | 通過／115.405 |

完整回覆、工具觀察與已知用量保存在[去除本機路徑的原始紀錄](case-v2-development-probes.json)。初期沒有凍結程式雜湊，最後一組新增三個 adapter 原始碼雜湊；之後又修正「不得對真實驗收失敗重問」及原生入口，所以最後一組仍非最終版本基準。

失敗不是隱藏的成功：整合者將限制 ID `c1` 誤列為驗收 ID，核心以 `ACCEPTANCE_INCOMPLETE` 拒絕結案。早期腳本在流程失敗時未獨立驗收產物，因此該次產物正確性為**未測**，不是已證明錯誤或正確。新版腳本分開保存 `workflowCompleted` 與 `artifactPassed`。

修正後那組的 SDK 累計 total tokens 為單 context 6069、分離 21198（包含 SDK 回報的 cacheRead）；不是最高瞬間 context 長度，也不直接代表本機電力或付費成本。未知成本不能當成零。這一個簡單題目未顯示分離的品質收益，卻清楚增加時間及處理量：因此保留「小工作直接做」為產品原則。

## 發現、修正與限制

- 模型回覆只能當資料：白名單取出整合欄位，不能覆寫操作或真實 session ID。
- 新資料夾的合法第一個產物原本被工具拒絕，修正後仍限制在工作包寫入範圍。
- 中斷／錯誤保存已知工具觀察及用量，未知明示 unknown。
- 格式錯誤最多一次新 session 修正；任何明示 `passed:false` 都停止，不能在未改成果時反覆詢問直到通過。
- 原生套件發現成功不代表實際 run 成功；必須另驗證 pi 提供 SDK 的載入方式。

上述缺陷以回歸測試保存。文件、資料彙整、缺資料及接續屬額外 holdout 檢查；其結果另行追加，不能由 CSV 代替。尚無長 context、跨模型、三種策略各三次的完整比較，也未證明普遍提升品質或降低使用者監督成本。功能驗證與效益研究分開驗收。

## 原生安裝與額外 holdout

原生 pi 0.84.2 專案級安裝後，真實 ResourceLoader 載入工具並執行 create/run，四個新 session 在 124.914 秒內完成；產物逐位元符合、來源未變。原生 remove 成功後，專案套件清單不再登錄 CASE，卷宗、產物及來源套件的 SHA256 前後一致。未改全域 pi。[完整成功、初次失敗與移除證據](case-v2-native-evidence.json)；重現腳本 [native-smoke.mjs](../../workflow-kit/evaluation/native-smoke.mjs)。這是實際工具操作，不宣稱已人工操作所有互動式 UI。

另外三個未用於先前 prompt 調整的案例，以同一模型及設定、每案 180 秒預算各跑一次：

| 情境 | 獨立核對 | 結果／秒 |
|---|---|---|
| 跨檔案資料彙整 | 兩來源計算 A=21、B=33、total=54；來源不變 | 通過／88.360 |
| 必要價格檔缺漏 | 不產出、不捏造、不結案；回覆指出缺 prices.json | 安全停止／46.084 |
| 已核對上游接續 | 下游 doubled=74；上游雜湊、整個工作包及 attempt 不變 | 通過／62.378 |

[原始 holdout 證據](case-v2-holdout-evidence.json) 與[重現腳本](../../workflow-kit/evaluation/holdout.mjs)。接續案的上游是確定性人工測試準備，不是模型先前成果；本案驗證的是模型接續且不重做有效上游，不是殺程序後的全自動恢復。

缺料案仍發現可用性問題：模型已指出缺料，卻以空產物工作包回覆，使用者看到的是 `INVALID_ARGUMENT: Deliverables required`。安全條件通過不等於體驗良好，因此另補明確 `{blocked:{reason}}` 規劃出口，保留原因且不啟動 worker；這項後續修正與本次原始結果分開保存，不改寫舊紀錄。

修正後僅重跑缺料情境（`--scenario missing-input`），16.316 秒後回傳 `BLOCKED` 與具體缺少 prices.json 的原因；只有一個 planner session、沒有產物、來源不變、未結案。[追加原始證據](case-v2-missing-corrected-evidence.json)。這是針對已發現問題的回歸，不能再稱為未參與調整的 holdout。
