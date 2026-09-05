# C.A.S.E. Framework

讓 AI agent 在有限 context、跨 session 與分工後，仍能清楚知道目標、目前做到哪裡、證據在哪裡，以及下一步該做什麼。

**現在可使用：C.A.S.E. Workflow Kit 1.0。** 包含可攜技能、任務工具、完整流程、範本、實例，以及 pi／Codex／Claude Code 的專案安裝入口。本地工具不需 API key 或伺服器；模型由原有 agent 提供。

Portable workflow skill and dependency-free local task tools for Pi, Codex and Claude Code. Supports task setup, bounded context, session recovery, delegation guidance, evidence tracking and delivery. Model quality and cost improvements remain empirical questions.

## 開始使用

取得本 repository，使用 Node.js 20+。在 repository 根目錄執行，將 project 換成實際要工作的專案：

```text
node workflow-kit/install.mjs --project "D:/Projects/MyProject" --host pi
```

pi／Codex 共用 `.agents/skills/case-workflow/`；Claude 使用 `.claude/skills/case-workflow/`。可選 `--host codex`、`claude` 或 `all`。不修改原有 AGENTS.md、CLAUDE.md、全域設定或憑證。

在目標專案啟動或重新載入 agent：

| Agent | 使用方式 |
|---|---|
| pi | `/skill:case-workflow 請完成……，驗收條件是……` |
| Codex | `$case-workflow 請完成……，驗收條件是……` |
| Claude Code | `/case-workflow 請完成……，驗收條件是……` |

若技能未載入，明確請 agent 讀取安裝位置的 SKILL.md。宿主信任、權限及設定仍由宿主控制，見 [宿主說明](workflow-kit/docs/HOSTS.md)。

## 完整工作流程

- 目標、約束、驗收 → 規劃與執行 → 紀錄與檢查 → 交付 → 必要時重新開啟。
- 按需讀取當前狀態及來源，提供精簡接續內容；重要內容截斷時要求補讀。
- 同一專案與 task ID 可跨 session／宿主接續，無需複製完整對話。
- 提供工作包、責任、回報和整合範本；分工使用宿主既有能力，沒有時依序處理。
- 在實際決策時判斷目標是否偏移，不設排程或強制多輪討論。
- 初始化、列出、查閱、checkpoint、context、證據、交接、完成、reopen、doctor，以及技能更新／移除。

短問答與小修改可直接做，不強制建卷宗。CLI 不自行執行模型、驗真證據或保證所有並行／外部修改安全。

## 文件入口

- [套件使用與手動指令](workflow-kit/README.md)
- [完整操作實例](workflow-kit/docs/WORKFLOW.md)
- [安裝、更新、移除及疑難排解](workflow-kit/docs/HOSTS.md)
- [功能覆蓋與驗證範圍](workflow-kit/docs/READINESS.md)
- [目標](docs/GOALS.md) · [現況](docs/STATUS.md) · [貢獻方式](CONTRIBUTING.md) · [全域地圖](MAP.md)

## 舊 M0 與發布

`workflow-kit/` 是目前產品；根目錄 `src/`、`conformance/` 與 `evaluation/markdown-baseline/` 保留 M0 完整性研究。格式不同，既有 `.case-agent/` 的衝突會被拒絕，不自動遷移或覆蓋。

舊 M0 production adapter 仍未支援；不要用根目錄的 `case-agent init` 作為 Workflow Kit 入口。見 [M0 參考](docs/M0-REFERENCE.md)。

公開授權尚未選定，npm package 保持 private，未發布 registry。程式可本地使用與驗證；授權與正式發布由擁有者決定。
