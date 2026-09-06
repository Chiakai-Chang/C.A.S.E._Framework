# 預覽版採用與發布核對

日期：2026-09-06。對應[交付計畫](../design/2026-09-06-preview-release-plan.md)。本頁記錄本輪採用驗證，不取代歷史模型結果。

## 安裝旅程

在獨立暫存專案／pi 設定目錄，以 pi 0.84.2 實際執行本機 `pi install -l`，SDK resource loader 找到 `case_workflow`、`/case` 與 case-workflow 技能，載入 errors 為空。初始化 v2 卷宗後移除套件，專案 package 登錄消失，卷宗 manifest SHA256 不變；套件 23 份技能／整合來源檔前後雜湊相同。

移除首次因測試專案尚未信任而被 pi 拒絕，並非 CASE 的移除失敗或資料損壞。確認只操作該測試專案後，使用 pi 明示的 `--approve` 完成；HOSTS／英文已說明這個信任步驟。未更動使用者全域設定、模型服務或備份。

另以離線 installer 複製技能至另一獨立專案，從安裝副本執行 v2 init 成功，包含 discoveries 核心；不依賴 framework 原路徑。這是本地 CLI 能力驗證，不冒充 Codex／Claude Code／Antigravity 的模型旅程。

另外使用既有 Skills 1.5.23 CLI，從本地技能來源以 `--copy --agent codex --yes` 安裝到獨立專案，再由安裝位置執行 v2 init 成功。採專案範圍、關閉該次遙測，未修改全域技能。這驗證主要安裝管理工具與最新技能的複製相容性；GitHub 新提交的下載另於推送後核對，不把本地来源測試誤稱遠端安裝。

原始操作摘要：本地忽略檔 `.npm-cache/preview-install-check.json`；保護修正後另以全新測試目錄完整複測亦通過，記於 `.npm-cache/preview-install-check-final.json`，未覆寫先前結果。本輪不以既有 v1 CI 冒充 v2 遠端通過。

最終封裝 dry-run 33 檔，包含 discovery 核心及 pi 整合，沒有 evaluation、tests、node_modules、私有快取或任務目錄。技能結構檢查與 git diff --check 通過；換行警告不視為功能失敗。模型結果與凍結來源用獨立 hash 核對，公開前未發現憑證或隱藏推理內容；仍保留通用本機測試路徑作證據脈絡。

## 審閱後修正

獨立審閱確認一項保護缺口：直接帶入工作包的材料與 pi 讀檔工具未使用相同受保護路徑規則，規劃者可能指定工具本來拒讀的設定目錄。固定版比較結束、原始 hashes 核對一致後，才修正 `core/io.mjs` 與 pi `scoped-tools.mjs` 共用六類受保護目錄判斷。新計畫的 inline／indexed／optional 與既有 context 均拒絕巢狀／大小寫變體，普通 AGENTS.md 與根目錄列表保留。

先以合成暫存檔重現「應拒絕卻成功」的紅燈，再做最小修正；focused 75/75、完整 kit 220/220 通過，主代理再次執行完整套件亦為 220/220。原模型比較結果不回填成修正後版本。這項審閱與測試先行方法實際阻止了不安全的版本合併，而非單純增加流程。

獨立限定複核再次通過 75/75，確認原 Important 解除，沒有剩餘 Critical／Important。真實任務評分另外補額外檔案及 requirements.md 改寫的兩項反例（5/5）；原始執行碼與 raw evidence 保留，新規則不回填舊結果。完整比較兩臂皆失敗，首頁與英文均如實揭露。

## 發布界線

本次授權為整理、提交、合併及推送既有 Git repository。`b14ded1` 已由功能分支 fast-forward 合併至 main，合併後 220/220 通過，一般 push 成功；未 force、未刪功能分支、歷史證據或備份。未選定開源授權，不發布 npm registry。

推送後使用 Skills 1.5.23 從 README 的 GitHub main URL 在全新暫存專案安裝，v2 init 成功，確認下載內容包含 discovery 與最新 protected-material guard。首次網路受沙箱阻擋，經針對此次遠端驗證的執行授權後成功；沒有改全域技能。這次才是新版遠端入口實測，不與前面的本地來源測試混淆。

首次遠端 [CI 34011183762](https://github.com/Chiakai-Chang/C.A.S.E._Framework/actions/runs/34011183762)：Ubuntu 的 Node 20／24 通過；macOS 24 因測試暫存目錄 `/var` 是系統別名，觸發既有拒絕符號連結的規則，其餘三組遭 fail-fast 取消。修正測試建立的目錄為實際路徑，不放寬產品安全規則，不把取消當成通過。

修正提交 `8c6d6c0` 僅調整兩份測試的四處暫存目錄及發布紀錄，獨立複核確認未變更產品安全防護或移除斷言。本機完整 220/220 再次通過；推送後 [CI 34011479357](https://github.com/Chiakai-Chang/C.A.S.E._Framework/actions/runs/34011479357) 的 Windows／macOS／Ubuntu × Node 20／24 六組全部成功。這是程式跨平台驗證，不代表六種環境都執行過本機模型任務。

文件核對涵蓋 61 份非凍結 Markdown、296 個本地檔案連結，未發現遺失目標；不將此檔案路徑核對宣稱為所有頁內錨點與外部網站皆已驗證。
