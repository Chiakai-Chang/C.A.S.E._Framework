# 受控異議診斷：規劃者仍沿用錯誤指控

2026-09-10。依[已同意計畫](../superpowers/plans/2026-09-10-recovery-and-delivery.md)執行一次 `dispute-off`，未通過，不追加相同設定抽樣、不啟動後續正常完整旅程。

## 結果與限制

本次約 **421.765 秒**。真實 reviewer 通過 → 測試入口重播 9/9 歷史否決 → 真實 planner 未產生合法回覆。沒有新的 integrator 重核，沒有 worker 返工；成果評分、來源完整性及成果雜湊仍通過，卷宗維持 active，`disputeGrade.passed=false`。

| 階段 | 軌跡耗時 | SDK 累計 tokens（含 cacheRead） | 性質 |
|---|---:|---:|---|
| reviewer | 91.606 秒 | 38,849 | 真實模型 |
| 第一次 integrator | 不計模型推論 | 不適用 | 一次歷史回覆重播，synthetic |
| planner | 328.906 秒 | 305,625 | 真實模型，失敗 |

真實 session 累計 344,474 tokens，不是峰值 context。off／32,768 宣告 context／4,096 單次輸出／16 turns／額外 600 秒沿用事前設定。沒有改產品提示、全域 pi、模型設定或歷史證據；`codeUnchanged=true`。外部測試重播不等同當前模型自然產生否決，也不提供正確反證；本次不能估計自然發生率、普遍可靠度或 CASE 效益。

## 直接證據與失敗鏈

1. planner 第一次 `case_read` 取得 `install.mjs` 第 1–155 行，`wholeFile=true`、未截斷。保存的文字中，第 8–9 行就有 `MARKER` 與 `FORMAT` 字面值。它仍在後續回覆重複「常數未宣告、值無法推導」。因此不能歸因於這兩行沒有透過工具提供；更底層的模型保留／注意力原因尚未知。
2. planner 六次呼叫 `case_result` 全部被 schema 拒收。主要回覆使用 reviewer 的 `passed/findings/evidence`；有一次夾入只有 reason 的 `reviewDispute`，且將異議方向誤解為反對先前的通過結果，沒有必要 criterionIds／完整引用。SDK 沒有把格式錯誤當成有效規劃結果。
3. 後續重讀 `MAINTENANCE.md` 之後，planner 最後一次工具回覆承認「封裝設定」確實在安裝維護列，原指控不成立。這是部分查證修正，不是合法反證申請，也不能抵銷另外兩個未修正的錯誤主張。
4. 軌跡最後兩次 model_response 的 stopReason 為 `length`；`rawFinalText` 與最後 text 為空。一次同 session 回覆修正後仍沒有合法結果，外層才回報 `INVALID_REPLY`。因此末端 JSON 錯誤不是全部根因，不能只加 JSON 清洗或放寬格式。

完整工具紀錄與軌跡均在[證據](2026-09-10-controlled-dispute-evidence.json)。反證申請尚未進入核心驗證，不能將本次說成核心逐字引用驗證失效。

## 可處理的介面因素與尚未證實的推論

靜態核對 `workflow-kit/integrations/pi/sdk-session.mjs`：共用 appendSystemPrompt 及 `case_result` 說明要求遭拒後修復實際檔案／檢查；但 planner 是唯讀，應修正計畫、交辦或提出反證，不直接修改檔案。runner 的 planner 提示已說明唯讀不等於缺交辦權限，兩層資訊仍不一致。

SDK schema 拒收發生在自訂 execute 之前，故 CASE 在 execute 中提供的簡短角色修正提示沒有機會生效；實測錯誤訊息逐次附上模型完整長篇錯誤主張，形成大量重複脈絡。這些是可觀察的介面缺口，但「它們導致模型持續相信錯誤指控」仍是待對照假說，不能宣稱唯一根因。

## 下一步裁定：修復交辦介面，不擴大框架

目標仍是減少錯誤返工及人的救援，不是讓任意格式都能結案。本次保護住成果，但尚未減少監督負擔；因此不能交付成已驗證的無人處理能力。

先只對齊各角色的系統／工具指引：planner 要做處置與交辦，worker 才修檔，reviewer／integrator 核對及回報；保留 schema、逐字引用、權限及總預算。用真實 SDK 接線測試確認角色取得一致資訊，再做單一變因的同案診斷。若依然重複長篇無效回覆，再獨立評估拒收訊息如何縮短並保留必要錯誤路徑；不一次更動兩項來宣稱因果。

不要為此新增角色、放寬一次重核限制、增大 context、增加預算或把標準答案塞入提示。介面修正屬完成原分層交辦設計的必要工作，需保留前後證據；不重新開完整架構研究。

## 保存與工程驗證

本次只改診斷入口：新增 evaluation-only 歷史否決重播 helper，測試拒絕 passing fixture、只重播第一次整合、驗證錯誤不改跑模型。完整 kit **282 項，281 通過、1 項 Windows 符號連結權限跳過**。這是工程結果，不代表模型能力。

原始檔 `.npm-cache/dispute-controlled-2026-09-10.json` SHA-256：`42324e892bf87d92a448e1b4d5a32e127cd51b343170888dc3dda5e283e77c56`。公開證據 SHA-256：`5022258ffac9516ee56551e0ae38a931c00a3a311403f81bcabee049655e7bb9`。公開版僅增加檔尾 LF，已比較確認；保留原始檔，沒有刪改失敗內容。敏感字串掃描未發現憑證候選；本機路徑與 session 識別碼保留，非自動隱私遮蔽保證。

模型測試程序正常結束；未停止既有模型服務，未重送先前遭拒的停止操作，未合併或推送。

## 角色指引修正：執行前登記

使用者要求不再逐步等待確認，授權依原目標自行完成。採用上節的有限修正：SDK 依角色共用同一段 roleGuidance 於系統提示及 case_result 說明；planner 只修正決策／交辦與反證，worker 修檔，reviewer／integrator 核對不修檔。保留 schema、工具權限、反證規則及預算，不同時修改拒收訊息。

新增 SDK 邊界測試，先在原版因 planner 收到 worker 修檔指引失敗；修正後完整 kit 282 通過、1 項 Windows 權限跳過。採相同 `dispute-off` 診斷、來源與模型設定，另存 `.npm-cache/dispute-role-guidance-2026-09-10.json`；prepare 已凍結程式，這是修正版的一次觀察，不是統計效益結論。結果完成後保存至正式證據位置。
