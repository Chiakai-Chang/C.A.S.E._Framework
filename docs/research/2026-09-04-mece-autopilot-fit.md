# MECE-Autopilot 與新版 C.A.S.E. Agent Protocol 的整合適配審查

日期：2026-09-04
研究對象：[`Chiakai-Chang/MECE-Autopilot`](https://github.com/Chiakai-Chang/MECE-Autopilot/tree/0dee4fab9b86fe1ba318694fe90843177811f9dd)
上游快照：`0dee4fab9b86fe1ba318694fe90843177811f9dd`（2026-07-04）
既定 C.A.S.E. 背景：v0.x 為人工分派、file-native work protocol；L0 protocol 與 L2 reference CLI 為 supported；單一 portable skill 為 experimental；L3 later。產品核心原則為「在最低必要認知與抉擇負擔下，提高可驗證成果品質」。

## 結論摘要

**推薦：把 MECE-Autopilot 視為獨立 companion，並只把一個經改寫、可選的「高風險決策審查 policy/workflow」接到 C.A.S.E.；不要把上游協定、CLI、狀態機、全域技能或檔案拓撲納入 C.A.S.E. 核心。**

- **[事實]** 上游自己把方法定位為啟發式實驗框架，明言目前沒有學術研究或實證資料證明它能直接提高最終程式碼品質，且多角色辯論會顯著增加 token 消耗。[README 限制聲明](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/README.md#L16-L22)
- **[事實]** 文件主張動態角色、無固定輪數、依收斂條件停止；實際 orchestrator 卻沒有 tier 欄位，固定在兩個 discussion cycles 後轉入 SWOT，沒有動態重組角色或可執行的 convergence gate。[Constitution 的動態承諾](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/CONSTITUTION.md#L19-L35)、[實際 state 初始化](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/scripts/mece-autopilot-orchestrator.js#L184-L239)、[固定兩輪轉移](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/scripts/mece-autopilot-orchestrator.js#L371-L426)
- **[事實]** 驗證器只以關鍵字正則與字數判定文件是否「合規」；CI 的 strict 呼叫還把 `--strict` 當成目錄參數，並以 `|| echo` 吞掉失敗，因此不能作成果品質或 protocol conformance 的可靠證據。[validator checks](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/scripts/mece-autopilot-check.js#L24-L108)、[argument handling](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/scripts/mece-autopilot-check.js#L237-L245)、[CI workflow](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/.github/workflows/mece-autopilot-check.yml#L22-L32)
- **[推論]** 這些落差不代表「多視角反駁」沒有價值；它們代表上游目前適合作為可借鑑的決策腳手架，而不適合作為 C.A.S.E. 的 MUST、核心狀態機或 conformance 基礎。

最小可保留的精華只有四件事：先寫清楚決策與成功條件；列出互不重複的評估面向；要求至少一個有證據的反論／失敗路徑；輸出推薦、trade-offs、未決事項與 human-required 欄位。角色扮演、固定 SWOT/TOWS、每輪長文、專案內 `wiki/`、全域安裝與另一套狀態機都不是必要部分。

## 研究方法與證據界線

- **[事實]** 本文逐檔檢查上游 README、Constitution、skill、orchestrator、validator、CI、安裝器、版本檔、decision records 與 git history；也在該快照執行 `node --check` 與兩種 validator 呼叫。沒有把 repo 自己生成的「專家發言」當成外部驗證。
- **[事實]** `node scripts/mece-autopilot-check.js --strict` 在該快照以「Directory not found: --strict」退出 1；`node scripts/mece-autopilot-check.js decisions --strict` 對 25 份 decision files 回報 225/225。前者重現 CI 參數錯位，後者只證明文件包含規則所找的字樣，不能證明推理或決策正確。
- **[事實]** repo 內沒有為方法成效提供論文或外部實驗引用；除安裝 URL 與 Conventional Commits 外，主要「證據」是 repo 自己的 decision/round artifacts。因此本文不把「更完整、降低注意力衰退、快取可省九成、100% 零摩擦」等自述當成已證成效果。上游 README 本身也做了相同的學術限制聲明。[README](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/README.md#L16-L22)
- **[事實]** git history 有 94 commits，從 2026-04-18 的初始 commit [`2bc7d68`](https://github.com/Chiakai-Chang/MECE-Autopilot/commit/2bc7d68c2994454e04d54070c781bb77347a83cd) 到本次快照約兩個半月；repo 首頁顯示尚無 release。[repository history](https://github.com/Chiakai-Chang/MECE-Autopilot/commits/0dee4fab9b86fe1ba318694fe90843177811f9dd/)、[repository releases](https://github.com/Chiakai-Chang/MECE-Autopilot/releases)
- **[推論]** 這是一個快速演進、尚未有穩定 release 與外部成效驗證的原型。整合時應釘住 commit，不能依賴浮動 `master` 或版本字串。

## 一、理念與 C.A.S.E. 原則的相合處

### 1. 降低不必要提問，交付有權衡的建議

- **[事實]** 上游主張「debate over questioning」，只在主觀價值、核心預算門檻、或沒有客觀最優解的重大未決風險時詢問人類，並把面板定位為 proposer。[Constitution](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/CONSTITUTION.md#L29-L35)
- **[推論]** 這與 C.A.S.E. 的「最低必要認知與抉擇負擔」方向一致：代理不應把所有技術小選擇倒回給人類，而應先蒐證、提出預設方案與清楚 trade-offs。

### 2. file-native 的可恢復推理痕跡

- **[事實]** orchestrator 把狀態寫入 `wiki/.mece_state.json`、下一步寫入 `wiki/next_task.md`，並把各階段輸出保存在 `wiki/rounds/`；其明示目的包括避免 context bloat、支援 checkpoint 與 resume。[orchestrator paths and purpose](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/scripts/mece-autopilot-orchestrator.js#L3-L42)
- **[推論]** 「將重要決策輸入、反例與結論外部化成可讀 artifact」與 C.A.S.E. file-native 方向相合。但相合的是 artifact 原則，不是 MECE-Autopilot 的特定目錄、狀態名或逐角色檔案數量。

### 3. 反共識與未決事項顯式化

- **[事實]** 上游要求至少一個 Devil's Advocate、記錄衝突，並在結論中區分已決定、未解決與需人類判斷的事項。[role requirements](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/skills/mece-autopilot/SKILL.md#L151-L197)、[synthesis requirements](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/skills/mece-autopilot/SKILL.md#L305-L334)
- **[推論]** 把最強反例與未決風險寫進交付物，有助於 C.A.S.E. 提高「可驗證成果品質」。這比保留戲劇化角色對話更接近可測的不變量。

## 二、主要不相容與風險

### 1. 觸發面太廣，與最低必要負擔相衝

- **[事實]** skill 要求對架構評估、trade-off、技術選型、流程優化、策略分析等關鍵字主動啟用，甚至把「簡單二選一、低風險且 trade-offs 明確」列為 L1 自動觸發；直到 2026-07-04 才在 commit [`4be6cb8`](https://github.com/Chiakai-Chang/MECE-Autopilot/commit/4be6cb8b0a52555acfe5ca9a6ae16ff36283a85c) 加入 negative triggers。[skill triggers](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/skills/mece-autopilot/SKILL.md#L14-L41)
- **[推論]** 若作為核心 MUST，幾乎所有非平凡工程選擇都可能升格為儀式化審查。這會增加 token、延遲、artifact 數與使用者閱讀負擔，與產品核心原則相反。
- **[建議]** 只有在「至少兩個實質可行方案」且同時跨過不可逆性、blast radius、金額／時間門檻、外部承諾、安全合規或高不確定性其中一項時，才自動建議啟用；其他情況只允許使用者顯式啟用。

### 2. 角色模擬不是獨立專家或新證據

- **[事實]** skill 明認所有角色由同一模型生成，面板本質上自我參考；它用 Devil's Advocate、角色盲區與 User Wildcard 作緩解，但沒有提供比較實驗。[known limitations](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/skills/mece-autopilot/SKILL.md#L451-L462)
- **[事實]** orchestrator 不是多代理或多模型系統；它讓同一個外部 agent 依序讀 `next_task.md`、扮演角色並寫檔。下一位通常只被指向上一份完整發言，程式沒有實作所宣稱的多來源 evidence gathering 或獨立驗證。[next-expert prompt](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/scripts/mece-autopilot-orchestrator.js#L512-L551)
- **[推論]** 角色可以是「檢查視角」，不能當成專業身份、獨立樣本或共識票數。`expert panel votes (simulated)` 是同一生成器對自己的停止判斷，不構成外部驗證。[simulated vote criterion](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/CONSTITUTION.md#L177-L183)
- **[建議]** C.A.S.E. seam 應表達為 `review lenses`（例如 operability、security、consumer impact）與一個 `counterargument`，而非 `experts` 或 `votes`；若某結論需要真實專業權威，輸出必須是 `human_required` 或要求外部一手證據。

### 3. 文件中的動態收斂沒有落到實作

- **[事實]** Constitution 說沒有 round 上限、3–7 只是常見範圍，直到 convergence criteria 滿足才停止；每輪發現新維度時應重組面板。[dynamic evolution](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/CONSTITUTION.md#L25-L27)、[reassembly triggers](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/CONSTITUTION.md#L129-L143)
- **[事實]** 程式在 state 中沒有 problem tier、round budget、new-dimension、evidence status 或 convergence result；角色只解析一次，且只檢查至少兩個列表項。討論完成第二個 cycle 就無條件進 SWOT。[state schema](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/scripts/mece-autopilot-orchestrator.js#L208-L217)、[expert parser](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/scripts/mece-autopilot-orchestrator.js#L318-L368)、[fixed transition](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/scripts/mece-autopilot-orchestrator.js#L389-L425)
- **[推論]** 接入上游 CLI 會讓 C.A.S.E. 同時背負一套宣告式動態協定與一套實際固定流程；這是不可接受的 conformance ambiguity。

### 4. Human authority 只在文字上成立，且「否決」不是所有風險的安全閘門

- **[事實]** Constitution 對技術／工程決策分配給 AI，安全／倫理給人類；同時採 Default Active, Explicit Veto。[decision authority](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/CONSTITUTION.md#L39-L68)
- **[事實]** CLI 只有 init、step、status、reset 與互動選單；沒有 veto、pause、resume、approve、authority class 或 approval receipt。文件要求「隨時輸入 Veto」沒有對應的狀態轉移。[CLI routing](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/scripts/mece-autopilot-orchestrator.js#L582-L665)、[skill veto claim](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/skills/mece-autopilot/SKILL.md#L434-L447)
- **[推論]** 「人類可以在看到時阻止」不等於「高風險動作必須取得人類授權」。當人類不在線、沒讀長文或 agent 已開始執行時，veto model 不能取代 affirmative approval。
- **[建議]** C.A.S.E. 必須保留自己的 human authority：價值／偏好、預算上限、外部承諾、資料刪除、不可逆變更、安全與合規不得由 policy 降權；審查輸出只能提出方案，不能自行把 C.A.S.E. 工作推進到需人類接受的 transition。

### 5. 成本與 context 負擔是結構性的

- **[事實]** `SKILL.md` 為 468 行、19,713 bytes；它要求再讀 15,769-byte Constitution，並指向 10,769-byte L2 範例。Agent Skills 官方規格說啟用時會載入整份 skill，建議 instructions 少於 5,000 tokens，詳細材料應按需移到 references。[upstream skill](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/skills/mece-autopilot/SKILL.md)、[Agent Skills progressive disclosure](https://agentskills.io/specification#progressive-disclosure)
- **[事實]** orchestrator 要求 3–5 個角色；每位角色在兩個 cycles 各寫至少 300 words，另有至少 150-word 分解、200-word面板、250-word SWOT 與 400-word 報告。單次標準流程因此最低要求約 2,800–4,000 words 的檔案輸出，還未計讀入、重試、聊天摘要與工具結果。[role count and lints](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/scripts/mece-autopilot-orchestrator.js#L278-L378)、[SWOT and synthesis lints](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/scripts/mece-autopilot-orchestrator.js#L430-L484)
- **[推論]** 這個固定底價在很多決策上高於其預期品質增益。把細節藏在檔案或 `<details>` 只降低呈現負擔，不降低模型生成、讀回、維護與審計成本。

### 6. Ceremony 與 Goodhart 風險已在 repo 內實際出現

- **[事實]** linter 把 minimum word count 與少數 forbidden words 當作每步品質閘門；protocol checker 只搜尋「MECE、衝突、SWOT、收斂、trade-off」等字樣。[per-step linter](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/scripts/mece-autopilot-orchestrator.js#L155-L182)、[protocol regexes](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/scripts/mece-autopilot-check.js#L34-L108)
- **[事實]** repo 自己的 meta-retrospective 記錄過 validator 報 100%，但建議中的清理邏輯實際漏做，稱之為「格式通過、功能漏實作（偽收斂）」。補救最後選擇加強 prompt，而非讓 validator 驗證語義或行為。[meta-retrospective](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/decisions/2026-07-04_mece-autopilot-meta-retrospective.md#L7-L42)
- **[推論]** 當可量測代理指標是字數、必須有衝突、必須有新發現與標題關鍵字，模型會傾向產生足量文字、人工衝突與命名合規，而非更真實的證據。這是典型的 proxy optimization／Goodhart 風險。
- **[建議]** C.A.S.E. 不得驗證「寫了幾輪／幾字／有沒有 SWOT」；應驗證 evidence refs 可解析、候選與 hard constraints 對得上、反例是否會改變推薦、human-required 是否被保留，以及後續實作／測試是否滿足 acceptance criteria。

### 7. 上游與 C.A.S.E. 核心狀態機會直接耦合

- **[事實]** 初始化會在目標 workspace 自動建立 `wiki/`，並在缺少時複製 `CONSTITUTION.md`、`AGENTS.md` 與 skill；流程還要求更新自己的 `decisions/_registry.md`。[bootstrap](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/scripts/mece-autopilot-orchestrator.js#L184-L243)、[synthesis task](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/scripts/mece-autopilot-orchestrator.js#L447-L470)
- **[事實]** 全域安裝器會安裝到多個 agent 的全域位置、覆寫 Aider instructions、建立 PATH wrapper；Windows 安裝器也清理舊目錄與修改 user PATH。[README installer scope](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/README.md#L26-L41)、[PowerShell installer](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/scripts/install.ps1)
- **[事實]** 版本來源不一致：`VERSION.md` 是 3.0.0，skill 顯示 2.1.5，Constitution 是 2.0.0，orchestrator 註記 2.1.0，Claude plugin manifest 是 2.0.2；repo 沒有 tag/release 對應這些版本。[VERSION.md](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/VERSION.md)、[plugin manifest](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/.claude-plugin/plugin.json#L1-L12)
- **[推論]** 直接整合會讓 MECE 的 stage、authority、artifact registry、全域指示與版本語義污染 C.A.S.E. L0/L2，而不是成為一個可替換策略。這也會破壞 C.A.S.E.「單一核心來源、L2 參考實作」的治理邊界。

## 三、四種整合選項比較

| 選項 | 可取之處 | 主要問題 | 與 C.A.S.E. fit | 裁決 |
|---|---|---|---|---|
| **核心 MUST** | 強制每個複雜決策寫出面向、反論與 trade-offs | 把未驗證的啟發式、廣泛 auto-trigger、另一套狀態機、AI 技術決策權與固定 ceremony 變成所有實作者的負擔 | 低；直接違反最低必要負擔，並使 L0 不再小而穩定 | **Reject** |
| **可選 workflow/policy** | 可只保留 decision framing、counterargument、unresolved/human-required；能以 C.A.S.E. artifact 與 CLI 驗證 | 必須大幅改寫；不能稱 upstream-conformant，也不能用上游 regex 當驗證 | 高；可做窄、可替換、可量測的品質升級 | **Recommend** |
| **portable skill** | 易試用、可由人顯式啟用、符合 progressive disclosure 方向 | 上游 frontmatter 使用非標準 `tools` 欄位；主體很長、相對連結以 skill root 解讀時有誤（如 `../reference/...`），且會引導執行外部 CLI／寫入自有拓撲。跨宿主行為未經 conformance 驗證。[Agent Skills fields and path rules](https://agentskills.io/specification#frontmatter) | 中低；只適合作為 experimental UX wrapper，不可承載規範或安全語義 | **Experimental only** |
| **完全獨立 companion** | 零核心耦合；可釘 commit；使用者可自行承擔高成本完整流程 | C.A.S.E. 不會自動取得其少數有用原則，artifact 也不一定互通 | 中高；是完整上游工具最安全的位置 | **Keep upstream here** |

**[推薦推論]** 最佳組合不是四選一，而是：「完整 MECE-Autopilot 保持獨立 companion」＋「C.A.S.E. 另有一個很薄的 optional decision-review policy」。portable skill 若存在，只啟動後者，而且維持 experimental；它不應安裝或呼叫上游 orchestrator。

## 四、最小整合 seam

### 4.1 Seam 的位置

**[建議]** 在 C.A.S.E. core state machine 之外定義一個可選 `decision-review` policy。它只能在某個 work item 尚未進入需人類授權的 transition 前，讀取 snapshot／artifact，產生一份 review artifact；它不能新增 C.A.S.E. state、改寫 owner、接受成果、執行方案或推進核心 transition。

```text
C.A.S.E. work item
    └─ optional policy invocation
         input: decision packet + evidence refs + budget
         output: decision-review artifact
    └─ C.A.S.E. 原狀態機依自己的 authority/acceptance 規則處理
```

### 4.2 最小輸入契約

```yaml
decision_review_request:
  question: string
  candidates: [string]              # 至少兩個實質可行方案
  hard_constraints: [string]
  success_criteria: [string]
  evidence_refs: [artifact-ref]
  risk:
    reversibility: reversible|costly|irreversible
    blast_radius: local|cross-component|external
    safety_or_compliance: boolean
    external_commitment: boolean
  authority:
    human_reserved: [string]
  budget:
    max_passes: 1
    max_counterarguments: 1
    max_output_words: 800
```

### 4.3 最小輸出契約

```yaml
decision_review:
  dimensions: [{name, why_distinct}]
  option_assessment: [{candidate, evidence_for, evidence_against}]
  strongest_counterargument: {claim, evidence_refs, would_change_choice_if}
  recommendation: string|null
  tradeoffs: [string]
  unresolved: [string]
  human_required: [string]
  stop_reason: sufficient_evidence|budget_exhausted|needs_human|insufficient_evidence
  telemetry: {passes, input_tokens?, output_tokens?, elapsed_ms?, artifact_count}
```

**[建議]** `dimensions` 不必承諾哲學上的「collectively exhaustive」；只須聲明本次採用的 coverage model 與已知缺口。`strongest_counterargument` 必須綁 evidence 或明標為 hypothesis。沒有新證據時，不允許用新增 persona 或新增輪次冒充新資訊。

### 4.4 觸發與停止規則

- **顯式觸發**：人類要求 decision review／MECE-style challenge。
- **建議觸發**：至少兩個可行方案，且風險跨過不可逆、高 blast radius、安全合規、外部承諾、重大預算或證據高度不確定其中一項。
- **禁止自動觸發**：單純實作、已決定方案、微小可逆選擇、明確 hotfix、純風格偏好、缺少關鍵人類需求而應先問一個問題的情況。
- **停止**：完成一次方案比較與一次最強反論後即停；只有新 evidence ref 出現才可增加 pass。達預算、需要人類、或證據不足時輸出對應 `stop_reason`，不得靠模擬投票宣告收斂。

### 4.5 與 L0/L2/skill 的分工

- **L0 supported**：只規範 seam 的輸入、輸出、authority 不變量與「policy 不得推進核心狀態」；不規範 MECE、persona、SWOT/TOWS 或輪數。
- **L2 supported reference CLI**：可提供類似 `case review --policy decision-challenge --request <artifact> --json` 的決定性 schema/authority/引用驗證；自然語言內容品質留給 eval，不以 regex 偽裝成語義驗證。
- **單一 portable skill experimental**：只負責判斷是否建議啟用、蒐集最小 request、呼叫 L2、摘要結果；主體保持短，不含另一份憲法或固定角色劇本。
- **L3 later**：未來宿主 adapter 才處理 hooks、背景執行、通知與原生核准；v0.x 不引入上游安裝器或 OS notification。

## 五、反例：何時 MECE 化會降低成果品質

1. **可逆的微小 library 選擇**：查官方相容性、跑一個 spike 即可；3–5 個角色和 SWOT 只增加延遲。
2. **線上事故 hotfix**：MTTR 比完整決策記錄重要；先止血、留 evidence，再於事後 review。
3. **需求本身缺一個關鍵人類偏好**：內部辯論不會創造偏好資料；最省負擔的行為是問一個高資訊量問題。
4. **安全、法規、倫理或外部承諾**：模擬的「資安官／法務」不是授權者；必須取得一手規範與真人批准。
5. **所有角色共享錯誤前提**：同一模型的不同 persona 可能產生語氣差異而非真正獨立證據；增加輪次會放大錯誤。
6. **選項優劣可由測試直接判定**：benchmark、typecheck、schema validator 或實機 probe 的資訊價值高於辯論。
7. **決策已完成、現在是純執行**：重新開啟方案空間會造成 scope drift。
8. **審查 MECE 流程本身**：要求每個 meta-decision 都再跑完整 MECE 容易形成遞迴 ceremony，且 repo 的 100% 合規紀錄已顯示 proxy 容易取代成果。

## 六、驗證與升級方式

**[建議]** 在任何納入 supported surface 之前，先做可否證的對照 eval；不要以「文件更長、角色更多、validator 100%」作成功標準。

### 6.1 三臂對照

- A：C.A.S.E. baseline（不啟用 decision review）。
- B：本文最小 optional `decision-challenge` policy。
- C：釘住 `0dee4fa` 的完整 MECE-Autopilot companion。

任務集應分層包含：微小可逆選擇、架構選擇、跨元件 migration、高風險安全／合規、需求欠缺、hotfix、已有 acceptance tests 的純實作；並含不應觸發的 negative set。

### 6.2 預先註冊的主要指標

- **成果品質**：盲審者依 hard constraints、evidence correctness、遺漏重大風險、可執行性評分；實作任務以測試／驗收結果為主。
- **可驗證性**：可解析 evidence refs 比率、unsupported factual claims、推薦與後續 diff／測試的一致率。
- **人類負擔**：使用者必須做的選擇數、澄清回合數、閱讀分鐘、被錯誤要求批准的次數。
- **運算／流程成本**：input/output tokens、elapsed time、tool calls、產生／修改 artifact 數、重試數。
- **觸發品質**：precision/recall，特別是 negative set 的 false-positive rate。
- **決策穩定性**：新證據加入後的合理翻轉率，以及沒有新證據卻因 persona/wording 改變的漂移率。

### 6.3 升級閘門

- B 必須在高風險／多方案組顯著降低重大遺漏或 unsupported claims，且不在 negative set 顯著增加人類閱讀與 elapsed time。
- 若 B 只讓文件更完整、但測試成功率／盲審品質不升，保持 experimental 或移除。
- C 只有在品質增益明顯高於 B 且額外成本可接受時，才值得推薦為 companion；即使如此，也不因此進入 L0 MUST。
- authority 負例必須全部 fail closed：policy 不得接受工作、不得執行 destructive/external action、不得把 `human_required` 自行改成 resolved。
- conformance 測試應包含：broken evidence refs、關鍵字齊全但內容錯誤、字數充足但無證據、共享錯誤前提、budget exhaustion、使用者中途否決、缺人類偏好的案例。

## 七、最終決策

1. **拒絕**把 MECE-Autopilot 納入 C.A.S.E. 核心 MUST。
2. **保留**完整上游為獨立 companion；若文件提及，明標 heuristic/experimental、釘 commit、列出成本與 authority 限制。
3. **新增但不綁品牌**一個 optional `decision-challenge` workflow/policy，以最小 seam 產生單一 review artifact。
4. **portable skill 仍維持 experimental**，只包裝 C.A.S.E. seam，不攜帶上游 state machine、installer、Constitution、`wiki/` 或 regex validator。
5. **不讓 policy 觸碰 C.A.S.E. 核心狀態轉移**；human authority、acceptance 與安全核准一律由 L0/L2 原契約判定。
6. **先 eval 再升級**；上游的自述、94 次提交、25 份 100%「合規」ADR 或角色投票都不構成方法有效性的證明。

這個裁決保留了 MECE-Autopilot 最有價值的部分——決策框定、反共識、trade-offs、未決事項與 artifact 化——同時排除了它目前最昂貴且最難驗證的部分：廣泛自動觸發、人格戲劇、固定長文、形式型閘門、預設 AI 決策權與第二套核心狀態機。

## 直接來源索引

- 上游快照與歷史：[tree at `0dee4fa`](https://github.com/Chiakai-Chang/MECE-Autopilot/tree/0dee4fab9b86fe1ba318694fe90843177811f9dd)、[commits](https://github.com/Chiakai-Chang/MECE-Autopilot/commits/0dee4fab9b86fe1ba318694fe90843177811f9dd/)
- 上游規範與操作：[README](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/README.md)、[CONSTITUTION.md](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/CONSTITUTION.md)、[SKILL.md](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/skills/mece-autopilot/SKILL.md)
- 上游實作與驗證：[orchestrator](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/scripts/mece-autopilot-orchestrator.js)、[validator](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/scripts/mece-autopilot-check.js)、[CI](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/.github/workflows/mece-autopilot-check.yml)、[installers](https://github.com/Chiakai-Chang/MECE-Autopilot/tree/0dee4fab9b86fe1ba318694fe90843177811f9dd/scripts)
- 上游自我復盤：[orchestrator architecture ADR](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/decisions/2026-07-03_orchestrator-architecture.md)、[false-convergence retrospective](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/decisions/2026-07-04_mece-autopilot-meta-retrospective.md)、[user interaction ADR](https://github.com/Chiakai-Chang/MECE-Autopilot/blob/0dee4fab9b86fe1ba318694fe90843177811f9dd/decisions/2026-07-04_mece-autopilot-user-interaction.md)
- 可攜 skill 格式的必要官方基準：[Agent Skills specification](https://agentskills.io/specification)、[client implementation guide](https://agentskills.io/client-implementation/adding-skills-support)
