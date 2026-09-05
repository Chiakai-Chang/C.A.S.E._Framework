# 安裝方式調查：沿用既有工具，不再要求使用者操作內部安裝程式

查核日期：2026-09-05。這是官方文件與目前原始碼的調查，不等於完成安裝實測；後續實測結果集中記在 [READINESS](../../workflow-kit/docs/READINESS.md)。

## 結論

CASE 的技能格式不必重做。問題在於公開入口：把開發用的 `node workflow-kit/install.mjs ...` 放成主要安裝方式，增加不必要的下載、路徑與平台選擇負擔。優先使用已有的技能安裝工具；有原生套件機制時，只補需要的封裝。不要再建立自己的套件管理器，也不要為了統一入口而複製技能。

## 官方機制與目前可用程度

| 對象 | 查核到的慣例 | CASE 的現況與需要處理的事 |
|---|---|---|
| pi | `pi install git:github.com/user/repo`；預設個人範圍，`-l` 為專案範圍。套件根目錄的 `pi.skills` 指定技能來源 | `workflow-kit/package.json` 已有技能宣告，所以 `pi install ./workflow-kit` 是現有本機入口。Git URL 取得的是 repo 根目錄，目前根設定屬於 M0；不能把 Git 安裝寫成已可使用 |
| Codex | 官方提供 `$skill-installer` 從其他 GitHub repo 安裝技能；目前對可重複使用的公開發行，官方建議外掛 | 可把 CASE 技能資料夾的 GitHub URL 交給 `$skill-installer`。外掛需要另外補 manifest 與發行入口，不可假設已有 |
| Claude Code | 原生外掛先加入 marketplace，再安裝指定 plugin；獨立技能也能放進 `.claude/skills` | 尚未建立 marketplace 的 repo，不能直接宣稱 `/plugin marketplace add` 可用。跨工具的技能安裝器可以處理獨立技能 |
| Antigravity | 官方專案位置是 `.agents/skills`，保留 `.agent/skills` 相容；個人位置是 `~/.gemini/config/skills` | 專案技能路徑相容。不把相容性當成模型實測；不要自行發明 `agy install` 指令 |

來源：[pi packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)、[OpenAI 技能文件](https://learn.chatgpt.com/docs/build-skills)、[Claude 外掛安裝](https://code.claude.com/docs/en/discover-plugins)、[Antigravity skills](https://antigravity.google/docs/skills)。

## 現成的跨工具入口

### Vercel Labs Skills

該專案文件支援 GitHub 技能子路徑、互動選擇 AI 工具、`--skill`、`--agent`、`--copy`，預設安裝到目前專案。以下是依官方語法代入 CASE 實際路徑的候選指令，仍須實測：

```sh
npx skills add https://github.com/Chiakai-Chang/C.A.S.E._Framework/tree/main/workflow-kit/skills/case-workflow
```

這不是 CASE 自製 CLI，也不是 pi／OpenAI／Anthropic 官方安裝器。現行 repo 的技能位於 `workflow-kit/skills`，不在該工具列出的根目錄慣例中；使用明確子路徑比假設簡寫能找到技能可靠。Windows 不支援符號連結時可選複製。專案位置相容，但該工具列出的 Antigravity 個人位置與 Google 當前文件不同，不能直接推薦全域安裝而略過驗證。[Vercel Labs Skills README](https://github.com/vercel-labs/skills)

### GitHub CLI

GitHub CLI 自 2.90.0 起提供預覽中的 `gh skill`，不是另裝 `github/gh-skill` extension。官方支援技能精確路徑、`--agent`、`--scope`，可使用：

```sh
gh skill install Chiakai-Chang/C.A.S.E._Framework workflow-kit/skills/case-workflow --agent codex --scope project
```

可換成官方列出的 `pi`、`claude-code` 或 `antigravity`。這是語法已確認、CASE 實測尚待完成的替代入口；不要求每個使用者為此升級 GitHub CLI。先看內容、再安裝，並由同一工具負責後續更新。[GitHub CLI install 手冊](https://cli.github.com/manual/gh_skill_install)、[GitHub 安裝與版本要求](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills)

## 最小且合乎慣例的修正

1. 先實測既有跨工具安裝器的 CASE 子路徑，把成功的慣用方式放進 README；內部安裝程式保留為離線、開發與受控部署選項。
2. pi 若要提供短 Git 安裝指令，必須處理根目錄封裝：只加入 `pi.skills: ["workflow-kit/skills"]` 雖可指定來源，但 pi 對 Git 套件會執行 `npm install`，仍會取得根目錄 M0 相依套件。應明確接受此成本，或將發行內容與研究工具分離，不能藏起來。[pi 套件規則](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)
3. Codex／Claude 原生外掛可以是同一份技能的薄封裝；未建立與實測前不列為現成入口。普通使用者只需安裝一次、交代工作，不需要理解 task ID 或初始化程式。
4. 同一技能不要混用安裝器管理。第三方工具不會遵循 CASE 自製安裝器的檔案摘要與備份規則；更新、移除、覆寫提示應依實際工具說明，不能沿用舊保證。

公開文件採「AI 工具、平台、執行環境、主責 agent、任務資料」等依語境可理解的用詞。保留命令、參數與資料欄位原名，避免為了改文字破壞介面。
