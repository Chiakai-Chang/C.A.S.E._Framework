import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  nodePathInspection,
  discoverRepositoryRoot,
  nodeGitDiscovery,
  resolveEvidencePath,
  type PathInspectionPort,
} from "../../src/storage/paths.js";
import { CaseStore } from "../../src/storage/store.js";
import { SchemaRegistry } from "../../src/protocol/schema-registry.js";

const run = promisify(execFile);

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
  "artifacts/Evidence.txt:alternate",
  "CON",
  "artifacts/aux.txt",
  "artifacts/Evidence.txt.",
  "artifacts/Evidence.txt ",
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

test("rejects an adapter-reported case-fold alias even when the requested spelling exists", async (t) => {
  const root = await createTree(t);
  const ambiguous: PathInspectionPort = {
    ...nodePathInspection,
    async listDirectory(path) {
      const entries = await nodePathInspection.listDirectory(path);
      return path.endsWith("artifacts")
        ? [...entries, { name: "evidence.txt" }]
        : entries;
    },
  };

  await assert.rejects(
    resolveEvidencePath(root, "artifacts/Evidence.txt", ambiguous),
    /CASE_E_EVIDENCE/,
  );
});

test("rejects a regular-file hardlink alias", async (t) => {
  const root = await createTree(t);
  await link(join(root, "artifacts", "Evidence.txt"), join(root, "artifacts", "Evidence-alias.txt"));

  await assert.rejects(resolveEvidencePath(root, "artifacts/Evidence.txt"), /CASE_E_EVIDENCE/);
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

async function createGitRepository(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "case-agent-git-root-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await run("git", ["init", "--quiet", root]);
  return root;
}

test("repository discovery accepts a Git-confirmed normal worktree root", async (t) => {
  const root = await createGitRepository(t);
  const nested = join(root, "nested");
  await mkdir(nested);

  assert.equal(await discoverRepositoryRoot(nested, nodePathInspection, nodeGitDiscovery), root);
});

test("repository discovery accepts a Git-confirmed linked worktree root", async (t) => {
  const root = await createGitRepository(t);
  await run("git", ["-C", root, "-c", "user.name=Case Test", "-c", "user.email=case@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "root"]);
  const linked = `${root}-linked`;
  t.after(async () => rm(linked, { recursive: true, force: true }));
  await run("git", ["-C", root, "worktree", "add", "--quiet", "-b", "case-linked", linked]);
  const nested = join(linked, "nested");
  await mkdir(nested);

  assert.equal(await discoverRepositoryRoot(nested, nodePathInspection, nodeGitDiscovery), linked);
});

test("repository discovery stops at a closest marker with adversarial bare config", async (t) => {
  const outer = await createGitRepository(t);
  const inner = join(outer, "inner");
  await mkdir(join(inner, ".git", "objects"), { recursive: true });
  await mkdir(join(inner, ".git", "refs"), { recursive: true });
  await writeFile(join(inner, ".git", "HEAD"), "ref: refs/heads/main\n");
  await writeFile(join(inner, ".git", "config"), "[core]\n\tbare = true\n[unrelated]\n\tbare = false\n");

  await assert.rejects(
    discoverRepositoryRoot(inner, nodePathInspection, nodeGitDiscovery),
    /CASE_E_NOT_INITIALIZED/,
  );
});

test("repository discovery stops at a closest marker with an invalid Git ref", async (t) => {
  const outer = await createGitRepository(t);
  const inner = join(outer, "inner");
  await mkdir(join(inner, ".git", "objects"), { recursive: true });
  await mkdir(join(inner, ".git", "refs"), { recursive: true });
  await writeFile(join(inner, ".git", "HEAD"), "ref: refs/heads/main..invalid\n");
  await writeFile(join(inner, ".git", "config"), "[core]\n\tbare = false\n");

  await assert.rejects(
    discoverRepositoryRoot(inner, nodePathInspection, nodeGitDiscovery),
    /CASE_E_NOT_INITIALIZED/,
  );
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
