# M0 integrity research CLI (historical reference)

This is the earlier M0 integrity CLI, not the current workflow kit. Its production profile remains unsupported. Start with [the workflow kit](../workflow-kit/README.md) for practical use. Commands below apply to the repository root M0 package only.

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
