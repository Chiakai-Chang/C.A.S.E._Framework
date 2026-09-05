# C.A.S.E. Framework

讓本地模型在有限 context 下完成符合要求的工作，換對話後能接續，交付時有可核對的成果。

C.A.S.E. 把專案共識、整體計畫與當前交辦分開：規劃者掌握目標，執行者拿必要材料做事；發現缺口可回到規劃者補做，最後核對整體成果。共用核心保存版本與證據，pi 整合負責自動建立不同 context。Codex、Claude Code、Antigravity 可讀寫同一套交辦資料，但目前沒有自動指揮這些產品協作的原生 runner。

目前本地版本是 **2.0.0-preview.1**，v2 核心與 pi 自動 context 流程已實作；本輪工作分支尚未合併或推送。既有 `main` 的 v1 任務記錄工具繼續保留。模型品質與成本的普遍改善仍未證明，實測與限制見 [READINESS](workflow-kit/docs/READINESS.md)。

Portable workflow skill and versioned local core, with a pi integration for fresh planning, execution, review and integration sessions. Other AI tools use the portable skill/core without a native CASE runner. [English guide](workflow-kit/docs/GUIDE.en.md).

## 實際幫助什麼？

長工作常把限制、失敗原因與下一步散落在聊天裡；規劃探索也可能占掉執行時真正需要的 context。CASE 把全域目標與不能違反的條件保留在契約中，每個工作包只帶當前必要材料及可回查的來源。核對者重新讀產物，最後對照整體要求，避免把「每包都說完成」當成全部完成。

例如交代：「整理訂單、價格、退貨與匯率，保留原始檔，交付可追溯的營收報告。」不是讓每個 agent 重讀全部聊天，而是：

1. 專案共識保留「資料不外傳、原始檔不可改」等長期要求；每次工作繼承確認過的版本。
2. 規劃者建立本次成果、整體驗收與工作包；執行者只取得限制、相關材料與允許改動的範圍。
3. 報告工作發現缺少可由既有資料產生的前置成果，就回報並補包，不要求人重新交代整件事；真正缺外部資料才明示停下。
4. 不同 context 核對實際產物，最後檢查整體目標。缺陷要補做，不能反覆問驗收者直到改口；未受影響的有效成果保留。

這是已實作的工作機制，是否比你的原有工作方式更好，仍須看實際成果與成本。詳見 [使用旅程與設定](workflow-kit/docs/V2.md)。

這個設計的價值取決於工作是否更正確、是否減少遺漏與人的介入，不取決於記錄或角色數。新 session 需要額外時間；短問答或一次可完成的小修改直接做即可。長且緊密相依的工作也可使用 v1 記錄分階段接續，不強制拆包。

## 開始使用

pi 的完整 v2 流程從 [安裝指南](workflow-kit/docs/HOSTS.md) 與 [v2 操作指南](workflow-kit/docs/V2.md) 開始。先取得包含本輪 v2 的本機 checkout，再在實際工作專案執行，路徑換成自己的 checkout：

```text
pi install -l "D:/MyProject/C.A.S.E._Framework/workflow-kit"
```

已以 pi 0.84.2 實測原生本機安裝及實際 extension loader，註冊 `case_workflow` 與 `/case` 無載入錯誤；模型端到端及維護操作的最新結果集中於 READINESS。核心需 Node.js 20+，本次 pi 版本需 Node.js 22.19+。這種安裝引用本機目錄，需保留該路徑。

先在 pi 選定預期模型，再交代工作。agent 用 `case_workflow` 建立契約；`/case list`、`/case show <id>`、`/case run <id>`、`/case stop` 用於查看、執行及請求停止。只安裝 skill 不會安裝這個 extension。

既有公開 `main` 的可攜技能仍可沿用下列 v1 發行入口；這個 URL 不代表本輪 v2 已發布：

```text
npx skills add https://github.com/Chiakai-Chang/C.A.S.E._Framework/tree/main/workflow-kit/skills/case-workflow --copy
```

依提示選 AI 工具並採專案範圍，更新／移除使用同一安裝管理工具。Codex 使用 `$case-workflow`，Claude Code 使用 `/case-workflow`，pi 技能入口為 `/skill:case-workflow`；Antigravity 可在 Skills 安裝器選擇。平台差異、離線安裝與同名技能處理見 [HOSTS](workflow-kit/docs/HOSTS.md)。

## 能保證到哪裡？

| 部分 | 已實作的行為 | 邊界 |
|---|---|---|
| 版本化核心 | 專案共識、契約、相依、SHA256、計畫修正及全域驗收 | 檢查結構與版本，不替文字證據內容背書 |
| Context 組裝 | 全域限制、小型必讀材料、大型必要來源索引 | 超出字元預算報錯；索引不代表可以省略必要資料 |
| pi 整合 | 新 session、依序執行、限定工具、取消與用量保存 | 不是 OS sandbox；其他 AI 工具沒有本套件的原生 runner |
| 接續與升級 | 保存失敗、修訂後使舊驗收失效、顯式 v1 遷移 | 舊寫者須先停止；遷移在資料目錄外保留備份 |

pi 不提供任意 shell；使用者可透過 `/case checks <設定檔>` 確認可信檢查清單，runner 執行並保存真實結果，失敗不能被模型自評覆蓋。沒有清單就不宣稱執行了測試。這些命令及其執行的專案程式仍具有使用者權限，並非沙箱。資料雖存在本機，AI 工具仍可能將讀取內容送往你選定的模型服務。

真實本地模型的[開發比較與完整失敗紀錄](docs/evaluation/case-v2-local-report.md) 已保存。格式指引修正後一組，單 context 23.538 秒／SDK total tokens 6069，分離 115.405 秒／21198，兩者產物核對通過；這個簡單工作未顯示品質收益，卻增加成本。修正前後樣本不能合成固定版本統計，也不支持普遍品質提升或省 token 的宣稱。[既有六組跨平台 CI](https://github.com/Chiakai-Chang/C.A.S.E._Framework/actions/runs/33968299883) 屬 v1 提交 `2a81bc8`，不是目前 v2 的遠端驗收。

## 文件入口

- [v2 流程](workflow-kit/docs/V2.md) · [安裝、更新與移除](workflow-kit/docs/HOSTS.md)
- [架構與責任](workflow-kit/docs/ARCHITECTURE.md) · [驗證範圍](workflow-kit/docs/READINESS.md)
- [可攜套件](workflow-kit/README.md) · [v1 操作實例](workflow-kit/docs/WORKFLOW.md) · [可選範本](workflow-kit/docs/TEMPLATES.md)
- [目標](docs/GOALS.md) · [現況](docs/STATUS.md) · [驗收](docs/ACCEPTANCE.md) · [文件地圖](MAP.md)
- [貢獻方式](CONTRIBUTING.md) · [維護關聯與翻譯](docs/MAINTENANCE.md)

主要文件採臺灣慣用正體中文，英文指南同步使用介面。`workflow-kit/` 是產品入口；歷史研究由 [MAP](MAP.md) 按需查閱，不是使用前置條件。原始構想保留於 [Local-Agent-Workspace](https://github.com/Chiakai-Chang/Local-Agent-Workspace/tree/main/C.A.S.E._Framework)，作為復盤參照，不盲目照抄。

公開授權尚未選定，npm package 保持 private，未發布 registry；不要把 repository 可見性當成已授予開源使用權。合併、推送與正式發布狀態以 [STATUS](docs/STATUS.md) 為準。
