# 宿主安裝與維護

從 framework repository 執行 `node workflow-kit/install.mjs --project "<實際專案目錄>" --host pi`；從本套件目錄則使用 `node install.mjs ...`。project 必須已存在。安裝拒絕連結／junction 路徑與外來同名內容。

| Host | 相對 project 的安裝位置 | 使用方式 |
|---|---|---|
| pi | `.agents/skills/case-workflow/` | `/skill:case-workflow` |
| Codex | `.agents/skills/case-workflow/` | `$case-workflow` |
| Claude Code | `.claude/skills/case-workflow/` | `/case-workflow` |
| all | 以上兩個不同目錄 | pi／Codex 共用一份，避免 pi 重複名稱 |

2026-09-05 查核官方來源：[pi skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)、[Codex skills](https://learn.chatgpt.com/docs/build-skills)、[Claude Code skills](https://code.claude.com/docs/en/skills)。實際載入受版本、專案信任與設定影響；文件相容和實測分列於 [READINESS](READINESS.md)。

安裝後在 project 開啟或重新載入宿主，確認技能清單有 case-workflow。沒有時核對啟動位置、信任／skill 設定與同名技能；也可明確請 agent 讀安裝位置的 SKILL.md。不需修改 AGENTS.md、CLAUDE.md 或全域設定。

## Antigravity（agy）與其他宿主

[Antigravity 官方技能文件](https://antigravity.google/docs/skills) 目前以 `.agents/skills` 為預設，保留 `.agent/skills` 相容。可用上面的 installer 搭配 `--host codex`，安裝到共用 `.agents/skills/case-workflow/`；不需要另一套任務格式。`--host agy`／`antigravity` 尚不是有效參數，`all` 仍只建立兩個不同目錄。

在 Antigravity 的目標專案確認技能已被辨識，或明確要求讀取 `.agents/skills/case-workflow/SKILL.md`。本專案尚未執行 agy 真實 session；這是官方格式／路徑相容性判斷。使用舊版或非標準設定時先核對該版本的技能目錄，不覆蓋全域設定。移除共用技能目錄會影響所有使用該目錄的宿主。

其他能讀檔、執行 Node 並寫入專案的 agent，可以由使用者指定讀取 SKILL.md 後使用相同本地工具；沒有這些能力的聊天介面不能直接操作 CLI。不同產品的自動技能發現及分工功能，不因支援 Markdown 就一律成立。

## 更新與移除

```text
node install.mjs --project "<project>" --host pi --update
node install.mjs --project "<project>" --host pi --uninstall
```

同版本為 unchanged。更新需所有檔案符合 `.case-install.json`，否則拒絕，不提供 force 覆蓋自訂內容。更新／移除把舊安裝移到 `.agents/case-workflow-backups/<id>/` 或 `.claude/case-workflow-backups/<id>/`，回傳完整位置。備份不在標準 skills 搜尋目錄內；還原前先移開現有安裝，不混合兩版。

pi／Codex 共用入口，移除共享目錄會同時影響兩者。all 操作若 I/O 中止可能只完成部分入口，核對目錄後重跑。安裝中斷若留下 `.case-workflow-install.lock`，確認安裝程序停止後再處理。本工具不宣稱抵禦惡意程序同時改檔。

移除保留 `.case-agent` 任務，不改其他技能、agent 或模型設定。需要刪任務時，先備份並確認保存需求；工具不自動清空。

## 跨 session／宿主

在同一 project 使用相同 task ID 讀 context，再讀下一步必要來源即可。不同機器需另外同步專案與狀態，不能同時寫。handoff 不自動停止舊 agent；接手前確認原寫者已停止。

## Pi 環境問題

pi 若因缺失模組而無法載入技能，是宿主安裝問題。使用正常的 pi 安裝或隔離環境驗證；CLI 仍可用 Node 直接運作。不要為套件清除既有設定、憑證或模型。人工／明確讀取技能的入口可用，但不能代稱該宿主的模型行為實測。
