# 安裝與維護

## pi v2：原生本機套件安裝

已在隔離專案以 pi 0.84.2 安裝本機套件，實際 loader 註冊 `case_workflow` 工具、`/case` 指令及技能，載入無錯誤。先用 `git clone https://github.com/Chiakai-Chang/C.A.S.E._Framework.git` 下載專案，再到實際工作專案執行（換成自己的下載位置絕對路徑）：

```text
pi install -l "<CASE下載位置>/workflow-kit"
```

這會在專案設定引用該目錄，不複製套件；保留 checkout 路徑。安裝及移除均遵守 pi 的專案信任確認；若命令提示 Project is not trusted，先核對路徑與套件內容，再依 pi 指示確認。非互動操作可明確附 `--approve` 授權該次設定變更，勿用於未核對的專案。核心需 Node.js 20+，本次 pi 0.84.2 需 Node.js 22.19+。SDK 由 pi 提供，套件以 optional peer dependency 宣告；本地 CLI 不需 SDK。重啟／重新載入 pi 後使用 [v2 指南](V2.md)。只裝技能不會有 `/case`，不要同時疊裝同名 skill。

更新本機 checkout 後重新載入 pi；移除使用 `pi remove -l "<CASE下載位置>/workflow-kit"`，不要改用下方 Node installer 管理 pi package。這是 pi 套件管理方式；移除與模型端到端實測狀態見 [READINESS](READINESS.md)。未刊登 registry 套件，也未驗證此 repository 根目錄的 Git 遠端安裝。

## 可攜技能：使用既有技能安裝器

下列入口只安裝技能及本地核心，不含 pi extension。技能依 v1／v2 資料與任務需求分流；資料不會因更新技能而自動遷移。

在實際工作專案執行（需要 Node.js 20+ 與 Git）：

```text
npx skills add https://github.com/Chiakai-Chang/C.A.S.E._Framework/tree/main/workflow-kit/skills/case-workflow --copy
```

依提示選 AI 工具，保留專案範圍、不加 `--global`。這是 [Vercel Labs Skills](https://github.com/vercel-labs/skills) 的標準 GitHub 子路徑安裝方式。`--copy` 避免連結權限問題。它會依平台放置技能，位置可能與下面自製安裝器不同，例如 pi 使用 `.pi/skills`，並保存共用 `.agents/skills`；若 pi 提示同名技能，確認兩份來源一致，不再疊裝第三份。

更新與移除使用 `npx skills update case-workflow`、`npx skills remove case-workflow`。安裝器版本與權限設定可能改變行為，執行前看提示；不要混用下方 Node 安裝器管理第三方安裝。第三方不保證我們自製安裝器的備份或修改檔案保護規則。

本次以 skills 1.5.23 在隔離專案完成 GitHub 技能發現與四種工具目標的複製安裝；本機 npm exec 遇快取鎖錯誤，改以隔離安裝的同一 CLI 驗證成功。這不是全域 npm 修復，也不是完整模型任務實測。

## 原生機制與目前限制

pi 的本機專案範圍安裝已按上節實測。暫不推薦對本 repo 根目錄直接 Git 安裝：它仍是 M0 研究套件，會帶入研究用相依套件。[pi 官方套件文件](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)

Codex 也可使用其 `$skill-installer`，指定本技能 GitHub 資料夾。Claude Code 的 plugin marketplace 是另一種標準方式，但本 repo 尚未提供 marketplace，不能用不存在的 plugin 指令安裝。單一技能目前無需為此多建一套框架。

## 進階／離線：本套件安裝器

從 framework repository 執行 `node workflow-kit/install.mjs --project "<實際專案目錄>" --host pi`；從本套件目錄則使用 `node install.mjs ...`。project 必須已存在。安裝拒絕連結／junction 路徑與外來同名內容。

| Host | 相對 project 的安裝位置 | 使用方式 |
|---|---|---|
| pi | `.agents/skills/case-workflow/` | `/skill:case-workflow` |
| Codex | `.agents/skills/case-workflow/` | `$case-workflow` |
| Claude Code | `.claude/skills/case-workflow/` | `/case-workflow` |
| all | 以上兩個不同目錄 | pi／Codex 共用一份，避免 pi 重複名稱 |

2026-09-05 查核官方來源：[pi skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)、[Codex skills](https://learn.chatgpt.com/docs/build-skills)、[Claude Code skills](https://code.claude.com/docs/en/skills)。實際載入受版本、專案信任與設定影響；文件相容和實測分列於 [READINESS](READINESS.md)。

安裝後在 project 開啟或重新載入AI 工具，確認技能清單有 case-workflow。沒有時核對啟動位置、信任／skill 設定與同名技能；也可明確請 agent 讀安裝位置的 SKILL.md。不需修改 AGENTS.md、CLAUDE.md 或全域設定。

## Antigravity（agy）與其他AI 工具

[Antigravity 官方技能文件](https://antigravity.google/docs/skills) 目前以 `.agents/skills` 為預設，保留 `.agent/skills` 相容。可用上面的 installer 搭配 `--host codex`，安裝到共用 `.agents/skills/case-workflow/`；不需要另一套任務格式。`--host agy`／`antigravity` 尚不是有效參數，`all` 仍只建立兩個不同目錄。

在 Antigravity 的目標專案確認技能已被辨識，或明確要求讀取 `.agents/skills/case-workflow/SKILL.md`。本專案尚未執行 agy 真實 session；這是官方格式／路徑相容性判斷。使用舊版或非標準設定時先核對該版本的技能目錄，不覆蓋全域設定。移除共用技能目錄會影響所有使用該目錄的AI 工具。

其他能讀檔、執行 Node 並寫入專案的 agent，可以由使用者指定讀取 SKILL.md 後使用相同本地工具；沒有這些能力的聊天介面不能直接操作 CLI。不同產品的自動技能發現及分工功能，不因支援 Markdown 就一律成立。

## 更新與移除

```text
node install.mjs --project "<project>" --host pi --update
node install.mjs --project "<project>" --host pi --uninstall
```

同版本為 unchanged。更新需所有檔案符合 `.case-install.json`，否則拒絕，不提供 force 覆蓋自訂內容。更新／移除把舊安裝移到 `.agents/case-workflow-backups/<id>/` 或 `.claude/case-workflow-backups/<id>/`，回傳完整位置。備份不在標準 skills 搜尋目錄內；還原前先移開現有安裝，不混合兩版。

pi／Codex 共用入口，移除共享目錄會同時影響兩者。all 操作若 I/O 中止可能只完成部分入口，核對目錄後重跑。安裝中斷若留下 `.case-workflow-install.lock`，確認安裝程序停止後再處理。本工具不宣稱抵禦惡意程序同時改檔。

移除保留 `.case-agent` 任務，不改其他技能、agent 或模型設定。需要刪任務時，先備份並確認保存需求；工具不自動清空。

## 跨 session／AI 工具

在同一 project 使用相同 task ID 讀 context，再讀下一步必要來源即可。不同機器需另外同步專案與狀態，不能同時寫。handoff 不自動停止舊 agent；接手前確認原寫者已停止。

## Pi 環境問題

pi 若因缺失模組而無法載入技能，是AI 工具安裝問題。使用正常的 pi 安裝或隔離環境驗證；CLI 仍可用 Node 直接運作。不要為套件清除既有設定、憑證或模型。人工／明確讀取技能的入口可用，但不能代稱該AI 工具的模型行為實測。
