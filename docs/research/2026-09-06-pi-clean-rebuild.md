# pi 乾淨重建記錄

日期：2026-09-06。使用者授權重建損壞的全域 pi；備份刪除需另行說明完整路徑與方法，取得確認後才執行。

## 範圍與保護

只處理 AppData/Roaming/npm 下的 `node_modules/@earendil-works/pi-coding-agent` 與 `pi`、`pi.cmd`、`pi.ps1` 三個啟動檔。搬移前核對四個完整路徑與 ReparsePoint，確認不是連結。使用 PowerShell `Move-Item -LiteralPath` 搬移到新的獨立備份，沒有遞迴刪除、萬用字元刪除或跨 shell 串接。

備份位置：`C:\Users\User\pi-rebuild-backups\20260906-01`，包含 `pi-coding-agent` 目錄及三個啟動檔，全部保留。未搬動 AppData、npm 根目錄、模型或研究專案；未恢復舊 harness 擴充。重建前預設 `.pi/agent` 不存在，沒有可搬移的該處設定。

## 安裝

沿用 0.84.2，避免把維修與升級混為同一變因。使用 Node 隨附 npm 11.17.0，官方 `https://registry.npmjs.org`，固定安裝目標原有 npm prefix。使用 `--ignore-scripts --no-audit --no-fund`，另設本專案忽略的獨立 npm 快取。不升級 Node／npm。

官方套件完整性識別：`sha512-l4E+B7hgXKWddRo8bC/eSue2aWZjEgJ9xIpf5p0Og+lq8a2TArCwJ0HCoCPCgaBP/tN4zbYH/wOwvx9pJpeLCA==`。

安裝 exit 0，新增 140 packages。安裝輸出有 node-domexception 棄用警告，沒有安裝失敗。

## 實際驗證

- PATH 上 `pi --version` 成功回報 0.84.2，原本 ERR_MODULE_NOT_FOUND 未再出現。
- `pi --help` 成功顯示命令。
- 新安裝的 SDK import 成功，session/read/write/bash factory 均可取得。
- 實際 SDK read 工具讀取本專案 package.json 成功。
- 實際 SDK bash 工具執行固定 `printf pi-shell-ok`，回報 pi-shell-ok。
- `PI_OFFLINE=1` 僅設於驗證程序，`pi list` 顯示 No packages installed，未改全域環境變數。
- npm 清單仍有其他全域套件 `@tintinweb/pi-tasks@0.7.1`（其內嵌 pi 0.80.3）。未擅自刪除，不能把它的存在等同目前 pi 自動載入；上述 pi 登錄清單為空。

這些證據確認安裝、命令列與基本工具可用，不是本機模型生成驗收、完整相依供應鏈鑑識或 CASE 核心效果驗收。尚未新增本機模型設定或恢復登入資料。專案層級的 `.pi`、AGENTS.md 或自動發現資源仍可能在進入其他專案後被載入，重裝不會也不應刪除那些專案資料。

## 復原與清理界線

舊安裝保留供查核，不建議直接恢復損壞套件。若確有復原需要，先停止正在使用該安裝的 pi，再核對新舊目標；不得直接覆蓋混合兩份套件。

本次沒有刪除任何備份。未來只可對上述精確備份目錄提出清理，先檢查解析後路徑、連結與內容，告知可否回復並取得使用者確認；不可把其父目錄、AppData 或 npm 目錄當成刪除目標。

相關：[環境診斷](2026-09-06-core-failure-triage.md)。全域 pi 缺損已修復，不因此改寫先前四次隔離 CASE 探測的失敗。

重建後的 CASE 接線修復、回饋與檢查分配修正，以及真實模型後續結果另見[核心修復報告](../evaluation/case-core-repair-report.md)。本頁保留重建當時證據，不用後來的設定變更改寫舊結果。

## 接續：本機模型設定與真實工具驗證

使用者同意接續後，於原先不存在設定檔的位置新增 models.json／settings.json，複製前拒絕覆寫既有檔案。只登錄 `local-llama`、localhost:8080，以及 `/v1/models` 回報的現有 Orcarouter STRIX LEAN 模型。預設選本機模型、thinking off、project trust ask、packages 空清單；沒有雲端 fallback 或舊 harness 擴充。採 `reasoning:true`、`thinkingFormat:qwen-chat-template` 讓開關對應模板參數，不再以 reasoning:false 冒充已關閉；contextWindow 262144 對齊當下 server 容量，maxTokens 4096 是此次初始設定，不是最佳參數結論。僅登錄文字能力，未驗證圖片。pi --list-models 能辨識此模型。

第一次受限執行因 sandbox 不允許建立全域 settings.json.lock 而未載入正常設定，沒有模型生成；取得必要執行權限後才進行下列兩次。這個啟動權限失敗與模型失敗分列。

兩次都使用重建的全域 pi 原生 CLI、乾淨測試目錄、no-session、no-extensions/no-skills/no-context-files、offline 與兩分鐘程序上限。offline 是停用啟動網路工作，不是禁止 localhost 推論；一般 bash 工具也不是 OS sandbox。未載入 CASE runner。

| 探測 | 結果 | 時間／SDK 累計 tokens |
|---|---|---|
| 只開 read/write，模型計算後寫出 | 工具往返正常，但模型把 640+560 算成 984；獨立檢查失敗 | 14.880 秒／5332 |
| 開 read/write/bash，明確要求 Node 計算 | 寫出 usd=20、eur=16、twd=1200；外部獨立精確值核對通過 | 18.299 秒／5203 |

第二次模型自己的 assertion 與計算使用相同變數，不能單獨證明演算法正確；主代理另以固定手算預期值做獨立核對。來源資料不變，第一次錯誤產物保留。資料與兩個產物留在本專案忽略目錄 `.npm-cache/pi-rebuild-20260906/smoke/`。工具事件與數值紀錄如下，沒有保存隱藏推理：

```json
{"input":{"quantities":[2,3],"prices":[10,8],"returnedSecond":1,"rates":[32,35]},"readWrite":{"calls":["read input.json","write result.json","read result.json"],"output":{"usd":20,"eur":16,"twd":984},"passed":false},"computed":{"calls":["read input.json","bash ls -la","bash node calculation/write/assert"],"output":{"usd":20,"eur":16,"twd":1200},"passed":true},"inputUnchanged":true,"priorFailurePreserved":true}
```

兩次是不同工具與指令的單次開發探測，不是固定條件成功率或公平品質比較；累計 tokens 含快取，不是峰值 context。硬體／電力成本未知。證據支持「這份 pi 與模型能完成實際工具往返及程式計算」，不能說已驗收 CASE 分包／回饋接續。

後續 CASE 修復仍先對齊工具提示與模型設定；另外須檢查工作包是否提供完成工作所需的計算能力。原 CASE 只有讀／寫及預先核准檢查，不能把驗收命令當成任意計算工具。應保留授權限制，不能為通過案例就直接開放無限制 shell。備份仍未刪除。
