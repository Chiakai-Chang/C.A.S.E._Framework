import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  nodePathInspection,
  discoverRepositoryRoot,
  resolveEvidencePath,
  type PathInspectionPort,
} from "../../src/storage/paths.js";
import { CaseStore } from "../../src/storage/store.js";
import { SchemaRegistry } from "../../src/protocol/schema-registry.js";

async function createTree(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "case-agent-paths-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "artifacts"));
  await writeFile(join(root, "artifacts", "Evidence.txt"), "proof");
  return root;
}

const unsafePaths = [
  "",
  "/abs",
  "C:/abs",
  "//server/share",
  "\\\\server\\share",
  "a\\b",
  "a//b",
  "a/./b",
  "a/../b",
  "a/\0/b",
] as const;

for (const unsafePath of unsafePaths) {
  test(`rejects unsafe lexical path ${JSON.stringify(unsafePath)} before filesystem access`, async () => {
    let calls = 0;
    const untouched = new Proxy({} as PathInspectionPort, {
      get() {
        calls += 1;
        throw new Error("filesystem must remain untouched");
      },
    });

    await assert.rejects(resolveEvidencePath("unused-root", unsafePath, untouched), /CASE_E_EVIDENCE/);
    assert.equal(calls, 0);
  });
}

test("opens a regular file and returns its exact repository-relative spelling", async (t) => {
  const root = await createTree(t);
  const evidence = await resolveEvidencePath(root, "artifacts/Evidence.txt");
  t.after(async () => evidence.handle.close());

  assert.equal(evidence.repository_relative_path, "artifacts/Evidence.txt");
  assert.equal(Buffer.from(await evidence.handle.readAll()).toString("utf8"), "proof");
});

test("rejects a case-insensitive filesystem alias", async (t) => {
  const root = await createTree(t);
  await assert.rejects(
    resolveEvidencePath(root, "artifacts/evidence.txt"),
    /CASE_E_EVIDENCE/,
  );
});

test("rejects a directory as final evidence", async (t) => {
  const root = await createTree(t);
  await assert.rejects(resolveEvidencePath(root, "artifacts"), /CASE_E_EVIDENCE/);
});

test("rejects evidence reached through a junction", async (t) => {
  const root = await createTree(t);
  const outside = await mkdtemp(join(tmpdir(), "case-agent-outside-"));
  t.after(async () => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, "evidence.txt"), "outside");
  await symlink(outside, join(root, "alias"), "junction");

  await assert.rejects(resolveEvidencePath(root, "alias/evidence.txt"), /CASE_E_EVIDENCE/);
});

test("rejects a root that is itself a junction", async (t) => {
  const root = await createTree(t);
  const alias = `${root}-alias`;
  t.after(async () => rm(alias, { recursive: true, force: true }));
  await symlink(root, alias, "junction");

  await assert.rejects(resolveEvidencePath(alias, "artifacts/Evidence.txt", nodePathInspection), /CASE_E_EVIDENCE/);
});

test("repository discovery rejects arbitrary foreign .git bytes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "case-agent-foreign-git-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git", "objects"), { recursive: true });
  await mkdir(join(root, ".git", "refs"), { recursive: true });
  await writeFile(join(root, ".git", "HEAD"), "this is not a git head\n");
  await writeFile(join(root, ".git", "config"), "[core]\n\tbare = false\n");

  await assert.rejects(discoverRepositoryRoot(root), /CASE_E_NOT_INITIALIZED/);
});

const dossier = {
  dossier_id: "dossier-1",
  title: "Trust the opened bytes",
  objective: "Reject malformed persisted state",
  scope: { in: ["storage"], out: ["network"] },
  constraints: ["offline"],
  acceptance_criteria: [
    { criterion_id: "criterion-1", statement: "State validates", verification: "mechanical" },
  ],
  state_revision: "0",
  state_digest: `sha256:${"0".repeat(64)}`,
  last_operation: null,
  active_run: { run_id: "run-1", actor_id: "actor-1", started_by_handoff_id: null },
  evidence: [],
  current_handoff_id: null,
  current_submission_id: null,
  current_decision_id: null,
};

async function createStore(t: test.TestContext, stored: unknown): Promise<CaseStore> {
  const root = await mkdtemp(join(tmpdir(), "case-agent-store-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const dossierDirectory = join(root, ".case-agent", "dossiers", "dossier-1");
  await mkdir(dossierDirectory, { recursive: true });
  await writeFile(join(dossierDirectory, "dossier.json"), `${JSON.stringify(stored)}\n`);
  const schemas = await SchemaRegistry.load(join(process.cwd(), "schemas"));
  return new CaseStore(root, schemas);
}

test("CaseStore loads a strictly parsed and schema-valid addressed dossier", async (t) => {
  const store = await createStore(t, dossier);
  const loaded = await store.loadDossier("dossier-1");

  assert.equal(loaded.dossier_id, "dossier-1");
  assert.equal(loaded.state_revision, "0");
  assert.equal(loaded.state_digest, `sha256:${"0".repeat(64)}`);
});

test("CaseStore rejects a dossier stored under a different ID", async (t) => {
  const store = await createStore(t, { ...dossier, dossier_id: "dossier-2" });
  await assert.rejects(store.loadDossier("dossier-1"), /CASE_E_INVARIANT/);
});

test("CaseStore rejects schema-invalid dossier state", async (t) => {
  const store = await createStore(t, { ...dossier, state_revision: "01" });
  await assert.rejects(store.loadDossier("dossier-1"), /CASE_E_SCHEMA/);
});
