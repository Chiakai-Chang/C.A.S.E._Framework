# 開發與接手

先讀 [目標](docs/GOALS.md)，再由 [MAP](MAP.md) 導航。產品在 `workflow-kit/`，舊 M0 在根目錄 `src/`、`conformance/`、`evaluation/`；分別驗證，勿混用支援宣稱。

## Workflow Kit

修改前先查 [維護關聯與語言原則](docs/MAINTENANCE.md)：找到行為的主要定義，再同步相關使用說明、技能與翻譯。中文以臺灣用語為主；歷史研究與原始證據不為統一文風而改寫。

Node.js 20+，不需安裝依賴：

```text
node --test workflow-kit/tests/install.test.mjs workflow-kit/tests/workflow.test.mjs workflow-kit/tests/journey.test.mjs
node workflow-kit/install.mjs --help
node workflow-kit/skills/case-workflow/scripts/case.mjs --help
```

在 `workflow-kit` 目錄 `npm pack --dry-run` 查核封裝。技能入口保持精簡，references 按需載入。規則對應實際需要；測試驗證操作及失敗副作用。README 指令應能在隔離專案跑通。

文件小修核對連結與事實即可。分清功能實作、特定環境操作、AI 工具載入、模型行為及長期效果，不能互相替代。CI 設定不等於已觀察到 CI 通過。

## M0 研究

只有涉及 M0 的改動才於根目錄使用 Node 24 lockfile 與 `npm run check`。歷史完整性驗證：

```text
node evaluation/markdown-baseline/verify-results.mjs --protocol-revision 09a96bc84c013b5e4d586aa4270a922f6a6e9fea
```

參數是清單綁定的方法提交，不是 HEAD。不要改結果／清單來讓驗證通過；證據位元組受 .gitattributes 保護。

不提交模型、憑證、本地任務或測試快取。備份與任務保存由採用者決定。尚未選定公開授權，不將 repository 可見性當成開源授權；不得自行選授權或發布 registry。
