import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCorpus } from "../../src/conformance/runner.js";

const corpusRoot = join(process.cwd(), "conformance");

async function withCorpusCopy<T>(action: (root: string) => Promise<T>): Promise<T> {
  const temporary = await mkdtemp(join(tmpdir(), "case-agent-corpus-test-"));
  const copy = join(temporary, "conformance");
  try {
    await cp(corpusRoot, copy, { recursive: true, errorOnExist: true });
    return await action(copy);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value)}\n`);
}

test("every normative rule has every required executed direction", async () => {
  const summary = await runCorpus(corpusRoot);

  assert.deepEqual(summary.uncovered_positive, []);
  assert.deepEqual(summary.uncovered_negative, []);
  assert.equal(summary.failed, 0);
});

test("normal results cannot leave exact stdout implicit", async () => {
  await withCorpusCopy(async (root) => {
    const caseFile = join(root, "cases", "positive", "dossier", "dossier-create", "case.json");
    const fixture = JSON.parse(await readFile(caseFile, "utf8")) as {
      expected: Array<{ stdout_json_file: string | null }>;
    };
    fixture.expected[0]!.stdout_json_file = null;
    await writeFile(caseFile, `${JSON.stringify(fixture)}\n`);

    await assert.rejects(runCorpus(root), /CASE_E_CONFORMANCE/u);
  });
});

test("a concurrency group must declare exactly one successful result", async () => {
  await withCorpusCopy(async (root) => {
    const caseFile = join(root, "cases", "positive", "dossier", "dossier-create", "case.json");
    const fixture = JSON.parse(await readFile(caseFile, "utf8")) as {
      invocations: Array<{ concurrency_group: string | null }>;
      expected: Array<{ process_exit: number }>;
    };
    fixture.invocations[0]!.concurrency_group = "writers";
    fixture.invocations.push(structuredClone(fixture.invocations[0]!));
    fixture.expected.push(structuredClone(fixture.expected[0]!));
    await writeFile(caseFile, `${JSON.stringify(fixture)}\n`);

    await assert.rejects(runCorpus(root), /exactly one declared success/u);
  });
});

test("an uncovered required direction remains visible", async () => {
  await withCorpusCopy(async (root) => {
    const rulesFile = join(root, "rules.json");
    const rules = await readJson<Array<Record<string, unknown>>>(rulesFile);
    rules.push({
      rule_id: "M0-TEST-999",
      source_section: "22",
      statement: "A synthetic required direction remains uncovered until a case executes it.",
      requires_positive: true,
      requires_negative: false,
    });
    await writeJson(rulesFile, rules);

    const summary = await runCorpus(root);
    assert.deepEqual(summary.uncovered_positive, ["M0-TEST-999"]);
  });
});

test("schema-invalid, duplicate, and unknown rule references fail closed", async (t) => {
  await t.test("schema-invalid case", async () => {
    await withCorpusCopy(async (root) => {
      const caseFile = join(root, "cases", "positive", "dossier", "dossier-create", "case.json");
      const fixture = await readJson<Record<string, unknown>>(caseFile);
      fixture.unknown = true;
      await writeJson(caseFile, fixture);
      await assert.rejects(runCorpus(root), /closed schema/u);
    });
  });
  await t.test("duplicate ledger ID", async () => {
    await withCorpusCopy(async (root) => {
      const rulesFile = join(root, "rules.json");
      const rules = await readJson<Array<Record<string, unknown>>>(rulesFile);
      rules.push(structuredClone(rules[0]!));
      await writeJson(rulesFile, rules);
      await assert.rejects(runCorpus(root), /duplicate rule IDs/u);
    });
  });
  await t.test("unknown case rule", async () => {
    await withCorpusCopy(async (root) => {
      const caseFile = join(root, "cases", "positive", "dossier", "dossier-create", "case.json");
      const fixture = await readJson<{ normative_rule_ids: string[] }>(caseFile);
      fixture.normative_rule_ids.push("M0-TEST-998");
      await writeJson(caseFile, fixture);
      await assert.rejects(runCorpus(root), /references unknown rule/u);
    });
  });
});

test("unsafe and ambiguous fixture structure fails before execution", async () => {
  await withCorpusCopy(async (root) => {
    const caseFile = join(root, "cases", "positive", "dossier", "dossier-create", "case.json");
    const original = await readJson<{
      fixture_version: string;
      applicable_platform_profiles: string[];
      initial_tree: Array<{ path: string; content_file: string; sha256: string }>;
      invocations: Array<{ fault_point: string | null }>;
      expected: unknown[];
    }>(caseFile);
    const rejects = async (mutate: (fixture: typeof original) => void, pattern: RegExp): Promise<void> => {
      const fixture = structuredClone(original);
      mutate(fixture);
      await writeJson(caseFile, fixture);
      await assert.rejects(runCorpus(root), pattern);
    };

    for (const path of ["../escape", "/absolute", "C:/drive", "//server/share", "a\\b"]) {
      await rejects((fixture) => { fixture.initial_tree[0]!.content_file = path; }, /closed schema|safe relative path/u);
    }
    await rejects((fixture) => { fixture.initial_tree[1] = structuredClone(fixture.initial_tree[0]!); }, /duplicate paths|stable order/u);
    await rejects((fixture) => { fixture.initial_tree[0]!.sha256 = `sha256:${"0".repeat(64)}`; }, /digest mismatch/u);
    await rejects((fixture) => { fixture.expected.pop(); }, /invocation\/expectation counts differ|closed schema/u);
    await rejects((fixture) => { fixture.fixture_version = "2"; }, /closed schema/u);
    await rejects((fixture) => { fixture.invocations[0]!.fault_point = "unknown-fault"; }, /closed schema/u);
    await rejects((fixture) => { fixture.applicable_platform_profiles = ["unknown-profile"]; }, /closed schema/u);
  });
});

test("a linked corpus content reference fails closed before execution", async () => {
  await withCorpusCopy(async (root) => {
    const link = join(root, "linked-data");
    await symlink(join(root, "data"), link, "junction");
    const caseFile = join(root, "cases", "positive", "dossier", "dossier-create", "case.json");
    const fixture = await readJson<{
      initial_tree: Array<{ content_file: string }>;
    }>(caseFile);
    fixture.initial_tree[0]!.content_file = "linked-data/empty.bin";
    await writeJson(caseFile, fixture);

    await assert.rejects(runCorpus(root), /link/u);
  });
});

test("a probe cannot certify an unrelated rule label", async () => {
  await withCorpusCopy(async (root) => {
    const caseFile = join(root, "cases", "positive", "protocol", "strict-json-valid", "case.json");
    const fixture = await readJson<{ normative_rule_ids: string[] }>(caseFile);
    fixture.normative_rule_ids.push("M0-HANDOFF-001");
    fixture.normative_rule_ids.sort();
    await writeJson(caseFile, fixture);

    const summary = await runCorpus(root);
    assert.ok(summary.failed > 0);
  });
});

test("state-critical input corruption turns a passing vector red even with a refreshed fixture digest", async () => {
  await withCorpusCopy(async (root) => {
    const original = await readJson<Record<string, unknown>>(join(root, "data", "base-dossier.json"));
    original.state_digest = `sha256:${"0".repeat(64)}`;
    const bytes = Buffer.from(`${JSON.stringify(original)}\n`, "utf8");
    const relative = "data/mutated-state.json";
    await writeFile(join(root, relative), bytes);
    const declared = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const caseFile = join(root, "cases", "positive", "rehydration", "show-context-loss", "case.json");
    const fixture = await readJson<{ initial_tree: Array<{ path: string; content_file: string; sha256: string }> }>(caseFile);
    const snapshot = fixture.initial_tree.find(({ path }) => path.endsWith("/dossier.json"));
    assert.ok(snapshot);
    snapshot.content_file = relative;
    snapshot.sha256 = declared;
    await writeJson(caseFile, fixture);
    let casePassed: boolean | undefined;

    const summary = await runCorpus(root, {
      onCaseResult: (caseId, passed) => { if (caseId === "show-context-loss") casePassed = passed; },
    });
    assert.equal(casePassed, false);
    assert.ok(summary.failed > 0);
  });
});

test("stdout, final-tree, and derived-view expectation mutations are independently red", async (t) => {
  await t.test("stdout", async () => {
    await withCorpusCopy(async (root) => {
      const stdoutFile = join(root, "data", "expected", "dossier-create.json");
      const expected = await readJson<Record<string, unknown>>(stdoutFile);
      expected.message = "Mutated expected message";
      await writeJson(stdoutFile, expected);
      assert.ok((await runCorpus(root)).failed > 0);
    });
  });
  await t.test("final tree", async () => {
    await withCorpusCopy(async (root) => {
      const caseFile = join(root, "cases", "positive", "dossier", "dossier-create", "case.json");
      const fixture = await readJson<{ expected_final_tree: Array<{ sha256: string | null }> }>(caseFile);
      fixture.expected_final_tree[0]!.sha256 = `sha256:${"0".repeat(64)}`;
      await writeJson(caseFile, fixture);
      assert.ok((await runCorpus(root)).failed > 0);
    });
  });
  await t.test("derived view", async () => {
    await withCorpusCopy(async (root) => {
      const viewFile = join(root, "data", "views", "base.json");
      const view = await readJson<Record<string, unknown>>(viewFile);
      view.title = "Mutated expected view";
      await writeJson(viewFile, view);
      assert.ok((await runCorpus(root)).failed > 0);
    });
  });
});
