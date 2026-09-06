# 功能覆蓋與驗證範圍

日期：2026-09-06。這份表核對完整交付，不以 M0 測試數或未執行的模型比較代稱產品效果。

## v2 預覽的新增範圍

發布收尾回歸 **220/220 通過**：補齊工作包／工具共用受保護路徑，以及真實任務評分對額外檔案／需求檔改寫的拒絕。以下模型比較在此保護修正前凍結執行，未在途中修改程式，也不宣稱測過修正版的模型效益。最新安裝與合併核對見[發布紀錄](../../docs/evaluation/2026-09-06-preview-release-checks.md)。

最新[真實專案資訊整理比較](../../docs/evaluation/2026-09-06-real-task-report.md)：原生 pi 81.181 秒／62,396 SDK tokens，CASE 596.062 秒／87,964；兩組均無合格產物，沒有觀察到 CASE 優勢。兩臂固定相同來源與受測程式，不介入或追加成功樣本；這與下方指定故障注入的成功是不同證據，不能互相抵銷。

### 本次完整生命週期修復

工程回歸 **169/169 通過**。即時發現、原子處置／補包、同 session 自查修復、獨立工作續行、等待不重問、有界索引／唯讀取證、接受後程式交棒及拒絕未知回報欄位已實作。獨立審閱重現的過期等待與 context 超量已修正；局部複核沒有新增重要問題。技能四情境與分頁操作核對、UTF-8 技能驗證均完成。

本次模型結果見[驗收與復盤](../../docs/evaluation/case-discovery-repair-report.md)及[證據](../../docs/evaluation/case-discovery-repair-evidence.json)：缺檔注入後同 session 修復已有整案成功；新佇列探測的成功、失敗及逾時依各次結果分列，不能只看產物正確就省略整合。以下保留先前版本觀察，不是本次最新版的測試計數或可靠度。

最新同版實測：discovery 04 完成即時回報、採納補包、兩產物及獨立整合，415.643 秒；self-repair 03 完成缺檔拒收、同 session 修復及獨立整合，63.821 秒。兩案 16 份核心／pi 程式雜湊一致；封裝 dry-run 33 檔通過。其餘未通過探測完整保留，不混算成功率。

### 先前版本的效益與開發觀察

最新效益驗收：同模型固定版、三種情境各一對已完成。[結果](../../docs/evaluation/case-value-validation-report.md)為直接執行／摘要接續三案通過，CASE 兩案通過、一案因報表未實際寫入而失敗；成功案也較慢。因此不推薦完整分工作為預設；六筆結果不是普遍成功率估計。125 項工程回歸通過，不抵銷真實模型失敗。

[v2 指南](V2.md) 為新入口。共用核心已提供版本化契約、來源／產物 SHA256、相依工作包、不同 session 核對、全域整合、預算及顯式 v1 遷移；pi runner 使用新 session 依序規劃、執行、核對與整合。核心與 runner 的行為測試不等於模型效果驗收。

pi 0.84.2 的 `pi install -l <本機checkout>/workflow-kit` 已在隔離專案成功，實際 SDK loader 從該專案設定找到 extension，註冊 `case_workflow` 及 `/case`，errors 為空。原生 create/run 也已在真實本地模型完成：124.914 秒，四個角色 session，產物逐 byte 符合且來源未改。原生 remove 成功後，專案套件清單不再登錄 CASE，卷宗、產物與來源套件 SHA256 前後一致；證據在 repository 的 `docs/evaluation/case-v2-native-evidence.json`。核心需 Node 20+，該 pi 版本需 Node 22.19+；其他工具目前只有技能／核心入口，未建立其自動 session 整合。

真實本地模型 CSV 的單 context／分離流程已有 smoke 成功，但重複配對也觀察到分離流程的 integrator 回覆了不合法驗收 ID，核心拒絕結案。開發期五組配對及失敗已保存在 repository 的 `docs/evaluation/case-v2-local-report.md` 與原始紀錄，不能將修正前後混成固定版本統計。格式指引修正後一組，單 context 23.538 秒／SDK total tokens 6069，分離 115.405 秒／21198，兩者獨立產物核對通過；這個簡單工作未顯示分離的品質收益。不能宣稱普遍提升品質、節省成本或完成所有設計驗收。一般 extension 沒有任意 shell 或預設可執行測試清單，工具讀取核對與真正執行測試應分列。

當時比較版本的工程回歸 125/125 通過，涵蓋核心、舊 Kit、回饋接續、專案共識、實際檢查、計畫預檢、有界結構化回報補正、SDK、原生入口及封裝；不代替遠端矩陣或模型效果研究。目前標準命令為 `npm test --prefix workflow-kit`，最新結果見上節。

額外三個 holdout 各執行一次：跨檔案資料彙整通過（88.360 秒）、缺必要價格檔安全停止且未捏造產物（46.084 秒）、保留已核對上游的接續通過（62.378 秒）。原始紀錄在 repository 的 `docs/evaluation/case-v2-holdout-evidence.json`；上游是確定性測試準備，不是模型先前成果或殺程序恢復。缺料案原始回覆雖指出缺檔，卻形成空產物包，得到不清楚的 INVALID_ARGUMENT；後續補上 `{blocked:{reason}}` 出口，以非空原因回報 BLOCKED 且不派 worker。該修正由回歸測試核對，不改寫原始模型結果。這些有限探測不代表長 context、跨模型及設計全部效益驗收通過。

本輪新增回饋流程的四次本機模型探測皆未完成任務：先後遇到純文字格式失敗、能力誤認、重複讀取直到時間預算用完。第 4 次已確認送出前工具清單含寫入工具，仍無產物。詳見[本輪報告](../../docs/evaluation/case-feedback-report.md)與[失敗證據](../../docs/evaluation/case-feedback-development-evidence.json)。不能用先前較簡單案例的成功抵銷這項可靠度缺口，目前仍是預覽。

接續修復（2026-09-06）：pi 全域安裝缺檔已修復；CASE 的工具提示、SDK 模型 compat、blocked 分類、delivery 格式與檢查階段分配已修正。第 5–8 次仍未完成，第 9 次開啟思考後兩份產物精確值核對通過，但時間到期、整案未完成。見[最新修復報告](../../docs/evaluation/case-core-repair-report.md)，不以產物正確省略剩餘驗收，也不將開發期不同設定混為成功率。

第 10 次開啟思考並給十分鐘整案上限，328.253 秒後因 report worker 超過 12 回合失敗；反覆越範圍寫入被拒絕，report 未建立。仍未證明新回饋流程可可靠完成；並非只差使用者實測。

後續第 11–13 次仍失敗，分別為只讀不寫、規劃漏驗收及文字回報未被接受。補上計畫預檢與原 session 一次補正後，**第 14 次完整通過**（489.696 秒／122831 SDK 累計 tokens）：模型補計畫、完成 normalized 與 report、不同 session 核對、整案 completed；另外精確值檢查 exit 0、來源 SHA256 未改。完整失敗及成本見[接續證據](../../docs/evaluation/case-core-repair-followup-evidence.json)。單次成功不代表普遍可靠；沒有放寬權限、繞過驗收、重置預算或改模型服務。

第 15 次同版同設定確認亦完整通過：469.135 秒／105633 SDK 累計 tokens，七個獨立 session、精確值檢查 exit 0、來源不變，未觸發補問。第 14–15 次連續成功，但不足以估計普遍成功率；本次驗證設定是 medium，並未將它寫成通用預設或改使用者全域 pi 設定。

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
