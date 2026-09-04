import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { SchemaRegistry } from "../../src/protocol/schema-registry.js";
import {
  nodeRepositoryFileSystem,
  type InitPorts,
  type InitializationTargetClassification,
  type RepositoryFileSystemPort,
  initRepository,
} from "../../src/workflows/init.js";

const run = promisify(execFile);
const timestamp = "2026-09-04T03:02:01Z";

async function createRepository(t: test.TestContext): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), "case-agent-init-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await run("git", ["init", "--quiet", repository]);
  return repository;
}

async function snapshotTree(root: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const lexical = relative(root, absolute).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        result.set(`${lexical}/`, "directory");
        await visit(absolute);
      } else if (entry.isSymbolicLink()) {
        result.set(lexical, "link");
      } else {
        result.set(lexical, (await readFile(absolute)).toString("hex"));
      }
    }
  }
  await visit(root);
  return result;
}

function withoutCaseAgent(snapshot: Map<string, string>): Record<string, string> {
  return Object.fromEntries(
    [...snapshot].filter(([path]) => path !== ".case-agent/" && !path.startsWith(".case-agent/")),
  );
}

function classifiedFileSystem(
  classification: InitializationTargetClassification = { supported: true, profile: "test-local" },
): RepositoryFileSystemPort {
  return {
    ...nodeRepositoryFileSystem,
    classifyInitializationTarget: async () => classification,
  };
}

async function ports(
  displayedRoots: string[],
  fs: RepositoryFileSystemPort = classifiedFileSystem(),
): Promise<InitPorts> {
  return {
    fs,
    schemas: await SchemaRegistry.load(join(process.cwd(), "schemas")),
    createRepositoryId: () => "repository-1",
    now: () => timestamp,
    displayRepositoryRoot: (root) => { displayedRoots.push(root); },
  };
}

async function initialize(repository: string, configured?: InitPorts) {
  return initRepository(
    { start_directory: repository, operation_id: "op-init" },
    configured ?? await ports([]),
  );
}

test("init changes no byte outside .case-agent", async (t) => {
  const repository = await createRepository(t);
  const nested = join(repository, "packages", "feature");
  await mkdir(nested, { recursive: true });
  await writeFile(join(repository, "owned.txt"), "keep these bytes");
  const before = await snapshotTree(repository);
  const displayedRoots: string[] = [];

  const result = await initRepository(
    { start_directory: nested, operation_id: "op-init" },
    await ports(displayedRoots),
  );

  const after = await snapshotTree(repository);
  assert.equal(result.ok, true);
  assert.deepEqual(withoutCaseAgent(after), withoutCaseAgent(before));
  assert.deepEqual(displayedRoots, [repository]);
  assert.deepEqual(await readdir(join(repository, ".case-agent")), ["dossiers", "locks", "manifest.json"]);
  assert.equal((await readdir(repository)).some((name) => name.startsWith(".case-agent.tmp-")), false);
});

test("population cleanup failure leaves residue only inside exact .case-agent", async (t) => {
  const repository = await createRepository(t);
  await writeFile(join(repository, "owned.txt"), "unchanged");
  const before = await snapshotTree(repository);
  const base = classifiedFileSystem();
  const failing: RepositoryFileSystemPort = {
    ...base,
    writeNewFile: async () => { throw new Error("injected population failure"); },
    removeOwnedNamespace: async () => { throw new Error("injected cleanup failure"); },
  };

  const result = await initialize(repository, await ports([], failing));

  assert.equal(result.code, "CASE_E_NAMESPACE_COLLISION");
  assert.deepEqual(withoutCaseAgent(await snapshotTree(repository)), withoutCaseAgent(before));
  assert.deepEqual(await readdir(join(repository, ".case-agent")), ["dossiers", "locks"]);
  assert.equal((await readdir(repository)).some((name) => name.startsWith(".case-agent.tmp-")), false);
});

test("init rejects a differently cased namespace before trusting its manifest", async (t) => {
  const repository = await createRepository(t);
  assert.equal((await initialize(repository)).ok, true);
  await rename(join(repository, ".case-agent"), join(repository, ".CASE-AGENT"));
  const before = await snapshotTree(repository);

  const result = await initialize(repository);

  assert.equal(result.code, "CASE_E_NAMESPACE_COLLISION");
  assert.deepEqual(await snapshotTree(repository), before);
});

test("init is byte-idempotent for a compatible namespace", async (t) => {
  const repository = await createRepository(t);
  assert.equal((await initialize(repository)).ok, true);
  const before = await snapshotTree(repository);

  const result = await initialize(repository);

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.data.already_initialized, true);
  assert.deepEqual(await snapshotTree(repository), before);
});

test("init rejects a partial namespace without changing it", async (t) => {
  const repository = await createRepository(t);
  await mkdir(join(repository, ".case-agent", "dossiers"), { recursive: true });
  const before = await snapshotTree(repository);

  const result = await initialize(repository);

  assert.equal(result.code, "CASE_E_NAMESPACE_COLLISION");
  assert.deepEqual(await snapshotTree(repository), before);
});

test("init rejects an incompatible same-major manifest without changing it", async (t) => {
  const repository = await createRepository(t);
  assert.equal((await initialize(repository)).ok, true);
  const path = join(repository, ".case-agent", "manifest.json");
  const manifest = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  manifest.protocol_version = "0.2.0";
  await writeFile(path, `${JSON.stringify(manifest)}\n`);
  const before = await snapshotTree(repository);

  const result = await initialize(repository);

  assert.equal(result.code, "CASE_E_NAMESPACE_COLLISION");
  assert.deepEqual(await snapshotTree(repository), before);
});

test("init reports an unsupported major without changing the namespace", async (t) => {
  const repository = await createRepository(t);
  assert.equal((await initialize(repository)).ok, true);
  const path = join(repository, ".case-agent", "manifest.json");
  const manifest = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  manifest.protocol_version = "1.0.0";
  await writeFile(path, `${JSON.stringify(manifest)}\n`);
  const before = await snapshotTree(repository);

  const result = await initialize(repository);

  assert.equal(result.code, "CASE_E_UNSUPPORTED_VERSION");
  assert.deepEqual(await snapshotTree(repository), before);
});

test("init rejects a foreign .case-agent directory before writing", async (t) => {
  const repository = await createRepository(t);
  await mkdir(join(repository, ".case-agent"));
  await writeFile(join(repository, ".case-agent", "foreign.txt"), "mine");
  const before = await snapshotTree(repository);

  const result = await initialize(repository);

  assert.equal(result.code, "CASE_E_NAMESPACE_COLLISION");
  assert.deepEqual(await snapshotTree(repository), before);
});

for (const classification of [
  { supported: false, reason: "unclassified" },
  { supported: false, reason: "unc" },
  { supported: false, reason: "reparse-uncertain" },
] as const satisfies readonly InitializationTargetClassification[]) {
  test(`init refuses ${classification.reason} targets before namespace creation`, async (t) => {
    const repository = await createRepository(t);
    const fs = classifiedFileSystem(classification);

    const result = await initialize(repository, await ports([], fs));

    assert.equal(result.code, "CASE_E_INTERNAL");
    assert.equal((await readdir(repository)).includes(".case-agent"), false);
  });
}

test("the Node-only adapter is unclassified and cannot initialize", async (t) => {
  const repository = await createRepository(t);

  const result = await initialize(repository, await ports([], nodeRepositoryFileSystem));

  assert.equal(result.code, "CASE_E_INTERNAL");
  assert.equal((await readdir(repository)).includes(".case-agent"), false);
});

test("the Node-only adapter cannot trust an existing namespace without classification", async (t) => {
  const repository = await createRepository(t);
  assert.equal((await initialize(repository)).ok, true);
  const before = await snapshotTree(repository);

  const result = await initialize(repository, await ports([], nodeRepositoryFileSystem));

  assert.equal(result.code, "CASE_E_INTERNAL");
  assert.deepEqual(await snapshotTree(repository), before);
});

test("init converts a validator exception to a stable internal result before writing", async (t) => {
  const repository = await createRepository(t);
  const before = await snapshotTree(repository);
  const configured = await ports([]);
  const throwingSchemas = {
    validate(): never { throw new Error("validator diagnostics must not escape"); },
  } as unknown as SchemaRegistry;

  const result = await initialize(repository, { ...configured, schemas: throwingSchemas });

  assert.equal(result.code, "CASE_E_INTERNAL");
  assert.deepEqual(await snapshotTree(repository), before);
});
