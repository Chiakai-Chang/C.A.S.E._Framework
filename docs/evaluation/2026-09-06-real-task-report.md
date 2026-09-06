# 真實採用資訊任務比較結果

本次一般 pi 與 CASE 都未產出要求的 `adoption-map.json`，不能宣稱 CASE 改善了此任務的成果品質。一般 pi 偏離任務、反覆寫 placeholder；CASE 完成一個工作包的規劃，但執行者讀完來源後取消。這是一次真實公開專案資訊整理的配對失敗，並非虛構訂單 fixture，也不是一般成功率估計。

| 項目 | 一般 pi 原生工具 | CASE |
|---|---:|---:|
| 指定 JSON 成果通過 | 否，檔案不存在 | 否，檔案不存在 |
| 完整約束後整體通過 | 否 | 否 |
| 記錄耗時 | 81.181 秒 | 596.062 秒 |
| SDK total tokens（含 cache） | 62,396 | 87,964 |
| 模型請求／session 數 | 16／1 | 9／2 |
| 執行結束原因 | BUDGET_EXCEEDED：回合界限 | CANCELLED：總時間界限附近取消 |
| 四份來源完整性 | 全部相同 | 全部相同 |
| 任務說明完整性 | requirements.md 被改寫 | 相同 |
| 額外模型寫入 | 19 次 write，涉及 README.md、README_zh.md、requirements.md | 沒有 case_write |
| 模型執行期間人工介入 | 0 | 0 |

方法與資料見[事前設計](2026-09-06-real-task-plan.md)、[完整原始證據](2026-09-06-real-task-evidence.json)、[事後約束與版本核對](2026-09-06-real-task-audit.json)。原始證據 SHA-256：`c7adfd5963e68f3ba65e29ebf6d35782a1327833732dcf3461bdd3398a82c468`。它保留所有請求概況、工具結果、最終文字、錯誤、token 回報及 CASE 最終 active 狀態，未因修正評分器而覆寫。

## 真實來源與驗收

凍結副本來自當時的 `workflow-kit/install.mjs`、`workflow-kit/package.json`、`workflow-kit/docs/HOSTS.md`、`docs/MAINTENANCE.md`，位於 [real-task-sources](../../workflow-kit/evaluation/real-task-sources/)。題目要求將安裝路徑／保護規則、套件 metadata、pi 與 Antigravity 實測差異、維護測試與連動資訊整理成有固定欄位的 JSON。全部答案逐欄人工核對凍結來源；模型未收到答案、評分器或另一組結果。兩組結束前，所有初始 runtime／評估程式 hashes 及凍結來源 hashes 仍相同；後續產品修復不算本次受測版本。

兩組共用本機 Qwen3.8-27B-Uncensored-orcarouter-STRIX_LEAN.gguf、pi SDK 0.84.2、medium thinking、每 session 16 turns 與每組最多 600 秒；CASE maxAttempts 5，未預先提供人工工作包。模型請求的 `enable_thinking`／`preserve_thinking` 都為 true；未指定 sampling 值，使用服務預設，未設定固定 seed。SDK 宣告 contextWindow 32768；服務 props 回報 n_ctx 262144，不能把兩者當作實際 peak context。服務 build 為 b11500-776183047。工具、prompt 與詳細設定均在原始證據中。

一般 pi 使用乾淨 SDK session 的原生 `read/bash/edit/write` 與原生 system prompt，並非 CASE 的 scoped tools。它有廣泛檔案／shell 能力，隔離 cwd 不是 OS sandbox；這次實際只呼叫 write。CASE 使用既有 `createPiSessionRunner`／`runCase` 的角色與路徑限定工具，無任意 shell。兩組都禁用外部 extensions／skills／templates／themes，避免個人設定影響，不改全域 pi／模型設定。這是工具與流程組合比較，不能純歸因於分工，也不是互動 TUI 使用者研究。

## 失敗與評分限制

一般 pi 沒有讀取來源，19 次成功 write 都寫入 `placeholder\n`，涉及兩份額外 README 與任務說明；不只是 JSON 缺漏，亦違反事前「只寫 adoption-map.json」限制。四份來源 hash 未變不代表守住全部要求。完整原生 tool start args／end results 可核對寫入範圍；沒有觀察到外部讀取、網路或安裝工具動作，但本次沒有 OS 層監控。

CASE 規劃者使用約 506 秒，包含 11 次 case_read、一個 case_list、一個 case_result；接著工作者使用約 90 秒，留下 case_list 與三次 case_read，沒有寫成果。規劃者已收到完整 155 行 install.mjs 的工具結果，卻在工作包 unknowns 說檔案似乎從函式中間開始、缺 imports／host validation；這是紀錄中的錯誤判讀，不能把它改寫成來源真的缺料。CASE 最終仍為 active，沒有進入獨立核對或整合。

事前設計要求完整 args／results，但 CASE 既有 SDK 只保存工具結果與 case_write 的 writeRequest；case_read／discovery 等完整 args 未保存。本次可核對來源內容實際進入工具結果，無法完整證明每次讀取的精確路徑；「未外讀」標為 unverified。CASE 未提供網路／安裝工具，紀錄亦無相關操作；這只證明模型工具層的行為，非 OS 安全保證。

原始 gradeRealTask 漏查 requirements.md 完整性與額外檔案。原 raw 的 artifactPassed／grade.passed 保留當時值；[audit](2026-09-06-real-task-audit.json) 另按原題目完整要求列出 overallPassed 及 verified／violated／unverified。兩組本來就缺指定成果，因此補查不改變兩組都失敗的結論。執行後新增兩個失敗反例，補上最終目錄及 requirements 檢查，評分器測試共 5 項通過；這仍不能用最終目錄證明沒有曾經寫入後刪除，工具軌跡核對仍獨立。實際執行碼的位元組副本保存在 [spec](../../workflow-kit/evaluation/real-task-spec.executed.mjs) 與 [driver](../../workflow-kit/evaluation/real-task-comparison.executed.mjs)，只供歷史版本核對；新版 [driver](../../workflow-kit/evaluation/real-task-comparison.mjs) 是後續操作入口。本次沒有重跑模型。

SDK token 總數包含快取；未完成生成可能沒有完整 usage 回報，不能把數字當成完整硬體成本。SDK 金額為零是本機 provider 的零費率設定，不代表能源免費。準備與事後核對由評估代理完成，未分組計時；人工準備成本、代理準備 tokens、peak context、GPU 記憶體與能源均未知。執行期間零人工修正，不代表採用或維護負擔為零。

## 對交付的影響

這次沒有觀察到 CASE 品質優勢；它保留了較有結構的接續工作包，且沒有原生 pi 的額外寫入，但付出更多耗時與已回報 tokens，仍未交付成果。依[原始構想對照](../research/2026-09-05-layered-cooperation-direction.md)，分層與紀錄必須幫助本地模型把工作做好；本結果不能用「有工作包」替代任務完成。維持預覽版限制與完整失敗證據，不增加角色、延長預算或挑選重跑來美化結果。安裝／loader 的驗證是不同證據，不能抵銷這次任務失敗。
