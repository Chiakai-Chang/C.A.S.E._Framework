# 功能覆蓋與驗證範圍

更新：2026-09-10。此頁區分工程行為、模型結果及交付狀態；測試數不代替模型效果。套件仍為 **2.0.0-preview.1**，本次工作分支尚未合併／推送。

## 目前結論

| 面向 | 已知結果與限制 |
|---|---|
| 工程回歸 | 完整 kit **309 項：307 通過、2 項 Windows 符號連結權限跳過**；封裝預覽 36 個檔案 |
| 本次交辦改善 | pi 未指定 delivery 的來源預設索引；顯式 inline、必讀責任與來源過期保護保留，可攜核心／CLI 預設不變 |
| 局部返修診斷 | 新工具 case_edit 實際被模型使用，**40.206 秒**修好原缺陷且保留全部正確內容；新 worker 診斷，不是整案接續或原預算成功 |
| 最新正常任務 | planner → worker → reviewer → worker → reviewer；核對找到真缺陷，返修卻漏掉原正確內容，**601.698 秒**取消，成果及整案均未通過 |
| 來源與工具範圍 | 最新正常任務的來源完整性、最終寫入範圍、記錄中工具路徑、政策及證據檢查均通過 |
| 成本 | 正常流程 **489,391**、額外局部返修 **29,032 SDK 累計 tokens**（含 cache）；不是峰值 context 或全部成本。正常規劃至執行約 46 秒、首次執行至核對約 130 秒，含交接成本 |
| 審查異議 | 工程已實作引用與版本檢查、一次重核及中斷保護；先前受控模型診斷未通過，最新正常任務沒有走到異議分支 |
| 未解缺口 | 局部修復有效，但尚未完成新工具版本的正常整案驗收。Unicode 邊界由工程反例補驗；不能把前一工具版本的單次模型探測當成最終版本完整實測 |
| 使用建議 | 短工作直接完成；需要版本化交辦、接續或獨立核對時再用完整流程。不建議無人監督執行重要工作 |

最新結果見[返修回歸與局部修改](../../docs/evaluation/2026-09-10-localized-repair-report.md)、[正常流程證據](../../docs/evaluation/2026-09-10-planning-feedback-evidence.json)及[局部返修證據](../../docs/evaluation/2026-09-10-localized-repair-evidence.json)。沒有把評分器交給模型；額外診斷與原預算分開。先前 644.033 秒正確成果但整案失敗見[索引交辦復盤](../../docs/evaluation/2026-09-10-worker-focus-report.md)。

先前 601.856 秒壓縮旅程仍屬無產物失敗，100.361 秒壓縮後輸出額度由 1 恢復 4096 的觀察保留於[壓縮報告](../../docs/evaluation/2026-09-10-search-and-role-report.md)。不同版本、不同起點的診斷不能拼成一次成功，也不能混算可靠度。

## 證據索引：依問題查閱，不串成一次成功

| 問題／日期 | 報告 | 可支持的結論 |
|---|---|---|
| 9/10 壓縮恢復後正常任務 | [最新復盤](../../docs/evaluation/2026-09-10-search-and-role-report.md)、[證據](../../docs/evaluation/2026-09-10-normal-compaction-evidence.json) | 壓縮完成且輸出額度恢復，601.856 秒取消仍未產出 |
| 9/10 搜尋及角色修正後正常任務 | [旅程報告](../../docs/evaluation/2026-09-10-search-and-role-report.md)、[證據](../../docs/evaluation/2026-09-10-normal-search-evidence.json)、[manifest](../../docs/evaluation/2026-09-10-normal-search-manifest.json) | 332.123 秒未產出、未進核對；累計 435,405 SDK tokens（含 cache），非峰值 context |
| 9/10 錯誤否決能否自動反證 | [受控異議](../../docs/evaluation/2026-09-10-controlled-dispute-report.md) | 未形成有效異議；成果保留，角色指示存在可修正的不一致 |
| 9/10 修復成果能否一般核對 | [一般核對與目標復盤](../../docs/evaluation/2026-09-10-dispute-review-report.md) | 約 220 秒完成指定核對，沒有異議分支 |
| 9/9 為何成果正確卻不結案 | [修復後核對](../../docs/evaluation/2026-09-09-repaired-review-report.md) | reviewer 通過，integrator 誤判、planner 錯誤受阻 |
| 9/9 明確修復是否能寫入 | [修復設定對照](../../docs/evaluation/2026-09-09-repair-thinking-report.md)、[前次逾時](../../docs/evaluation/2026-09-09-review-repair-report.md) | off／medium 的指定修復均成功；前次沒有寫入，不能外推整案可靠度 |
| 9/8 交辦及讀取資訊 | [交辦分界](../../docs/evaluation/2026-09-08-planning-handoff-report.md)、[讀取回條](../../docs/evaluation/2026-09-06-read-receipt-report.md) | 工程接線與局部改善不等於完整任務成功；失敗與成本保留 |
| 先前完整生命週期 | [發現／修復驗收](../../docs/evaluation/case-discovery-repair-report.md) | 指定案例完成即時回報、補包、原 session 修復與獨立整合，非普遍可靠度 |
| 固定版效益 | [三類比較](../../docs/evaluation/case-value-validation-report.md)、[真實專案比較](../../docs/evaluation/2026-09-06-real-task-report.md) | 未觀察到 CASE 品質或成本優勢；不推薦一律分工 |
| 先前公開交付 | [發布核對](../../docs/evaluation/2026-09-06-preview-release-checks.md) | 當時安裝與跨平台 CI；不涵蓋本次未交付分支 |

完整研究與設計導航見 [MAP](../../MAP.md)。報告中的當時測試數、下一步與未實作描述保留歷史意義；現況以上方摘要為準。

## v2 功能與較早驗證

[v2 指南](V2.md) 為新入口。共用核心已提供版本化契約、來源／產物 SHA256、相依工作包、不同 session 核對、全域整合、預算及顯式 v1 遷移；pi runner 使用新 session 依序規劃、執行、核對與整合。核心與 runner 的行為測試不等於模型效果驗收。

pi 0.84.2 的 `pi install -l <本機checkout>/workflow-kit` 已在隔離專案成功，實際 SDK loader 從該專案設定找到 extension，註冊 `case_workflow` 及 `/case`，errors 為空。原生 create/run 也已在真實本地模型完成：124.914 秒，四個角色 session，產物逐 byte 符合且來源未改。原生 remove 成功後，專案套件清單不再登錄 CASE，卷宗、產物與來源套件 SHA256 前後一致；證據在 repository 的 `docs/evaluation/case-v2-native-evidence.json`。核心需 Node 20+，該 pi 版本需 Node 22.19+；其他工具目前只有技能／核心入口，未建立其自動 session 整合。

較早 v2 開發期的 CSV、缺料、接續與回饋探測，包含成功、格式錯誤、反覆讀取、缺產物與逾時。它們使用不同修正版本，不應混算成功率。完整紀錄見 [初期模型驗證](../../docs/evaluation/case-v2-local-report.md)、[holdout 原始證據](../../docs/evaluation/case-v2-holdout-evidence.json)、[回饋探測](../../docs/evaluation/case-feedback-report.md)、[核心修復](../../docs/evaluation/case-core-repair-report.md)及[接續證據](../../docs/evaluation/case-core-repair-followup-evidence.json)。這些歷史結果不替代上方目前狀態。

## v1 已交付能力與歷史驗證

以下測試數、跨平台 CI、tarball 檔案數及 loader 記錄屬先前 v1 交付，不能視為目前 v2 套件的同等驗收；保留歷史證據。

| 使用者需要 | 已交付入口 | 驗證／邊界 |
|---|---|---|
| 需求、目標、約束、驗收及直接執行 | SKILL；new | CLI 驗證必填資料；agent 仍需理解真實需求 |
| 任務列出、查閱、進度、阻礙 | list、show、checkpoint | 成功／失敗的實際操作測試 |
| 有限 context 與跨 session | context；接續 reference | 新程序讀回目標、約束、下一步；截斷明示補讀 |
| 多 agent 分工與整合 | 協作 reference、worker 範本 | 規則與例子完整；實際派工使用AI 工具能力 |
| 跨工具交接 | handoff；共享 task ID | 安裝在共享與 Claude 位置的 CLI 經不同程序接續同一任務 |
| 檢查、證據、驗收、完成 | record、finish | 缺驗收不能完成；證據內容由使用者／agent 核對 |
| 缺陷再開、資料診斷 | reopen、doctor | reopen 清除過期驗收要求重驗，doctor 拒絕損壞狀態 |
| 初始化、避免名稱碰撞 | init | 拒絕 foreign／舊 M0 namespace 與 linked path |
| 安裝、更新、移除、備份 | install.mjs | 三種 AI 工具的安裝位置、idempotency、保留自訂檔／任務資料與備份 |
| 易讀易用與漸進載入 | README、SKILL、references、範本、完整實例 | 技能結構驗證、命令與連結核對；不用全讀歷史 |
| 目標復盤 | SKILL 的決策判斷 | 沒有自動排程，不要求固定角色數或輪數 |

## 已觀察的操作證據

安裝入口修正：以 Vercel Labs Skills 1.5.23 對公開 GitHub 技能子路徑執行 list，找到一份 case-workflow；在隔離專案指定 Codex、Claude Code、pi、Antigravity 並以 copy 模式成功安裝，從共用位置 init，再由 Claude 位置 doctor 回傳 HEALTHY。npm exec 曾兩次遇 ECOMPROMISED 快取鎖錯誤，改以隔離安裝的 CLI 成功；不將此描述成 npx 在本機無障礙，也未改全域工具。第三方安裝的更新／移除遵循第三方規則，舊 install.mjs 的備份承諾不適用。

Windows／Node 24.19.0：`node --test workflow-kit/tests/*.test.mjs` 通過 13/13。包括安裝後從無關 cwd 啟動獨立程序、建立任務、拒絕提前完成、保存 checkpoint、另一AI 工具安裝位置接續、寫出並讀回實際產物、記錄證據、完成、reopen、doctor，以及移除後產物／任務仍在。

該流程中的產物由確定性的測試執行者製作，沒有冒充 LLM 行為實驗。完整 CSV 例子是教學，不是已執行的效果評估。

安裝器另經獨立實作審閱，無發現阻擋正常安裝、更新或移除的具體問題。可攜技能的 frontmatter 驗證通過。套件無 runtime 依賴，不需要安裝全域工具即可執行 CLI。

獨立情境審閱涵蓋缺 ID／截斷 context 的接續、worker 無來源成功宣稱、已完成任務變更範圍。發現「已完成舊任務需補反向連結」與不可修改完成狀態衝突，已修為只在新任務引用舊 ID，保留舊驗收。這是技能行為審閱，不冒充 pi 模型實測。

實際 npm tarball 共 11 個必要檔案；解壓至獨立目錄後，直接使用封裝內 installer 安裝兩種AI 工具位置、初始化、建立任務、由另一位置讀 context 及執行 doctor 均成功。沒有打包 tests、模型、node_modules、本地任務、快取或歷史研究資料。

文件收尾後封裝增為 14 個檔案，新增架構、範本導航及英文指南，runtime 不變。再次執行 Kit 測試 13/13 通過，70 個本地文件連結無缺失，兩個 CLI 的 help 與文件命令核對完成。全域 npm 打包因缺少內部模組失敗，改用 Node 隨附 npm 成功，未修動全域安裝。此輪沒有新增模型／AI 工具行為實測。

## AI 工具與作業系統的驗證

pi／Codex／Claude 的安裝路徑及呼叫方式已查核 [官方文件](HOSTS.md)。Codex、Claude 未在獨立的真實AI 工具 session 內驗證模型遵循；安裝檔案成功不等於已完成這種驗證。

本機現有 pi 0.84.2 的 loader 嘗試因AI 工具缺失 `yaml` 內部模組而中止，未改動其全域安裝。隨後在本專案忽略的快取目錄隔離安裝相同版本（停用安裝 scripts），以其實際 `loadSkillsFromDir` 載入套件的 skills 目錄：恰好辨識一個 `case-workflow`，diagnostics 為空。這驗證真實 pi loader 的格式辨識，不涉及模型呼叫、全域 extensions 或完整 session 的行為評估。

本機實測 Node 為 24.19.0。提交 `2a81bc8` 的 [遠端 CI](https://github.com/Chiakai-Chang/C.A.S.E._Framework/actions/runs/33968299883) 已在 Linux／Windows／macOS × Node 20／24 六組環境全部通過。這是工具與安裝流程驗證，不是AI 工具模型行為驗證。

## 仍需依使用結果判斷

首次遠端 CI（d928297）：Linux／macOS 的 Node 20、24 及 Windows Node 24 通過；Windows Node 20 因測試指令的萬用字元未展開而未執行測試。已將 CI、package test 及目前操作說明同步改為明列三個測試檔，歷史紀錄中的舊指令保留。修正後結果以 GitHub Actions 對應提交為準。

修正後六組皆通過，結果如上連結。CI 額外提示 checkout/setup-node v4 的動作執行環境已被平台轉為 Node 24；此非測試失敗，與 setup-node 指定的產品測試版本不同，後續維護應留意動作版本生命週期。

框架完整提供上述功能；尚未聲稱普遍提高模型品質、減少 tokens、長任務零遺漏或所有AI 工具版本完全一致。模型遵循、實際任務品質與使用成本需要真實使用紀錄。CLI 不驗真證據、不執行任意指令、不接管權限，不提供多機同時寫入、強身分或永久稽核。

公開授權及 registry 發布尚待擁有者決定，這與本地功能是否完成分開處理。
