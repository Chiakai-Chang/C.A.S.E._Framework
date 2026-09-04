import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { SchemaRegistry } from "../../src/protocol/schema-registry.js";
import { nodeRepositoryFileSystem, type InitPorts, initRepository } from "../../src/workflows/init.js";

const timestamp = "2026-09-04T03:02:01Z";

async function createRepository(t: test.TestContext): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), "case-agent-init-"));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(join(repository, ".git", "objects"), { recursive: true });
  await mkdir(join(repository, ".git", "refs"), { recursive: true });
  await writeFile(join(repository, ".git", "HEAD"), "ref: refs/heads/main\n");
  await writeFile(join(repository, ".git", "config"), "[core]\n\tbare = false\n");
  return repository;
}

async function snapshotTree(root: string): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const lexical = relative(root, absolute).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        await visit(absolute);
      } else {
        result.set(lexical, await readFile(absolute));
      }
    }
  }
  await visit(root);
  return result;
}

function withoutCaseAgent(snapshot: Map<string, Buffer>): Record<string, string> {
  return Object.fromEntries(
    [...snapshot]
      .filter(([path]) => path !== ".case-agent" && !path.startsWith(".case-agent/"))
      .map(([path, bytes]) => [path, bytes.toString("hex")]),
  );
}

async function ports(displayedRoots: string[], temporaryId = "temporary-1"): Promise<InitPorts> {
  return {
    fs: nodeRepositoryFileSystem,
    schemas: await SchemaRegistry.load(join(process.cwd(), "schemas")),
    createRepositoryId: () => "repository-1",
    createTemporaryId: () => temporaryId,
    now: () => timestamp,
    displayRepositoryRoot: (root) => { displayedRoots.push(root); },
  };
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
});

test("init rejects a foreign .case-agent directory before writing", async (t) => {
  const repository = await createRepository(t);
  await mkdir(join(repository, ".case-agent"));
  await writeFile(join(repository, ".case-agent", "foreign.txt"), "mine");
  const before = await snapshotTree(repository);

  const result = await initRepository(
    { start_directory: repository, operation_id: "op-init" },
    await ports([]),
  );

  assert.equal(result.code, "CASE_E_NAMESPACE_COLLISION");
  assert.deepEqual(await snapshotTree(repository), before);
  assert.equal(await readFile(join(repository, ".case-agent", "foreign.txt"), "utf8"), "mine");
});

test("init rejects an unsafe injected temporary ID before writing", async (t) => {
  const repository = await createRepository(t);
  const before = await snapshotTree(repository);

  const result = await initRepository(
    { start_directory: repository, operation_id: "op-init" },
    await ports([], "../../escaped"),
  );

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

  const result = await initRepository(
    { start_directory: repository, operation_id: "op-init" },
    { ...configured, schemas: throwingSchemas },
  );

  assert.equal(result.code, "CASE_E_INTERNAL");
  assert.deepEqual(await snapshotTree(repository), before);
});
