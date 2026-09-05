# 範本入口

範本是給 agent 按需取用的參考，不是使用者必填表單。直接說需求即可，agent 應從既有要求整理目標與驗收。短問答與一次小修改不必 init。

完整可複製的 [工作筆記範本](../skills/case-workflow/assets/task-notes.md) 隨技能安裝，包含：

| 何時需要 | 取用段落 | 放哪裡 |
|---|---|---|
| 有重要取捨或驗收細節 | 任務與決策補充 | 原專案既有筆記，引用 task ID |
| 工作可獨立交給另一 agent | Worker 工作包／結果 | AI 工具派工訊息；結果由協調者整合 |
| 換 session、接手或交付 | 接續與交付補充 | 必要補充筆記；摘要仍用 checkpoint／handoff |

CLI 已保存的目標、約束、驗收，不需再抄進另一份表。不要自動在採用者根目錄建立通用的 PLAN.md、CONTEXT.md 或 TASK.md；有補充需要時選擇不衝突的位置。CLI 不會把 Markdown 筆記匯入為任務。

## 可直接給 agent 的要求

```text
使用 case-workflow 完成這個任務：〈我要的成果〉。
不能違反：〈既有約束〉。驗收：〈可觀察的完成條件〉。
請自行執行已授權工作，保存接續所需資訊，完成後提供成果與實際驗證。
```

接續時：

```text
使用 case-workflow 接續專案〈路徑〉的任務〈task ID〉。
先讀 context，遇截斷補讀 show，核對來源後從下一步繼續。
```

不知道 task ID 時先 list；不因忘記 ID 就重建任務。操作細節見 [完整工作例](WORKFLOW.md)，架構及術語見 [ARCHITECTURE](ARCHITECTURE.md)。
