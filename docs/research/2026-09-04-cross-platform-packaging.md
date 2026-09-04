# C.A.S.E. Agent Protocol：跨 Codex、Claude Code、Pi 的分層發布研究

日期：2026-09-04
範圍：唯讀研究；只採 OpenAI、Anthropic、Pi、Agent Skills、MCP 的官方文件、規格與官方原始碼／儲存庫。

## 結論摘要

建議不要在「純協議文件／Agent Skills／CLI+skills／plugin 或 extension」四者中只選一個，而應採四層、單一核心來源的發布模型：

1. **L0：純協議文件（規範核心）**：定義 C.A.S.E. 的術語、狀態機、不變量、輸入輸出契約、錯誤語義與安全要求。它是所有實作與測試的唯一規範來源，但不假設任何宿主會自動發現它。
2. **L1：可攜 Agent Skills（操作手冊）**：以標準 `SKILL.md` 封裝「何時使用 C.A.S.E.、如何執行、如何驗證」；只用 Agent Skills 的共同欄位，將長參考資料與測試夾具延遲載入。
3. **L2：CLI + skills（可驗證參考實作）**：提供決定性的 `case` CLI，負責驗證、轉換、探測、版本檢查與機器可讀輸出；skill 僅負責編排 CLI，不重新實作協議邏輯。
4. **L3：宿主套件（安裝與特權整合）**：分別提供 Codex plugin、Claude Code plugin、Pi package。它們薄薄地包裝同一批 skills 與 CLI，另放宿主專屬 hooks、設定、擴充與 MCP 接線。此層不可被宣稱為跨宿主可攜。

換句話說：**協議文件是權威；skills 是跨宿主教學介面；CLI 是可重現的執行與驗證核心；plugin/extension 是宿主專屬的安裝、安全與生命週期轉接器。**

## 研究方法與證據標記

- **已證實事實**：下列敘述可由緊鄰的第一手來源直接支持。
- **設計推論**：由一個或多個已證實事實推導出的 C.A.S.E. 發布建議；不是上游產品承諾。
- 官方文件會演進；本文記錄的是 2026-09-04 可取得的行為。對會影響相容性的功能，發布流程仍須執行實機探測與回歸測試。

## 一、平台事實比較

| 面向 | Codex | Claude Code | Pi |
|---|---|---|---|
| 專案指示發現 | `AGENTS.md`/`AGENTS.override.md` 自全域、專案根到 cwd 串接；較近者在後，預設合併上限 32 KiB。[官方文件](https://learn.chatgpt.com/docs/agent-configuration/agents-md) | 原生讀取 `CLAUDE.md` 或 `.claude/CLAUDE.md`；不原生讀 `AGENTS.md`，官方建議由 `CLAUDE.md` 以 `@AGENTS.md` 匯入。[官方文件](https://code.claude.com/docs/en/memory) | 讀取全域及祖先／目前目錄的 `AGENTS.md` 或 `CLAUDE.md`；同目錄 `AGENTS.override.md` 優先，匹配內容串接。[官方儲存庫](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md#context-files) |
| Skills 發現與載入 | Skills 建立於 Agent Skills 開放格式；先提供名稱、描述與路徑，觸發後才載完整 `SKILL.md`。App server 可列舉、強制重載並監看變更。[官方原始碼說明](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#skills) | Skills 使用 `SKILL.md` 並遵循 Agent Skills 開放標準，但另有 Claude 專屬 frontmatter、呼叫控制、子代理與動態內容。[官方文件](https://code.claude.com/docs/en/slash-commands) | 遞迴掃描 `~/.pi/agent/skills`、`~/.agents/skills`、專案 `.pi/skills` 與祖先／專案 `.agents/skills`；可設定加入 Claude/Codex skill 路徑。[官方文件](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md) |
| 安裝單位 | Plugin 是可安裝單位，可含 skills、MCP 設定、app mapping、hooks；manifest 為 `.codex-plugin/plugin.json`。[官方文件](https://learn.chatgpt.com/docs/build-plugins) | Plugin 可封裝 commands、agents、skills、hooks、MCP 與設定；專案設定與 hooks 另可放 `.claude/settings.json`。[官方設定文件](https://code.claude.com/docs/en/settings) | Pi package 可含 extensions、skills、prompts、themes；來源可為 npm、git 或本機路徑，專案套件在信任後可啟動時安裝。[官方文件](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md) |
| 可執行擴充 | Hooks 可在生命週期執行命令或 MCP 工具；未受管理的 hooks 要先審查並信任，專案 hooks 只在專案 `.codex/` 受信任時載入。[官方文件](https://learn.chatgpt.com/docs/hooks) | Hooks 執行 shell 命令；`PreToolUse` 可在權限判定前阻擋，但不能凌駕 deny/ask 規則。[Hooks](https://code.claude.com/docs/en/hooks-guide)、[Permissions](https://code.claude.com/docs/en/permissions) | Extensions 是可執行 JS/TS；package 與 extension 具有完整系統存取能力。[官方文件](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md#install-and-manage) |
| 權限與安全 | OS sandbox 與 approval policy 是兩層控制；預設本機網路關閉、寫入通常限 workspace。[官方文件](https://learn.chatgpt.com/docs/agent-approvals-security) | 權限規則可 allow/ask/deny；hooks 參與但不取代權限政策。[官方文件](https://code.claude.com/docs/en/permissions) | 核心沒有內建權限彈窗；官方建議容器或自訂 extension 確認流程。Project trust 是載入專案資源的信任閘門，不是 sandbox。[官方 README](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md#what-pi-doesnt-have) |
| 升級 | Plugin/skill 是可重用發布單位；skill 列表可重載、檔案變更可發 invalidation。[官方 app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#skills) | Native installer 可自動更新，亦可 `claude update`；套件管理器安裝預設不自動更新；有 `latest`/`stable` channel。[官方安裝文件](https://code.claude.com/docs/en/setup) | `pi update` 可更新 Pi 與套件；git ref 可釘選；installer 更新會 staging、驗證、lockfile，失敗保留現版。[官方套件文件](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md) |
| 可觀測／驗證 | `skills/list`、`forceReload`、`skills/changed` 可確認發現結果；非互動模式可用於 scripts/CI。[App server](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#skills)、[非互動模式](https://learn.chatgpt.com/docs/non-interactive-mode) | `/context` 顯示已載入 memory；hooks 與權限規則可針對行為測試。[Memory](https://code.claude.com/docs/en/memory) | 啟動畫面列出已載 `AGENTS.md`；`/reload` 重載並顯示無效 skill／衝突警告；`/session` 顯示 token/cost。[官方文件](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md) |

## 二、Agent Skills 與 MCP 的共同邊界

### Agent Skills：適合攜帶程序知識，不適合承諾統一執行權限

**已證實事實。** Agent Skills 規格要求 skill 目錄至少包含帶 YAML frontmatter 的 `SKILL.md`；共同必填欄位只有 `name` 與 `description`，並可帶 `scripts/`、`references/`、`assets/`。`allowed-tools` 仍屬實驗性，實作支援可能不同。[Agent Skills 規格](https://agentskills.io/specification)

**已證實事實。** 標準採三階段漸進揭露：啟動時載入名稱與描述（約 50–100 tokens/skill）、啟用時載入完整指示（建議少於 5,000 tokens）、資源按需載入；專案共同位置建議為 `.agents/skills/`。[Client implementation guide](https://agentskills.io/client-implementation/adding-skills-support)

**設計推論。** C.A.S.E. 的 portable skill 應只依賴 `name`、`description` 與 Markdown body；若需要宣告依賴，使用 `compatibility` 作人類／模型提示，但不能把它當成執行期能力協商。`allowed-tools` 不應成為安全保證。宿主專屬 metadata 應放 adapter 或由 build 產出，不污染 canonical skill。

### MCP：適合標準化工具連線，不是 C.A.S.E. 文件／skill 的替代品

**已證實事實。** MCP 以 host-client-server 分工；host 管理連線、同意與安全政策，每個 client 對一個 server，server 公開 tools/resources/prompts。[MCP architecture](https://modelcontextprotocol.io/specification/2025-06-18/architecture)

**已證實事實。** 初始化會協商 protocol version 與 capabilities；雙方只能使用已協商能力。這提供比「看見一個檔案」更明確的版本／能力握手。[MCP lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)

**已證實事實。** Tool 有輸入 JSON Schema 與可選輸出 Schema；但 annotations 從不受信任 server 而來時必須視為不可信。[MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

**已證實事實。** MCP roots 只描述 server 可被告知的工作範圍；client 仍須做權限、URI 與 traversal 驗證，server 應尊重 root 邊界。[MCP roots](https://modelcontextprotocol.io/specification/2024-11-05/client/roots)

**設計推論。** 若 C.A.S.E. CLI 需被遠端或 GUI client 呼叫，可另提供 MCP server adapter，以 capability/version handshake 與 JSON Schema 提升互通及可驗證性。但真正隔離仍由 host sandbox、OS 與認證控制；不能以 tool annotation、roots 或「已安裝 plugin」代替強制安全邊界。

## 三、建議的四層發布架構

### L0 — `case-protocol`：純協議文件

應包含：

- 版本化規範（建議 SemVer + 每版不可變 tag）。
- 規範語言：MUST/SHOULD/MAY、資料模型、狀態轉移、錯誤碼、相容性規則。
- JSON Schema／測試向量與威脅模型。
- 宿主中立的 conformance requirements；不得寫「Codex/Claude/Pi 會自動遵循」這類未受驗證承諾。

**推論理由。** 三個宿主的 project instruction 發現方式不同，而且 always-on 指示會占 context。協議若只藏於某宿主指示檔，既不通用也難由非代理工具驗證。L0 應可單獨被人、CI 與 CLI 審閱。

### L1 — `case-skills`：標準 Agent Skills

建議結構：

```text
skills/
  case-apply/
    SKILL.md
    references/          # 指向／摘述特定 protocol version
    scripts/             # 僅薄 wrapper；核心行為呼叫 case CLI
  case-review/
    SKILL.md
```

發布規則：

- Canonical skills 保持 Agent Skills 最小共同子集。
- `description` 明確包含觸發情境；主體保持短小，把詳細規格移到 `references/`。
- skill metadata 明示相容的 protocol 與 CLI version range；啟動時由 CLI 實際檢查。
- `.agents/skills/` 可作 repo-local 的共同安裝位置；對不直接掃描該位置的 client，由其 package/plugin adapter 映射或複製。
- Claude 專屬 frontmatter、Codex `agents/openai.yaml`、Pi 專屬內容視為衍生檔；必須能由同一版本的 canonical metadata 生成或被一致性測試檢查。

### L2 — `case-cli`：決定性參考實作

至少提供：

```text
case version --json
case capabilities --json
case validate <artifact> --format json
case doctor --host codex|claude|pi --json
case conformance --suite <version> --json
```

**設計推論。** 自然語言 skill 適合選擇與編排，但不適合單獨承擔 schema 驗證、版本比較或 byte-for-byte 輸出。CLI 將相同邏輯放在三宿主之外，讓 CI、使用者與 agent 得到相同結果；JSON 輸出又能被 hooks、extensions、MCP 與測試共同消費。

安全規則：預設唯讀、無網路、顯式輸出目標；變更型命令支援 `--dry-run`；不在 CLI 中繞過宿主核准；外部內容視為不可信；所有 plugin/extension 只授予完成該命令所需的最低能力。

### L3 — 三個薄型宿主套件

#### Codex plugin

- `.codex-plugin/plugin.json` 發布同一批 skills，可選擇接入 MCP 與 hooks。
- `AGENTS.md` 只保留 C.A.S.E. 的 repo-wide 最小規則與「何時載 skill」提示。
- hooks 只做可機器判定的 guard/telemetry/validation，並接受未受管理 hook 的信任流程與 sandbox/approval 約束。

#### Claude Code plugin

- 提供極小 `CLAUDE.md` shim：`@AGENTS.md`，避免維護第二份核心指示。
- plugin 封裝 canonical skills；Claude-only invocation/subagent metadata 作 adapter。
- `.claude/settings.json` 可帶 team hooks/permissions/plugin 設定，但不能讓 hook 蓋過 deny/ask 政策。

#### Pi package

- package manifest 指向相同 skills 與薄 extension；版本釘選到 release tag／npm exact version。
- 若只需 skills，優先零 extension 套件；因 extension/package 具有完整系統權限。
- 信任提示必須清楚說明：信任 project package 是允許載入，不代表執行被 sandbox。

## 四、為何不採單一路徑

| 單一路徑 | 優點 | 無法單獨滿足的問題 |
|---|---|---|
| 純協議文件 | 最可審閱、長期穩定、宿主中立 | 不會可靠地被每個 agent 自動發現／按需執行；缺安裝與可執行驗證 |
| 只有 Agent Skills | 最接近跨宿主可攜，context 成本可控 | 實驗／私有 metadata、腳本 runtime 與權限語義不一致；自然語言本身不構成 conformance engine |
| 只有 CLI + skills | 行為可重現、CI 可測 | 缺少宿主原生安裝、信任、hook、MCP 與更新 UX |
| 只有 plugin/extension | 安裝體驗與宿主整合最好 | 三套格式與安全模型造成鎖定；Pi extension 特權尤其不能等同 Codex/Claude 的權限模型 |

## 五、安全與權限設計

1. **Skill 是提示，不是 sandbox。** 任何 `allowed-tools`、compatibility 或 MCP annotation 都不得被當成強制隔離證明。
2. **可執行層須明示。** 發布物清單要把純文字、腳本、hooks、extensions、MCP servers 分類，列出網路、檔案、process、credential 需求。
3. **最小權限且預設唯讀。** Codex 依賴 sandbox + approval；Claude 依賴 allow/ask/deny 並讓 hooks 加強而不凌駕；Pi 應以容器或明示確認 extension 補足核心沒有彈窗的差距。
4. **遠端 MCP 做標準認證。** HTTP transport 使用當版 MCP authorization/OAuth 要求並驗證 token audience；stdio credential 依環境注入。[MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
5. **不信任 repo 與外部內容。** 啟用 project hooks/extensions 前保留宿主 trust gate；CLI 驗證器不得執行待驗 artifact 內任意程式。

## 六、版本與升級策略

建議維護彼此獨立但可宣告相容範圍的版本：

- `protocolVersion`：只描述 C.A.S.E. 語義；breaking change 升 major。
- `skillVersion`：描述工作流程／提示的版本，metadata 宣告支援的 protocol range。
- `cliVersion`：實作版本；`capabilities --json` 回傳支援的 protocol range 與 feature flags。
- `adapterVersion`：Codex/Claude/Pi 各自版本，鎖定已測試宿主範圍與內含 skill/CLI checksum。

發布順序：L0 規格與 conformance vectors → L2 CLI → L1 skills → L3 adapters。每層產生 SBOM/checksum 或至少檔案 manifest；adapter 不應悄悄浮動到未測試的 CLI/skill。Pi git ref、套件 lockfile 與 Claude update channel 的存在說明宿主升級節奏本就不同，因此「所有層同一版本號」會掩蓋實際相容性。

## 七、Context 成本控制

**已證實事實。** Agent Skills 只在 startup 放 catalog，完整內容按需載入；規格估約 50–100 tokens/skill，建議 `SKILL.md` 小於 5,000 tokens。[官方實作指南](https://agentskills.io/client-implementation/adding-skills-support)

**已證實事實。** Codex 的 skill catalog 有 context budget；超過時會截斷／選取，完整 body 僅觸發後載入。[官方 skills 文件](https://learn.chatgpt.com/docs/build-skills)

**已證實事實。** Claude 的 `CLAUDE.md` 進入 session context；官方建議保持在約 200 行以內，並以 rules/skills 降低 always-on 負擔。[Memory](https://code.claude.com/docs/en/memory)、[Costs](https://code.claude.com/docs/en/costs)

**設計推論。** `AGENTS.md`/`CLAUDE.md` 只放不可缺的 1–2 頁契約、禁止事項與 skill routing；流程細節進 L1；完整規格進 L0；大型範例按需讀取。避免為每個細微動作做一個 skill，因 catalog 仍有線性成本與碰撞風險。

## 八、可驗證性與發行閘門

每一版至少執行：

1. **靜態驗證**：Agent Skills `skills-ref validate`；JSON Schema；manifest schema；無 broken relative links；宿主衍生 metadata 與 canonical metadata 一致。[Agent Skills 規格](https://agentskills.io/specification)
2. **CLI conformance**：固定測試向量、golden JSON、錯誤碼、dry-run 不改檔、離線測試。
3. **Discovery smoke test**：Codex `skills/list(forceReload)`；Claude `/context` 加明確 skill invocation；Pi 啟動／`/reload`，確認沒有 invalid skill 或 collision warning。
4. **權限測試**：讀、寫、網路、process、credential 各做允許與拒絕案例；特別驗證 hooks/extensions 不能意外擴權。
5. **升級／降級測試**：舊 adapter + 新 CLI、反向組合、釘選版本、失敗回滾；不支援組合必須 fail closed 並給出機器可讀診斷。
6. **端到端語義測試**：三宿主執行相同 scenario，對「協議不變量」做判定，而非要求自然語言逐字一致。

## 九、建議決策

採用 **Protocol + portable Skills + reference CLI + thin host adapters**，並把下列邊界寫進治理規範：

- L0 是規範權威，L2 是參考實作；L1/L3 不得另創協議語義。
- 共享 skill 僅使用 Agent Skills 共同子集；宿主特性由 adapter 表達。
- 只在需要生命週期攔截、原生安裝、MCP 或 UI 時才升級到 plugin/extension。
- Pi 的可執行 package 預設視為高權限；Codex/Claude 的 hook 也須接受各自的 trust/permission 流程。
- 所有發布物都要能回答：載入了哪一版、有哪些能力、將讀寫何處、是否用網路、如何驗證、如何回退。

此架構讓「可攜性」停留在真正共同的文件與 Agent Skills 層，讓「可執行性」集中於可測試 CLI，並把不可避免的宿主差異隔離在薄 adapter；比要求三個 agent 對同一套 plugin/extension 語義做出一致承諾更符合目前的一手資料。

## 主要第一手來源索引

- OpenAI Codex：[AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)、[Build skills](https://learn.chatgpt.com/docs/build-skills)、[Build plugins](https://learn.chatgpt.com/docs/build-plugins)、[Hooks](https://learn.chatgpt.com/docs/hooks)、[Approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security)、[App-server skills source](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#skills)
- Anthropic Claude Code：[Memory](https://code.claude.com/docs/en/memory)、[Skills](https://code.claude.com/docs/en/slash-commands)、[Settings](https://code.claude.com/docs/en/settings)、[Hooks](https://code.claude.com/docs/en/hooks-guide)、[Permissions](https://code.claude.com/docs/en/permissions)、[Setup/update](https://code.claude.com/docs/en/setup)
- Pi：[Coding agent README](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md)、[Skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)、[Packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)
- Agent Skills：[Specification](https://agentskills.io/specification)、[Client implementation](https://agentskills.io/client-implementation/adding-skills-support)
- MCP：[Architecture](https://modelcontextprotocol.io/specification/2025-06-18/architecture)、[Lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)、[Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)、[Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)、[Roots](https://modelcontextprotocol.io/specification/2024-11-05/client/roots)
