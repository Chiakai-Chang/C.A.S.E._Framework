# 修復後核對：成果正確，但整體驗收誤判

2026-09-09。使用者同意以非思考設定接續核對既有修復成果；本次只擴充開發診斷入口，沒有更改產品或全域設定。基準提交 `b292ab1`，執行時程式雜湊完整保留。

## 結果

**未結案。** 獨立 reviewer 通過；integrator 卻提出三個與來源矛盾的缺陷，planner 隨後沿用錯誤指控，以 `no-write-scope` 回報受阻。最終卷宗仍為 `active`、工作包 `verified`；產物完整評分通過、來源未變、沒有多餘檔案。這不是修復失敗，也不是整體流程成功。

| 階段 | session 軌跡耗時 | SDK total tokens（含 cacheRead） | 結果 |
|---|---:|---:|---|
| reviewer | 110.326 秒 | 75,034 | 逐欄核對通過 |
| integrator | 127.736 秒 | 116,728 | 誤判三項缺陷，觸發既有回饋 |
| planner | 154.772 秒 | 96,956 | 混合角色回覆，最後受阻 |

本次總牆鐘時間 **409.228 秒**、SDK 累計 **288,718 tokens**，包含角色外開銷，不能把累計 tokens 當作峰值 context。三個不同 session 的 traceComplete 均為 true；26 筆送出請求設定均為 `enable_thinking=false`。設定延續同一模型、32,768 宣告 context、4,096 單次輸出上限、16 turns、額外 600 秒診斷預算。

## 如何確定是誤判，而非評分器漏驗？

直接核對 integrator 自己收到的完整 `case_read` 文字，不只相信評分器：

- `install.mjs` 第 8、9 行明列 `const MARKER = '.case-install.json';` 及 `const FORMAT = 'case-workflow-install/1';`。它卻聲稱兩個常數未宣告、字面值不在來源內，要求改成 `MARKER`／`FORMAT`。
- `MAINTENANCE.md` 安裝維護列明列「help、HOSTS、兩份 README、GUIDE.en、ARCHITECTURE、封裝設定」。它卻要求刪掉「封裝設定」。
- 兩份讀取回條均為 wholeFile、未截斷，內容亦存在於保存的工具輸出。不能把這次失敗歸因於工具沒讀到檔案；是否在更底層的模型 context 保留／推論中出問題，尚未證明。

integrator 另嘗試四個不存在的 `workflow-kit` 路徑，並有一次目錄越界嘗試被工具拒絕。沒有成功越界。planner 收到的 `writeAuthority` 明確含 `adoption-map.json`，自己的工具唯讀是角色分工，不是不能交辦的外部障礙；它卻回報沒有寫入權限。

planner 最初送出 integrator 形狀，被拒絕；第二次 `blocked:false` 也被拒絕；第三次混合 `packets`、`blocked`、`decisions`、`results`、`summary`，因含合法 blocked.reason 而被接受為受阻。`runner.mjs` 的 `validatePlanReply` 遇 blocked 即返回，後續 `blockedReason` 即停止，沒有拒絕混合欄位。這是可確定的介面缺口；尚未修正，不能宣稱修正它就能消除模型誤判。

## 復盤與下一步裁定

對照[原始分層協作意圖](../research/2026-09-05-layered-cooperation-direction.md)：獨立 context 的目的在降低負擔、提升品質，不是讓每個角色重讀後有權憑敘述推翻成果。本次獨立核對有效，但整體驗收新增了錯誤否決與成本。前次非思考修復較快，不代表所有角色都應採同一設定。

下一批應處理既有角色的**異議查證與回覆界線**，不新增審查角色，也不直接刪除整體驗收：

1. 先以保存的混合回覆建立反例，讓 planner 的完成／改計畫／受阻形狀互斥；角色自身唯讀不等同缺外部授權，交辦須依契約權限判斷。
2. 釐清 integrator 的責任是整體目標、跨包關聯與未覆蓋限制；否決已有成果須提出具體來源位置及矛盾。來源引用可機械核對「確實存在」，但不能假裝能機械證明任意語意。
3. 目前 `replan` 要求真的有工作變更才允許再次整合，缺少「有證據駁回錯誤回饋、保留成果」路徑。需設計有界的異議處置，避免被迫改壞正確成果，也避免反覆詢問直到驗收改口；原驗收、權限與累積預算不得放寬。

以上是下一批方案，不是本次已實作能力。不要再用相同設定反覆抽樣，也不把本次 oracle 注入產品來硬通過此案例。

## 證據、重現與限制

[原始證據](2026-09-09-repaired-review-evidence.json)，SHA-256：`125b1795f768fd4baa5b02c587bbaff68515e2da97fc5cd601e915b74cef3a4d`。

沿用[前次 off 修復](2026-09-09-repair-thinking-report.md)的實際檔案，雜湊 `3e809dd41545c08b1039e116ebed9f9f5e7089a6304c00bf9212a6e8f0a8b5ad`；不是依 oracle 重建答案。準備階段透過正式狀態操作重建 submitted 起點，**不是原 worker-only session 的自然接續**。只新增診斷選項：

```text
node workflow-kit/evaluation/review-repair-replay.mjs prepare <SDK-entry> <new-evidence.json> repaired-off
node workflow-kit/evaluation/review-repair-replay.mjs run <SDK-entry> <new-evidence.json>
```

執行前核對凍結程式、來源、初始狀態與產物；評分器與前次證據也納入雜湊，執行期間 `codeUnchanged=true`。SDK 全相依樹與 GGUF 未逐位元凍結。未把 oracle 傳給模型，未保存隱藏推理。

前次 off 修復約 131.896 秒／146,485 tokens 與更早失敗成本另存，不能與本次拼稱一次原預算內完成；本次也不是成功率或 thinking 的因果比較。回歸測試 259/259 通過，模型與本次啟動程序已停止，無檔案刪除、無全域變更。
