# 接手與貢獻指引

先讀 [目前狀態](docs/STATUS.md)，再透過 [MAP](MAP.md) 只載入需要的規格。本專案目前接受研究原型層次的檢查與修改；沒有 production 支援承諾。公開授權仍待決定，請勿把 repository 可見性當成已取得開源授權。

## 在原始碼倉庫內操作

使用 Node.js 24；已量測版本為 24.19.0。於 repository 根目錄執行：

```text
npm ci
npm run build
node dist/src/cli/main.js --help
```

開發時按修改範圍執行相關測試。合併程式或規範變更前跑 `npm run check`，涵蓋型別檢查、核心測試、評估器測試與 conformance，當前 Windows 量測約 9–10 分鐘。文件小修以連結、指令與事實核對為主；沒有新的風險時不反覆重跑完整測試。

```text
npm run check
node evaluation/markdown-baseline/verify-results.mjs --protocol-revision 09a96bc84c013b5e4d586aa4270a922f6a6e9fea
npm pack --dry-run
git diff --check
```

完整性驗證參數是歷史 r6 清單綁定的凍結方法提交，不是目前 HEAD，也不是最初設計協定提交。重新評估時使用新的方法與紀錄身分，勿修改舊結果或直接使用 `--write` 重建清單來掩蓋不一致。

若 Windows 的 npm 報告 roaming 安裝內缺少 `npm-bundled`，可先檢查 `node --version` 與 npm 安裝來源。此機曾以 Node 安裝目錄內的 `node_modules/npm/bin/npm-cli.js` 及工作區快取完成驗證；這是本機環境問題，不需要清除 Pi、模型或全域工具設定。

## 修改原則

- 行為修改同步核對規格、schema 與案例；測試須檢查實際結果，不能只檢查標籤。
- `controlled-test` 僅供測試；不能加入旗標或環境變數讓一般 CLI 假裝具備平台能力。
- 保留無效、失敗及部分評估原始紀錄；改判以外部說明與新證據記錄。
- 不提交模型檔案、憑證、本地卷宗、依賴、建置輸出或測試暫存。打包前先建置並檢查 allowlist。
- 更新使用者可見行為時同步更新 README、狀態頁與離線 help；封裝 README 的連結文件位於原始碼倉庫。
- 審閱說明應包含目的、行為差異、驗證及未解限制；只有證據支持時才擴大支援宣稱。

後續可維護性工作：集中 workflow 的重複 request validation，並在維持 `runCorpus` 介面與案例結果的前提下拆分 conformance runner。這些是非阻擋債務，不應取代真實平台可用性的優先工作。
