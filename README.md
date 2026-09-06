# C.A.S.E. Framework

讓 AI 分工時少帶無關脈絡，遇到問題能補做，換對話後能接續，交付時有成果可核對。

C.A.S.E. 是一套**檔案式協作框架**：把專案共識、整體計畫與當前交辦分開保存，再讓 agent 依工作需要取得材料。它由可攜技能、本地狀態工具與 pi 整合組成，不是另一個模型服務，也不要求使用 GitHub Issue／PR。

[開始使用](#開始使用) · [操作指南](workflow-kit/docs/V2.md) · [實測與限制](workflow-kit/docs/READINESS.md) · [文件地圖／Wiki](MAP.md) · [English](workflow-kit/docs/GUIDE.en.md)

目前為 **2.0.0-preview.1 預覽版**。pi 的自動流程已在本機模型完成指定案例驗收；其他 AI 工具可使用技能與共同資料，但自動化程度不同。尚未證明普遍提高模型品質或節省 tokens。

## 它解決什麼問題？

長工作不只需要「記得之前說過什麼」，還需要知道哪些要求仍有效、誰在做什麼、成果是否真的合格。

| 常見問題 | CASE 的處理方式 |
|---|---|
| 規劃討論太長，執行者反而找不到重點 | 全域要求與當前工作包分層；執行者取得必要限制、材料與可回查的來源 |
| 做到一半才發現原計畫漏了工作 | 立即保存缺口與證據，由規劃者在原授權內去重、補做與調整相依 |
| agent 說完成，卻沒產物或沒通過檢查 | 提交先查產物與核准的檢查；遭拒可原回合修復，之後仍須獨立核對 |
| 換對話後重做、漏做，或拿舊結果繼續 | 保存工作狀態、來源版本與未決問題；保留有效成果，重新核對受影響部分 |

**何時值得用？** 需要分階段接續、來源版本追蹤、清楚交辦或獨立核對紀錄時。短問答、小修改或一次能完成的工作直接做即可；檔案多不代表一定要分工。分離 context 是方法，不是越多越好的指標。

## 實際怎麼運作？

例如你交代：

> 用 CASE 整理訂單、價格、退貨與匯率，產出可追溯的營收報告。保留原始檔，只寫入 reports/；自行檢查結果，總時間最多十分鐘。

1. **對齊要求。** 保存成果、限制、驗收與預算；有跨任務共識時沿用其版本，不必每次填表。
2. **清楚交辦。** 規劃者拆出必要工作包。執行者使用新的對話脈絡，只拿當包需要的指引與材料。
3. **邊做邊修正。** 缺前置成果便回報證據，規劃者補做；不相關的工作繼續。遇到新權限、改目標或真正缺外部資料，才需要你決定。
4. **核對再交付。** 執行者自查，另一個 context 核對產物，最後對照整體要求與未解待辦。失敗與部分成果都保留，不用「完成」標記掩蓋問題。

這對應原案的「大憲法 → 小憲法」：大憲法保留共同目的與限制，小憲法是當次可執行的交辦。技能說明工作方法；本地核心保存同一份權威狀態；pi 整合負責自動交接。沒有要求每項任務固定開幾個角色。

## 開始使用

### pi：自動交辦、執行與核對

需要 Git，以及可正常使用的 pi／模型設定。本次驗證使用 pi 0.84.2、Node.js 22.19 以上；本地核心本身需要 Node.js 20 以上。

先把本專案下載到打算保留的位置：

```text
git clone https://github.com/Chiakai-Chang/C.A.S.E._Framework.git
```

接著**在你要工作的專案目錄**安裝，將下列路徑換成剛才下載位置的絕對路徑：

```text
pi install -l "<CASE下載位置>/workflow-kit"
```

這是 pi 的專案範圍套件安裝，引用本機目錄，因此不要移走該目錄。不需在 CASE 根目錄執行 npm install，也不要對此 repository 根目錄直接做 pi Git 安裝。[安裝、更新與移除](workflow-kit/docs/HOSTS.md)

重新載入 pi、選定模型後，直接用上面的方式交代工作。agent 透過 `case_workflow` 建立任務，你可以：

```text
/case list
/case show <id>
/case run <id>
/case stop
```

`<id>` 使用建立任務或 list 回傳的值；stop 是取消請求。需要執行專案測試時，先由你確認 `/case checks <設定檔>` 的命令與權限；沒有核准檢查時，不會宣稱已跑測試。詳見[完整操作與接續](workflow-kit/docs/V2.md)。

### Codex、Claude Code、Antigravity：可攜技能

在工作專案使用 Skills 安裝器，依提示選擇 AI 工具與專案範圍：

```text
npx skills add https://github.com/Chiakai-Chang/C.A.S.E._Framework/tree/main/workflow-kit/skills/case-workflow --copy
```

安裝後請 agent 使用 `case-workflow` 處理工作；Codex 可用 `$case-workflow`，Claude Code 可用 `/case-workflow`。技能包含本地核心與操作參照，但**只裝技能不會安裝 pi extension，也不會自動建立其他產品的子代理流程**。若已裝 pi 套件，不要再疊裝同名技能。

| 使用方式 | 可攜技能／共同資料 | 本套件自動建立獨立 session |
|---|---|---|
| pi 原生套件 | 有 | 有，工作包依序執行 |
| Codex／Claude Code | 有 | 尚未提供原生整合 |
| Antigravity（agy） | 技能格式／路徑相容；未實測完整模型任務 | 尚未提供原生整合 |

跨工具共用資料不等於自動互相指揮。接手前確認舊寫者已停止；其他機器須自行安全同步。[平台差異](workflow-kit/docs/HOSTS.md)

## 可信嗎？目前證據到哪裡？

- **流程可執行：** 本機模型完成即時發現、補前置、兩份產物及獨立整合；也完成缺檔拒收後同 context 修復。程式測試涵蓋相依、來源變更、權限、預算與失敗接續。[生命週期驗收與完整失敗紀錄](docs/evaluation/case-discovery-repair-report.md)
- **效益仍需區分：** 先前固定版六次比較中，簡單流程三案成功，CASE 兩案成功、一案失敗，成功案成本也較高。這些歷史結果沒有被後續修復覆寫；不能因此宣稱全面提升品質或省 tokens。[比較方法與結果](docs/evaluation/case-value-validation-report.md)
- **最新真實任務：** 將本專案四份來源整理成可核對的採用資訊，一般 pi 與 CASE 都未完成合格產物，分別耗時約 81 秒與 596 秒。這次未顯示 CASE 優勢；它不是可以放心無人監督處理任何工作的成熟方案。[完整比較](docs/evaluation/2026-09-06-real-task-report.md)
- **不保證零失敗：** 模型可能漏報問題或在預算內無法修復。CASE 保存可追查的失敗，拒絕明確不合格的結案，不保證發現一切錯誤。

資料存在專案的 `.case-agent/`，不覆寫既有 AGENTS.md／CLAUDE.md。**本地儲存不等於資料一定不出機器**：模型服務由你選擇。pi 的限定工具不是作業系統沙箱，核准檢查仍以你的使用者權限執行。更新／移除技能不刪任務；舊 v1 資料需要[顯式遷移](workflow-kit/docs/V2.md#v1-升級)。

## 進一步閱讀

- 使用：[操作指南](workflow-kit/docs/V2.md) · [安裝維護](workflow-kit/docs/HOSTS.md) · [可選範本](workflow-kit/docs/TEMPLATES.md)
- 理解：[架構與責任](workflow-kit/docs/ARCHITECTURE.md) · [目前驗證範圍](workflow-kit/docs/READINESS.md) · [目標](docs/GOALS.md)
- 接手：[文件地圖／Wiki](MAP.md) · [貢獻方式](CONTRIBUTING.md) · [修改連動與翻譯](docs/MAINTENANCE.md)
- 歷史：[v1 輕量記錄](workflow-kit/docs/WORKFLOW.md) · [原始構想](https://github.com/Chiakai-Chang/Local-Agent-Workspace/tree/main/C.A.S.E._Framework)

主要文件使用臺灣慣用正體中文，英文指南同步使用介面。產品在 `workflow-kit/`；歷史研究不必預先閱讀。研究是為了改善實際工作，不是本專案的最終目的。

公開授權尚未選定，npm 套件保持 private、未發布 registry；repository 公開不等於已授予開源使用權。版本與 Git 交付狀態見 [STATUS](docs/STATUS.md)。
