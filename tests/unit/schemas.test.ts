import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { SchemaRegistry, type SchemaKind } from "../../src/protocol/schema-registry.js";

const schemaDirectory = resolve("schemas");
const sha256 = `sha256:${"0".repeat(64)}`;
const timestamp = "2026-09-04T03:02:01Z";

const validDossier = {
  dossier_id: "dossier-1",
  title: "Ship the trust boundary",
  objective: "Reject ambiguous state",
  scope: { in: ["protocol"], out: ["network"] },
  constraints: ["offline"],
  acceptance_criteria: [
    { criterion_id: "criterion-1", statement: "State validates", verification: "mechanical" },
  ],
  state_revision: "0",
  state_digest: sha256,
  last_operation: null,
  active_run: { run_id: "run-1", actor_id: "actor-1", started_by_handoff_id: null },
  evidence: [
    {
      evidence_id: "evidence-file",
      criterion_ids: ["criterion-1"],
      kind: "file",
      location: { repository_relative_path: "src/index.ts" },
      captured_at: timestamp,
      artifact_digest: sha256,
      artifact_size: "42",
      freshness: "recompute_on_check",
      limitations: [],
    },
    {
      evidence_id: "evidence-external",
      criterion_ids: ["criterion-1"],
      kind: "external_reference",
      location: { uri: "https://example.invalid/evidence" },
      captured_at: timestamp,
      freshness: "human_review",
      limitations: ["not mechanically observed"],
    },
  ],
  current_handoff_id: null,
  current_submission_id: null,
  current_decision_id: null,
};

const validByKind: Record<SchemaKind, unknown> = {
  manifest: {
    protocol: "case-agent",
    protocol_version: "0.1.0-preview",
    schema_dialect: "https://json-schema.org/draft/2020-12/schema",
    repository_id: "repository-1",
    created_at: timestamp,
  },
  dossier: validDossier,
  handoff: {
    handoff_id: "handoff-1",
    dossier_id: "dossier-1",
    from_run_id: "run-1",
    to_actor_id: "actor-2",
    basis_revision: "0",
    basis_state_digest: sha256,
    published_revision: "1",
    offered_content_digest: sha256,
    created_operation_id: "operation-1",
  },
  submission: {
    submission_id: "submission-1",
    dossier_id: "dossier-1",
    submitting_run_id: "run-1",
    basis_revision: "0",
    basis_state_digest: sha256,
    published_revision: "1",
    content_digest: sha256,
    observed_evidence_digest: sha256,
    checks_digest: sha256,
    created_at: timestamp,
    created_operation_id: "operation-1",
    submission_digest: sha256,
  },
  decision: {
    decision_id: "decision-1",
    dossier_id: "dossier-1",
    submission_id: "submission-1",
    submission_digest: sha256,
    decision: "accepted",
    reviewer_id: "reviewer-1",
    criteria_reviewed: ["criterion-1"],
    comment: "Reviewed interactively",
    decided_at: timestamp,
    created_operation_id: "operation-2",
    identity_assurance: "recorded-interactive-claim",
  },
  result: {
    ok: true,
    command: "dossier.show",
    code: "CASE_OK",
    message: "Current dossier",
    data: { dossier_id: "dossier-1" },
    remediation: null,
  },
  "observed-evidence": {
    dossier_id: "dossier-1",
    content_digest: sha256,
    evidence_results: [
      {
        evidence_id: "evidence-file",
        status: "current",
        observed_artifact_digest: sha256,
        observed_artifact_size: "42",
        stable_limitation_codes: [],
      },
    ],
  },
  checks: {
    dossier_id: "dossier-1",
    content_digest: sha256,
    observed_evidence_digest: sha256,
    invariant_results: [{ code: "CASE_I_STATE", status: "passed" }],
    criterion_results: [
      {
        criterion_id: "criterion-1",
        status: "mechanically_satisfied",
        supporting_evidence_ids: ["evidence-file"],
      },
    ],
    stable_warning_codes: [],
    verdict: "passed",
  },
};

test("all bundled roots compile offline as Draft 2020-12", async () => {
  const registry = await SchemaRegistry.load(schemaDirectory);
  const kinds: SchemaKind[] = [
    "manifest",
    "dossier",
    "handoff",
    "submission",
    "decision",
    "result",
    "observed-evidence",
    "checks",
  ];
  for (const kind of kinds) {
    assert.equal(registry.has(kind), true);
    assert.deepEqual(registry.validate(kind, validByKind[kind]), { ok: true });
  }
});

test("dossier rejects unknown top-level and nested properties", async () => {
  const registry = await SchemaRegistry.load(schemaDirectory);
  assert.deepEqual(registry.validate("dossier", { ...validDossier, surprise: true }), {
    ok: false,
    code: "CASE_E_SCHEMA",
  });
  assert.deepEqual(
    registry.validate("dossier", {
      ...validDossier,
      active_run: { ...validDossier.active_run, surprise: true },
    }),
    { ok: false, code: "CASE_E_SCHEMA" },
  );
  assert.deepEqual(
    registry.validate("dossier", {
      ...validDossier,
      evidence: [{ ...validDossier.evidence[1], artifact_size: "1" }],
    }),
    { ok: false, code: "CASE_E_SCHEMA" },
  );
});

test("schemas reject non-canonical decimal strings and digests", async () => {
  const registry = await SchemaRegistry.load(schemaDirectory);
  for (const state_revision of ["01", "-1", "1.0"]) {
    assert.deepEqual(registry.validate("dossier", { ...validDossier, state_revision }), {
      ok: false,
      code: "CASE_E_SCHEMA",
    });
  }
  assert.deepEqual(registry.validate("dossier", { ...validDossier, state_digest: `sha256:${"A".repeat(64)}` }), {
    ok: false,
    code: "CASE_E_SCHEMA",
  });
});

test("timestamp fields require real RFC 3339 UTC instants", async () => {
  const registry = await SchemaRegistry.load(schemaDirectory);
  for (const created_at of ["2025-02-29T00:00:00Z", "2026-09-04T03:02:01+00:00", "2026-13-01T00:00:00Z"]) {
    assert.deepEqual(registry.validate("manifest", { ...validByKind.manifest as object, created_at }), {
      ok: false,
      code: "CASE_E_SCHEMA",
    });
  }
  assert.deepEqual(
    registry.validate("manifest", { ...validByKind.manifest as object, created_at: "2024-02-29T23:59:59.123Z" }),
    { ok: true },
  );
});

test("manifest reports an unsupported protocol version without leaking validator diagnostics", async () => {
  const registry = await SchemaRegistry.load(schemaDirectory);
  assert.deepEqual(
    registry.validate("manifest", { ...validByKind.manifest as object, protocol_version: "1.0.0" }),
    { ok: false, code: "CASE_E_UNSUPPORTED_VERSION" },
  );
});

test("manifest rejects required fields inherited through its prototype", async () => {
  const registry = await SchemaRegistry.load(schemaDirectory);
  const manifest = validByKind.manifest as Record<string, unknown>;
  for (const field of ["protocol", "protocol_version", "schema_dialect", "repository_id", "created_at"]) {
    const inherited = Object.create({ [field]: manifest[field] }) as Record<string, unknown>;
    for (const [key, value] of Object.entries(manifest)) {
      if (key !== field) inherited[key] = value;
    }
    assert.deepEqual(registry.validate("manifest", inherited), { ok: false, code: "CASE_E_SCHEMA" });
  }
});

test("an inherited version cannot alter unsupported-version classification", async () => {
  const registry = await SchemaRegistry.load(schemaDirectory);
  const inheritedVersion = Object.create({ protocol_version: "1.0.0" }) as Record<string, unknown>;
  Object.assign(inheritedVersion, {
    protocol: "case-agent",
    schema_dialect: "https://json-schema.org/draft/2020-12/schema",
    repository_id: "repository-1",
    created_at: timestamp,
  });
  assert.deepEqual(registry.validate("manifest", inheritedVersion), { ok: false, code: "CASE_E_SCHEMA" });
});

test("result schema enforces coherent success and failure branches", async () => {
  const registry = await SchemaRegistry.load(schemaDirectory);
  assert.deepEqual(
    registry.validate("result", {
      ok: false,
      command: "dossier.show",
      code: "CASE_E_SCHEMA",
      message: "Invalid state",
      data: null,
      remediation: "Repair the dossier.",
    }),
    { ok: true },
  );
  assert.deepEqual(registry.validate("result", { ...validByKind.result as object, code: "CASE_E_SCHEMA" }), {
    ok: false,
    code: "CASE_E_SCHEMA",
  });
});
