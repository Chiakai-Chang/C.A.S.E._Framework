# 預覽交付：完整本機任務與收斂判斷

日期：2026-09-12（Asia/Taipei）；實驗於 9/11 23:57 開始。產品凍結提交 `94935d6`，測試期間程式雜湊全部不變。這次是交付驗證，不再設計新角色或擴大驗收門檻。

## 結果

既有 multi-source 訂單任務通過：模型從空白成果自行規劃，先整合訂單、價格、退款、匯率與政策，再產出報表。六個獨立 session 依序為規劃、執行、核對、執行、核對、整合；兩個相依工作包完成，沒有人工介入。

- `normalized.json` 四筆明細完全符合獨立評分；取消訂單排除、僅扣已核准退款、保留零淨額明細、只用現行價格。
- `report.json` 總額 1,503 TWD，USD 24、EUR 21，排除訂單 c，政策版本 2026-09；所有欄位完全符合。
- 來源未變、範圍檢查通過，沒有成果讀取錯誤。workflowCompleted 與 artifactPassed 都為 true，不只相信模型宣告。
- 361.349 秒；SDK 累計 159,925 tokens，包含快取；人工介入 0。沒有額外重抽。

## 方法、原始證據與限制

沿用 [既有評分流程](../../workflow-kit/evaluation/value-comparison.mjs) 與 [multi-source 案例](../../workflow-kit/evaluation/value-fixtures.mjs)，只跑 CASE 一組；外部評分於工作流程結束後比較實際／預期成果。沒有把答案交給角色、沒有注入故障或核對裁定、沒有新增 approved checks。這次因此驗到正常相依工作完成，不是新增工作、返修或中斷恢復的自然觸發證據；那些機制另由 READINESS 導航。

本機 pi SDK 0.84.2，既有 llama.cpp 服務 `b11505-91a24dd7f`，模型為 Qwen3.8-27B-Uncensored-orcarouter-STRIX_LEAN.gguf。contextWindow 32,768、maxTokens 4,096、thinking off；600 秒與原 attempts 額度未增加。模型服務、全域 pi 及啟動設定未改。

[完整原始證據](2026-09-12-push-acceptance-evidence.json)包含交辦、原始回覆、工具觀察、來源／程式雜湊、各 session 成本、最終狀態與評分。[實際執行腳本快照](2026-09-12-push-acceptance.executed.mjs.txt)保留原相對路徑，供稽核而非在此路徑直接重跑。來源內容可由同版 fixture 還原；保留的本機路徑是測試位置，不是使用前置條件。

這是已存在的合成業務案例，不是新的盲測；沒有一般 pi 對照，不推論成功率、因果改善、省 tokens 或泛用優勢。硬體能源成本、GGUF 完整雜湊與尖峰 context 未測。先前 [誤驗完成反例](2026-09-11-holdout-journey-report.md)仍有效，這次成功不代表它已修好。

## 工程交付與目標復盤

完整 kit 353 項：351 通過、2 項 Windows 符號連結權限跳過、0 失敗。套件 dry-run 37 檔；全域 npm 缺檔問題未動，改以既有 Node 附帶 npm、專案內 cache 與 offline 模式核對。獨立審閱 main 到產品凍結版未發現 P1／P2 阻擋；歷史證據不因尾端空白或失敗而改寫。

回看 [原始分層構想](../research/2026-09-05-layered-cooperation-direction.md)，目前交付仍是專案共識、整體目標、工作包、有界材料、獨立核對、執行中回饋及持久接續，而不是只有記錄工具。pi 是第一個自動化接入方式；其他工具的可攜技能不等同原生自動協作。

裁定：可以交付此預覽批次，不應為等待普遍正確性證明而無限消耗使用者時間；也不能把交付完成冒充模型效益目標全部實現。以實際成果作判準、保留可執行檢查與人工把關，後續改善需對應具體失敗，不重抽同一題美化結果。沒有移除原目標、降低既有評分或擴張權限。

Git 實際交付見 [STATUS](../STATUS.md)。本次不發布 npm、不替使用者選授權、不刪備份或 AppData、不建立排程。
