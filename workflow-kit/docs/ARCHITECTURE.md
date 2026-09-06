# 架構與用語

本頁只描述 Workflow Kit；根目錄 M0 的 revision、submission、accept 等規則不適用。先使用 [完整例子](WORKFLOW.md)，需要理解責任或接手開發時再讀本頁。

## v2 共用核心與整合

`core/io.mjs` 定義共用材料路徑保護，核心組裝／雜湊與 pi 讀寫／列目錄均套用，避免 inline 材料繞過工具的設定目錄限制。一般指引檔仍可引用；不是秘密掃描或 OS sandbox。

[v2 指南](V2.md) 說明新流程；以下 v1 詞彙與操作仍供舊任務使用。v2 的 `scripts/core/index.mjs` 匯出 `createStore(project)`，提供 init、migrate、create、get、list、dispatch、context 及 run artifacts 保存；`case-v2.mjs` 和 pi extension 共用狀態規則。v1 `case.mjs` 保留，兩種格式不混寫。

卷宗契約保存目標、限制、驗收與預算，工作包保存材料版本、相依、寫入範圍、產物及 checks。核心處理 revision／requestId、SHA256 與狀態轉移；pi SDK 整合負責新 session、限定工具、取消、用量及依序執行。核對 session 與 worker 分開，全域 integrate 不只相信包的 pass。詳情按需讀[契約參照](../skills/case-workflow/references/v2-contracts.md)。

v2 權威資料在 `.case-agent/cases/<UUID>/state.json`，run 紀錄在 `artifacts/`；v1 `tasks/` 遷移後保留歷史。既有 manifest 可選 `projectPolicy`／`projectHistory` 保存跨卷宗共識，store 的 `project`／`setProject` 管查詢與明示修訂，create 繼承快照。沒有新增根目錄檔名或第二份可編輯狀態。核心無額外 runtime 相依，pi 以既有 SDK 執行；新 session 和工具路徑檢查不是 OS sandbox、身分認證或防竄改。Codex／Claude／Antigravity 尚無本套件的自動 session 整合。

`amendments.mjs` 驗證契約不變的計畫修正，依語意、來源／產物版本、相依與寫入重疊判斷哪些成果可保留；packetHistory 保存被替換嘗試，預算依 attempt ID 去重。`runner.mjs` 將 worker changeRequest、重複核對缺陷及整體失敗送回 planner，run 保存 pendingFeedback，跨次啟動也不能跳過尚未補做的缺口。

`discoveries.mjs` 管執行中待辦：來源與證據、重送、採納／合併／等待／不採納、重開及整合門檻。SDK 的 `case_discover` 透過 runner 回呼立即保存；規劃者以 `resolve_discoveries` 原子處置及補包，worker 不直接派工或改全域契約。blocking 只停止受影響包；待外部條件的案可先完成獨立工作。state 啟用此功能才升為 `case-workflow/2.1`，manifest 保持 2，舊讀者拒絕新 state。

提交分三層：worker 在原 session 實作、自查、修復；SDK await 核心 `validateAction(submit)` 與本包核准檢查，失敗仍允許修正；正式提交後由不同 session 核對，再做全域整合。預檢不寫狀態、不提高權限、不增加預算，驗證期間工具不可並行穿插，最終文字同樣不能跳過驗證。這些機制防止已知缺檔或失敗被當成完成，不保證模型能發現所有問題。

`approved-checks.mjs` 將人類確認過的命令／引數凍結，pi 原生命令負責確認；runner 在核對／整合前執行並保存實際結果，不允許模型覆蓋失敗。沒有啟動外部命令的權限身分隔離：同使用者權限的程式仍可改資料，需強隔離時由外部沙箱提供。

發現資料的完整 evidence／history 仍只在 state。`discoveryIndex` 產生短索引；`store.readDiscovery` 提供有 revision 的唯讀分頁。pi `case_discovery_read` 固定當前卷宗，worker／reviewer 另限當包相關 ID。這避免新增佇列反過來占滿 context，不宣稱所有材料或模型壓縮都能無損自動接續。接受 `case_result` 後程式主動停止生成，不再依賴模型自行停止；相同重送只取回原收據。

## v1 四個部分各做什麼

| 部分 | 負責 | 不負責 |
|---|---|---|
| AI 工具：pi、Codex、Claude 等 | 模型、工具權限、session、可用的 subagent | 不由 Kit 更換模型或接管設定 |
| Skill 與按需 references | 需求理解、讀取範圍、工作方法、分工與成果判斷 | 不是強制執行或安全隔離 |
| 本地 CLI | 初始化、結構驗證、任務狀態、精簡接續、驗收記錄 | 不呼叫模型、不執行測試、不驗真證據 |
| Installer | 專案級技能安裝、更新、備份、移除 | 不修改全域設定、不刪任務、不自動遷移 M0 |

表中的 Installer 是套件內進階安裝器。一般使用者改用既有 Skills 工具安裝同一份技能；它的路徑、更新與移除以自身規則為準，不繼承此表的備份承諾。見 [安裝指南](HOSTS.md)。

使用者給需求 → agent 按技能執行實際工作 → CLI 保存必要狀態 → 新 session／另一AI 工具讀狀態及來源 → 繼續工作與交付。產物仍存於原專案，不塞進任務摘要。

## 可攜技能安裝與 v1 資料

```text
採用者專案/
  .agents/skills/case-workflow/  pi／Codex 共用技能
  .claude/skills/case-workflow/ Claude 技能（選裝）
  .case-agent/
    workflow.json              Kit 格式與歸屬標記
    tasks/<UUID>.json          每個任務的狀態
  原有程式、文件與測試           實際成果及證據來源
```

安裝不等於 init：installer 只放技能，agent 在值得持續追蹤的任務才初始化資料。工具沒有 runtime 依賴，需 Node.js 20+。技能安裝後包含 scripts、references、assets，不依賴原 framework repository。

Antigravity 的當前標準路徑亦為 `.agents/skills`，相容範圍見 [HOSTS](HOSTS.md)。不同AI 工具分享同一 project 和 task ID，並非自動互傳訊息或同時協調執行。

## v1 詞彙

| 名稱 | 在 Kit 中的確切意思 |
|---|---|
| 任務／卷宗（task） | 一個目標、約束、驗收及工作狀態，由 UUID 識別；不是聊天 session |
| 協調者 | 唯一更新任務記錄的人或 agent；由工作分工約定，非身分認證 |
| checkpoint | 保存摘要、下一步及 active／blocked 狀態，不替AI 工具壓縮 context |
| context | 有長度限制的接續視圖；有截斷警示時先用 show 補讀 |
| handoff | 記錄接手對象、摘要與下一步；不發訊息、不要求協議式 accept |
| evidence | 已觀察結果及可追溯來源的文字；CLI 不判斷內容真偽 |
| finish | 所有條件已記錄 pass 才設為完成；不代表獨立審查或人類批准 |
| reopen | 因缺陷重新開案，重置驗收，要求重新核對 |

## v1 狀態與責任

新任務為 active；遇阻礙可 checkpoint 為 blocked，解除後可回到 active。所有條件通過才 finish；完成後修改需 reopen。目標變更建立新任務，引用舊 ID，不改寫舊驗收讓它通過。

Workers 回報指定產物與證據，協調者核對後更新資料。交接前停止原寫者；寫入鎖只是合作式衝突防護，不是多機協作系統。單欄文字上限 2,000 字元、約束與驗收各最多 20 項；最近 30 筆事件不是永久歷史，重要決策與證據留在來源檔。

## 開發者入口

`install.mjs` 管安裝；`skills/case-workflow/scripts/case.mjs` 管 v1，`core/` 與 pi integration 管 v2；`tests/` 驗證安裝、狀態、回饋、共識、工具與接續。修改 Kit 跑 `npm test --prefix workflow-kit`（repository 根目錄）。只有改 M0 才需要舊完整套件。
