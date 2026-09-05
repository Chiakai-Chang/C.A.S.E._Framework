# 功能覆蓋與驗證範圍

日期：2026-09-05。這份表核對完整交付，不以 M0 測試數或未執行的模型比較代稱產品效果。

| 使用者需要 | 已交付入口 | 驗證／邊界 |
|---|---|---|
| 需求、目標、約束、驗收及直接執行 | SKILL；new | CLI 驗證必填資料；agent 仍需理解真實需求 |
| 任務列出、查閱、進度、阻礙 | list、show、checkpoint | 成功／失敗的實際操作測試 |
| 有限 context 與跨 session | context；接續 reference | 新程序讀回目標、約束、下一步；截斷明示補讀 |
| 多 agent 分工與整合 | 協作 reference、worker 範本 | 規則與例子完整；實際派工使用宿主能力 |
| 跨宿主交接 | handoff；共享 task ID | 安裝在共享與 Claude 位置的 CLI 經不同程序接續同一任務 |
| 檢查、證據、驗收、完成 | record、finish | 缺驗收不能完成；證據內容由使用者／agent 核對 |
| 缺陷再開、資料診斷 | reopen、doctor | reopen 清除過期驗收要求重驗，doctor 拒絕損壞狀態 |
| 初始化、避免名稱碰撞 | init | 拒絕 foreign／舊 M0 namespace 與 linked path |
| 安裝、更新、移除、備份 | install.mjs | 三宿主位置、idempotency、保留自訂檔／任務資料與備份 |
| 易讀易用與漸進載入 | README、SKILL、references、範本、完整實例 | 技能結構驗證、命令與連結核對；不用全讀歷史 |
| 目標復盤 | SKILL 的決策判斷 | 沒有自動排程，不要求固定角色數或輪數 |

## 已觀察的操作證據

Windows／Node 24.19.0：`node --test workflow-kit/tests/*.test.mjs` 通過 13/13。包括安裝後從無關 cwd 啟動獨立程序、建立任務、拒絕提前完成、保存 checkpoint、另一宿主安裝位置接續、寫出並讀回實際產物、記錄證據、完成、reopen、doctor，以及移除後產物／任務仍在。

該流程中的產物由確定性的測試執行者製作，沒有冒充 LLM 行為實驗。完整 CSV 例子是教學，不是已執行的效果評估。

安裝器另經独立實作審閱，無發現阻擋正常安裝、更新或移除的具體問題。可攜技能的 frontmatter 驗證通過。套件無 runtime 依賴，不需要安裝全域工具即可執行 CLI。

獨立情境審閱涵蓋缺 ID／截斷 context 的接續、worker 無來源成功宣稱、已完成任務變更範圍。發現「已完成舊任務需補反向連結」與不可修改完成狀態衝突，已修為只在新任務引用舊 ID，保留舊驗收。這是技能行為審閱，不冒充 pi 模型實測。

實際 npm tarball 共 11 個必要檔案；解壓至獨立目錄後，直接使用封裝內 installer 安裝兩種宿主位置、初始化、建立任務、由另一位置讀 context 及執行 doctor 均成功。沒有打包 tests、模型、node_modules、本地任務、快取或歷史研究資料。

文件收尾後封裝增為 14 個檔案，新增架構、範本導航及英文指南，runtime 不變。再次執行 Kit 測試 13/13 通過，70 個本地文件連結無缺失，兩個 CLI 的 help 與文件命令核對完成。全域 npm 打包因缺少內部模組失敗，改用 Node 隨附 npm 成功，未修動全域安裝。此輪沒有新增模型／宿主行為實測。

## 宿主與平台的區別

pi／Codex／Claude 的安裝路徑及呼叫方式已查核 [官方文件](HOSTS.md)。Codex、Claude 未在獨立的真實宿主 session 內驗證模型遵循；安裝檔案成功不等於已完成這種驗證。

本機現有 pi 0.84.2 的 loader 嘗試因宿主缺失 `yaml` 內部模組而中止，未改動其全域安裝。隨後在本專案忽略的快取目錄隔離安裝相同版本（停用安裝 scripts），以其實際 `loadSkillsFromDir` 載入套件的 skills 目錄：恰好辨識一個 `case-workflow`，diagnostics 為空。這驗證真實 pi loader 的格式辨識，不涉及模型呼叫、全域 extensions 或完整 session 的行為評估。

Node 20 是程式相容目標，當前實測 Node 為 24.19.0。已配置 Linux／Windows／macOS、Node 20／24 的 CI；尚未推送執行，因此不宣稱六組平台已通過。

## 仍需依使用結果判斷

框架完整提供上述功能；尚未聲稱普遍提高模型品質、減少 tokens、長任務零遺漏或所有宿主版本完全一致。模型遵循、實際任務品質與使用成本需要真實使用紀錄。CLI 不驗真證據、不執行任意指令、不接管權限，不提供多機同時寫入、強身分或永久稽核。

公開授權及 registry 發布尚待擁有者決定，這與本地功能是否完成分開處理。
