# 初始規劃：從查讀停滯到可執行交辦

後續對七處錯誤的來源回傳與時序核實，以及直接執行交辦診斷，見[來源使用復盤](2026-09-11-worker-grounding-report.md)。下文保留當時失敗、成本及採用判斷，不覆寫為後來的結果。

日期：2026-09-11（臺灣）。接續 [停止修復與正常流程失敗](2026-09-11-review-boundary-report.md)。目的仍是讓本地模型在有限 context 與成本內完成工作，不以提示更長、格式過關或測試數當成成功。

**裁定：初始規劃接線與角色責任說明已改善，整案未驗收。** 第二次規劃形成單一產出包，但有已知檢查文字矛盾；同卷宗接續後產物有七個欄位錯誤，原預算耗盡於 reviewer，未整合。本批保留工作分支，不合併／推送為已完成交付。

## 已確認的缺口與有界修正

先前正常流程只有 planner：34 次成功查讀、16 回合、309.457 秒，未提交計畫。逐層核對發現初始規劃只傳完整契約，材料概況可透過 case_list 取得，並非自動附入；本機證據也有成功列目錄，不能把缺少預載索引當成唯一原因。SDK 的規劃角色與 case_result 說明則同時包含後續異議核對責任，沒有明示初始工作與全案任務中的「讀取、產出、驗收」如何分工。

保留既有架構，只由 runner 在初始規劃傳 `planningPhase: initial`，SDK 於系統及結果工具說明使用同一份初始交辦指引。後續發現／回饋／異議與直接 SDK 未指定階段時，仍用原指引。工具、schema、狀態驗證、寫入權限、回合與總預算不變；沒有新增角色或禁止必要查證。初始接線與指引選擇反例先失敗後通過；工程測試與模型效果分開判讀。

## 第一次診斷：能提交，不等於計畫品質合格

[原始證據](2026-09-11-initial-planning-evidence.json)、[實際執行腳本快照](2026-09-11-initial-planning-probe.executed.mjs.txt)。腳本原在 repository 根目錄下的 `.npm-cache/` 執行，快照只供追溯，並非直接在 docs 目錄執行的使用入口。

另建隔離卷宗，使用先前凍結任務與來源、相同模型 ID、明示 off／32768 context／4096 輸出／16 回合／600 秒設定。模型服務未重建或改設定，但沒有重新驗證所有 server sampling defaults；腳本 limitations 中「same model settings」應依此收斂解讀，不代表完全凍結。沒有 seed／cache 控制，不是因果比較。診斷在下一個非 planner session **呼叫模型之前**停止，沒有 worker、成果預填或 oracle；停止符號 `PLANNING_PROBE_COMPLETE` 是預定診斷邊界，不是正常流程成功。

結果 **260.642 秒**提交核心可接受的兩個工作包，**74,059 SDK 累計 tokens**（含快取）。2 次 case_list（一次錯把 project 當相對目錄），6 次 case_result（前五次錯誤：多包 result、漏 unknowns、constraint ID 放入 criterionIds、空 deliverables、deliverable 在範圍外）。未使用 case_read／case_search，沒有壓縮，程式版本與來源保留，沒有建立成果。這證明此次能從實際拒收中修正到可入庫的計畫，不能外推可靠度或所有格式錯誤可自修。

**語意判讀未通過：** 第二個 `verify-map` 工作包聲稱唯讀核對，卻在連續格式修正後取得 adoption-map.json 寫入範圍及同名 deliverable。此範圍沒有超越全案原授權，但角色目的與能力不一致，也重複框架既有的 reviewer／integrator。不能把 `status: planned` 直接報成好計畫或完整任務完成。

## 第二次修正的依據

補上已存在但未告知規劃者的責任邊界：每個 packet 是執行者的產出工作；runner 本來就為各包安排獨立唯讀核對、最後做整案整合。自查與驗收條件放在產出包的 checks，不另建只重複內建核對的包，也不為了格式過關替唯讀包增加寫入範圍。若目標明確要求獨立報告或證據產物，仍可合理拆包，不一律禁止研究／核對任務。

只針對這個已觀察到的缺口再做一次獨立初始規劃診斷；不是原樣抽樣、不是增加第一次的額度，也不啟動完整旅程。各次成本與計畫品質必須分開保存。

## 第二次診斷：單一產出包，仍有檢查文字矛盾

[原始證據](2026-09-11-initial-planning-boundary-evidence.json)、[執行腳本快照](2026-09-11-initial-planning-boundary-probe.executed.mjs.txt)。結果 **93.554 秒**、**24,574 SDK 累計 tokens**，1 次列目錄、1 次讀取、2 次結果提交；第一次將 constraint ID 放入 criterionIds，依現有拒收回饋修正後提交單一 `adoption-map` 產出包。沒有重複核對包，程式與來源保留，未執行 worker 或寫入成果。兩次獨立規劃診斷共 **98,633 SDK 累計 tokens**；不同 run 的偶然性、取樣與快取限制仍在，不能據此宣稱穩定節省成本。

獨立審閱確認主要輸入、依賴、唯一成果與寫入範圍合理，但 `map-preserve-sources` 說只讀四份來源與 requirements.md，漏列成果；purpose 卻要求重讀成果，原 contract 也明確允許 declared output。這是檢查描述的語意矛盾，**只裁定結構可交辦，不裁定計畫語意完全正確**。程式驗證尚不能自動理解這類自然語言矛盾。

接續決策：不人工改動計畫，而由同一卷宗原生接續 worker／reviewer／integrator，觀察是否依原契約處理。保留原先規劃 run 的時間與 session 成本，由 runCase 扣除已用額度，**不另給 600 秒**。這不是無中斷正常流程；是模型真的完成初始交辦後，在預定診斷停止點接續，沒有匯入或預填成果。

## 原預算接續：成果有錯，核對尚未回覆

[接續原始證據](2026-09-11-initial-planning-resume-evidence.json)、[執行腳本快照](2026-09-11-initial-planning-resume.executed.mjs.txt)。接續前完整比對同一 case 狀態與凍結程式，沒有改計畫或成果。已保存規劃 run 使用 **92.540 秒**，runCase 因此僅剩 **507.460 秒**。接續 run 記錄 **508.601 秒**，含取消收尾；診斷外層共 **509.608 秒**。未重置額度，亦未把少量收尾超時說成嚴格硬截止。

worker → reviewer，最後 `CANCELLED`，沒有 integrator。程式版本、五份來源保留，沒有額外成果路徑；人工沒有修正產物。worker 使用 **251,592**、reviewer **139,744**，接續共 **391,336 SDK 累計 tokens**；本批兩次規劃與一次接續合計 **489,969**（含快取，不含先前其他診斷；非峰值 context 或完整硬體成本）。

worker 約 **356.252 秒**結束；33 次工具呼叫（1 list／11 read／16 search／4 result／1 write）。它在壓縮前約 189.266 秒就誤交 `packets`，因此不能將角色混淆全歸因壓縮。正常 overflow 壓縮約 **59.059 秒**；之後又以規劃摘要冒充完成，遭 schema／缺少成果拒收，最後真的寫入成果。這支持同 session 能修正特定拒收，**不支持內容已自行驗收正確**。reviewer 8 read／1 list／11 search，沒有結果回覆；未能觀察它是否處理計畫文字矛盾，不能把矛盾說成此輪取消原因。

離線評分比對凍結權威來源，七處錯誤如下；評分只在模型執行後進行，沒有送答案給模型。

| 欄位 | 正確值 | 產物值 |
|---|---|---|
| install.defaultHost | all | pi |
| install.uninstallAbsentAction | absent | not-installed |
| maintenance.kitTestCommand | npm test --prefix workflow-kit | npm test |
| maintenance.fullM0RequiredForKitOnly | false | true |
| maintenance.installerPrimary | install.mjs | workflow-kit/install.mjs |
| maintenance.piPrimary | integrations/pi/ | workflow-kit/integrations/pi/ |
| maintenance.installerRelated | ARCHITECTURE、GUIDE.en、HOSTS、README、help、封裝設定 | ARCHITECTURE、GUIDE.en、HOSTS、README、package.json |

## 工程驗證與下一步

完整 kit **324 項：322 通過、2 項 Windows 符號連結權限跳過**；封裝預覽 36 檔，不含本機診斷快取。獨立審閱確認初始 marker 僅在初始分支傳入、system／結果工具同源、未指定階段相容、回饋／權限／驗收與預算保留；並指出兩份計畫的語意限制，已保留而非隱藏。文件與測試不能代替模型驗收。

回看原始 CASE 的分層協作構想，這批將規劃拉回交辦職責，是必要修正，但不是整個框架效果的證明。現在主要未解問題是執行階段的角色混淆、事實抽取錯誤與核對成本。下一步先用保存的工具結果與事件順序，定位錯誤欄位在查讀、壓縮與產出間的資訊落差；目前沒有保存完整壓縮摘要，不能假裝已知模型忘了什麼。再選擇有證據的交辦或驗證改動，不再逐次加通用提醒，也不追加同版整案抽樣或放寬原預算。
