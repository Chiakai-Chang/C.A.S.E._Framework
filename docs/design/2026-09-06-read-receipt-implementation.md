# 讀取回條與診斷：執行計畫

2026-09-06，使用者已同意並要求繼續。規格以[已收斂設計](2026-09-06-stalled-execution-resolution.md) §4、§6 為準；不是新增功能路線。

1. 讀取介面：先補失敗測試，再修改 `scoped-tools.mjs`。文字以 `CASE_READ ` 加 JSON 回條、換行與正文組成；保留既有 details，新增同 buffer 的來源 hash、實際 range、eof、wholeFile、empty、outOfRange、nextStartLine。24,000 UTF-16 單位包含標頭。測空檔、尾頁、來源變更及容量邊界。
2. SDK 診斷：新增獨立 bounded trace 模組及測試，在 `sdk-session.mjs` 接收事件及實際政策資訊，於 `sessionEvidence.trace` 交回；只允許必要 metadata，不記錄正文／隱藏推理。測不完整、溢位、取消及敏感資料。
3. 保存失敗：runner 保留 trace；保存錯誤不能蓋掉操作錯誤，附帶記憶體 run 及另外的保存錯誤，停止派工。使用注入失敗測試驗證，不重播副作用。
4. 對照準備：新增開發用固定批次工具。先凍結主題、另一題、oracle、設定及程式 hash，兩組同 CASE 只差模型可見回條；先驗證工具與完整 kit，才准許一個 probe、A/B 及條件式 holdout。任何語意失敗都保留，不換題、不自動開始下一假說。
5. 整合：核對實作與設計、執行全部 kit 測試；紀錄實測和限制，同步 README、V2、ARCHITECTURE、READINESS、英文指南、STATUS、MAP。保留歷史原始證據不變。

工作採互不重疊檔案的具體分工；主整合者負責 runner、package 測試清單與交付文件。分工不是產品新增角色。既有未提交文件保留，不移動或刪除其他 worktree。完成與否以測試輸出及模型產物為證據，不以本計畫勾選代替。
