# C.A.S.E. Framework

讓人與 AI 在有限 context 下，透過可追溯的工作卷宗交接、檢查證據與驗收成果。目標是在減輕認知與抉擇負擔的同時提升品質。

**目前階段：M0 研究原型。核心協定與受控測試已完成，尚未提供可供日常工作使用的 production adapter。** Windows 的初始化會回傳 `CASE_E_UNSUPPORTED_PROFILE`；Linux/macOS 尚未驗證。Codex、Claude Code、Pi 共用協定是設計方向，目前沒有可安裝的宿主整合或自動協作功能。

The M0 research prototype is implemented and tested under controlled capabilities. Production dossier workflows and host integrations are not yet supported.

- 第一次來：[文件地圖](MAP.md)，依目的選擇閱讀路徑。
- 想知道完成了嗎、能用嗎：[目前狀態與路線](docs/STATUS.md)。
- 想參與開發：[貢獻與驗證指引](CONTRIBUTING.md)。
- 想了解這一輪的取捨：[M0 復盤](docs/evaluation/m0-retrospective.md)。

這些是本框架原始碼倉庫的導覽檔案；未來在使用者專案執行 `init` 時，只能建立 `.case-agent/` 命名空間，不會散落或覆寫 README、MAP、AGENTS 等通用檔案。

## Local dossier integrity preview

This repository contains the private `0.1.0-preview` reference implementation for one deliberately narrow experiment: can a file-native dossier protocol catch stale handoffs, competing writers, changed evidence, and stale recorded acceptance more explicitly than Markdown plus Git?

It is not a general reliability claim, a multi-agent runtime, or a supported cross-platform release. The package remains private and no public license or npm publication is selected.

## Current support boundary

The frozen protocol corpus exercises a deterministic `controlled-test` adapter. That proves protocol and oracle behavior under injected capabilities; it is not a production filesystem profile.

- Production Windows mutation is unsupported and fails closed with `CASE_E_UNSUPPORTED_PROFILE` (exit 10).
- No production POSIX filesystem profile is claimed.
- Network shares, cloud-sync folders, separate clones, multi-machine coordination, non-conforming writers, and physical power loss are outside M0 guarantees.

Until a real platform adapter passes the same corpus, this preview is for inspection, conformance development, and evaluation—not production dossier mutation.

## Build and inspect a local package artifact

Use Node.js 24 and the lockfile:

```powershell
npm ci
npm run build
node dist/src/cli/main.js --help
```

以上可在此 repository 內查看 CLI 說明，不需要全域安裝，也不代表初始化已受支援。維護者完整驗證使用 `npm run check`，在目前量測的 Windows 環境約需 9–10 分鐘。只有 Node 24.19.0 已量測；其他 Node 24 版本仍須通過能力檢查。

For local package inspection, build first and run `npm pack --dry-run`. The package allowlist contains the compiled runtime under `dist/src`, bundled schemas, this README, and npm package metadata. It excludes tests, evaluation records, caches, secrets, and repository-local `.case-agent/` dossiers. Repository documentation linked above is available in the source checkout, not bundled in the tarball.

Uninstalling the CLI does not remove `.case-agent/` data.

## Command surface

Human mode is the default. `--json` selects one newline-terminated result envelope on stdout; machine consumers branch on `code` and process exit status, not localized message text.

```text
case-agent init --operation <id>
case-agent dossier create --operation <id> --actor <label> --title <text> --objective <text> --brief <json>
case-agent dossier show --dossier <id>
case-agent dossier check --dossier <id>
case-agent evidence add --dossier <id> --operation <id> --run <id> --evidence <json>
case-agent submission create --dossier <id> --operation <id> --run <id>
case-agent decision accept --dossier <id> --operation <id> --submission <id> --submission-digest <digest> --reviewer <label> --criteria <json-array> --comment <text>
case-agent decision reject --dossier <id> --operation <id> --submission <id> --submission-digest <digest> --reviewer <label> --criteria <json-array> --comment <text>
case-agent handoff offer --dossier <id> --operation <id> --from-run <id> --to-actor <label>
case-agent handoff accept --dossier <id> --operation <id> --handoff <id> --offered-content-digest <digest> --actor <label>
case-agent guard recover --dossier <id> --operation <id>
```

Every existing-dossier mutation needs an operation ID and an exact revision/state-digest basis. In `--json` mode, provide both:

```text
--expected-revision <decimal-string> --expected-state-digest sha256:<64-lowercase-hex>
```

Human mode may omit those two values only when the same invocation displays the complete basis and receives confirmation. An intervening mutation returns a conflict; the command does not silently bind intent to newer state.

`dossier create --brief` accepts a closed, number-free JSON object containing `scope`, `constraints`, and at least one acceptance criterion. `evidence add --evidence` accepts a closed tagged JSON object. Consult the bundled schemas and `case-agent --help`; no network fetch is required.

## Offline and data footprint

Core commands have no network calls, telemetry, update checks, host discovery, hooks, or global host-configuration writes. Schemas and human help are bundled. Initialization changes bytes only under the owning repository's `.case-agent/` namespace.

The dossier can contain sensitive repository information. Evidence registration stores references, metadata, and digests by default; it does not copy the referenced artifact bytes. This preview does not detect every secret, provide privacy certification, or protect files from other local processes.

## What checks and decisions mean

Passing checks means only that declared machine-checkable invariants currently hold. It does not establish usefulness, factual correctness, code quality, or human approval.

The CLI calls acceptance **Recorded Human Acceptance**. It records an interactive reviewer label and exact submission digest, but does not authenticate identity, sign data, attest authorship, or provide non-repudiation. A program controlling the terminal can impersonate a reviewer. There is no `--yes` or non-interactive decision path.

## Recovery, audit, and sandbox limits

Writer recovery is explicit and interactive. It stops with `CASE_E_RECOVERY_REQUIRED` unless the platform adapter can establish that the recorded process has terminated. The preview does not claim that renaming a lock revokes a live process, or that multi-file publication survives physical power loss.

Immutable envelopes and current snapshot links improve inspectability, but M0 is not a tamper-proof or complete audit log. It provides no sandbox, supply-chain verification, authenticated identity, automatic retention, purge, archive, or protection from direct local edits. Independent review remains part of the release gate.

## Verification

```powershell
npm run typecheck
npm test
npm run conformance
npm run check
npm pack --dry-run
```

The B0/M0 comparison protocol is preregistered under `evaluation/markdown-baseline/`. Invalid, failed, partial, and timed-out results are retained; controlled-test success is never substituted for a production-platform result.
