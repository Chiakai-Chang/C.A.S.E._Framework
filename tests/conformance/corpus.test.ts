import assert from "node:assert/strict";
import { createHook } from "node:async_hooks";
import { spawn } from "node:child_process";
import { createHash, pbkdf2 } from "node:crypto";
import { createSocket } from "node:dgram";
import { lookup, Resolver } from "node:dns";
import { writeFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promiseHooks } from "node:v8";
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

test("§22.1 stderr prose and the closed case schema define the same exact relations", async () => {
  const design = await readFile(join(process.cwd(), "docs", "superpowers", "specs", "2026-09-04-local-dossier-integrity-design.md"), "utf8");
  const section = design.slice(design.indexOf("### 22.1 Frozen fixture contract"), design.indexOf("## 23. Baseline evaluation"));
  const schema = await readJson<{
    required: string[];
    $defs: {
      expectation: {
        required: string[];
        properties: { stderr: { enum: string[] } };
        allOf: unknown[];
      };
    };
  }>(join(corpusRoot, "schema", "case.schema.json"));
  const modeLine = /^  stderr: (.+)$/mu.exec(section);
  assert.ok(modeLine);
  assert.deepEqual(modeLine[1]!.split(" | "), schema.$defs.expectation.properties.stderr.enum);
  assert.match(section, /^  stderr_file: path \| null$/mu);
  assert.ok(schema.$defs.expectation.required.includes("stderr_file"));
  assert.equal(schema.$defs.expectation.allOf.length, 3);
  assert.match(section, /`empty` requires normal stdout and `stderr_file: null`/u);
  assert.match(section, /`exact` requires normal stdout and a corpus-relative `stderr_file` compared byte-for-byte/u);
  assert.match(section, /`startup_failure_only` requires both stdout and stderr file references to be null/u);
  assert.match(section, /interactive prompt references resolve inside the frozen corpus/u);
  assert.match(section, /^initial_directories\[\] in exact repository-relative path order$/mu);
  assert.match(section, /^expected_final_directories\[\] in exact repository-relative path order$/mu);
  assert.ok(schema.required.includes("initial_directories"));
  assert.ok(schema.required.includes("expected_final_directories"));
  assert.match(section, /`@fixture replace` content/u);
  assert.match(section, /placeholder files receive no production exception/u);
  assert.match(section, /unresolved Promise continuations registered by the case must be quiescent at return/u);
  assert.match(section, /bare unresolved Promise with no registered continuation is not pending work/u);
  assert.match(section, /one deterministic, non-timed event-loop lifecycle checkpoint/u);
  assert.match(section, /mutable private handle fields carry no authority/u);
  assert.match(section, /re-evaluates outcomes, the read-only derived view, the final repository tree, and the harness-owned Git baseline/u);
  assert.match(section, /rebuilds binding facts only from that second evaluation/u);
  assert.match(section, /module-loaded `node:timers` cancellation functions with the actual resource objects/u);
  assert.match(section, /Node 24\.19\.0 is the measured baseline/u);
  assert.match(section, /every other Node 24 release must pass this capability probe/u);
  assert.match(section, /audit hook is disabled before the library call returns/u);
  assert.match(section, /detection, not a claim that the runner can cancel a Promise or sandbox a later side effect/u);
  assert.match(section, /formal conformance command writes its final result synchronously and terminates its process explicitly/u);

  const ledger = await readJson<Array<{ rule_id: string; statement: string }>>(join(corpusRoot, "rules.json"));
  assert.equal(
    ledger.find(({ rule_id }) => rule_id === "M0-CORPUS-011")?.statement,
    "Every executed case audits zero case-causal in-process network initialization and no runnable timer, persistent handle, unfinished one-shot work, or unresolved case-registered Promise continuation pending after final assertions; synchronously cancelled timers and immediates are not pending work.",
  );

  const bindings = await readJson<{
    rules: Array<{ rule_id: string; positive: Array<{ case_id: string; assertion_ids: string[] }> }>;
  }>(join(corpusRoot, "bindings.json"));
  const corpusRule = bindings.rules.find(({ rule_id }) => rule_id === "M0-CORPUS-003");
  assert.ok(corpusRule);
  assert.deepEqual(corpusRule.positive, [{
    case_id: "corpus-contract-positive",
    assertion_ids: ["probe.all-runtime-corpus-data-references-are-bundled-relative-files"],
  }]);
});

test("the platform specification explicitly declares the current public Windows profile unsupported", async () => {
  const design = await readFile(join(process.cwd(), "docs", "superpowers", "specs", "2026-09-04-local-dossier-integrity-design.md"), "utf8");
  assert.match(
    design,
    /The current public Windows profile is explicitly unsupported: on Windows the frozen public CLI vector returns `CASE_E_UNSUPPORTED_PROFILE` with exit 10 and does not receive controlled-test coverage credit\./u,
  );
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
    const bindingsFile = join(root, "bindings.json");
    const bindings = await readJson<{
      rules: Array<{ rule_id: string; positive: unknown[]; negative: unknown[] }>;
    }>(bindingsFile);
    bindings.rules.push({ rule_id: "M0-TEST-999", positive: [], negative: [] });
    await writeJson(bindingsFile, bindings);

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
      initial_directories: string[];
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

    for (const path of ["../escape", "/absolute", "C:/drive", "//server/share", "a\\b", "CONIN$", "conout$", "CLOCK$", "COM¹", "com².txt", "LPT³"]) {
      await rejects((fixture) => { fixture.initial_tree[0]!.content_file = path; }, /closed schema|safe relative path/u);
    }
    await rejects((fixture) => { fixture.initial_tree[1] = structuredClone(fixture.initial_tree[0]!); }, /duplicate paths|stable order/u);
    await rejects((fixture) => { fixture.initial_directories.shift(); }, /directory topology omits/u);
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

test("the complete runtime-reference scan includes @fixture replace content", async () => {
  await withCorpusCopy(async (root) => {
    const caseFile = join(root, "cases", "negative", "evidence", "changed", "case.json");
    const fixture = await readJson<{ invocations: Array<{ argv: string[] }> }>(caseFile);
    const replacement = fixture.invocations.find(({ argv }) => argv[0] === "@fixture" && argv[1] === "replace");
    assert.ok(replacement);
    const reference = "data/runtime-replace-only.txt";
    const referencePath = join(root, ...reference.split("/"));
    const bytes = await readFile(join(root, "data", "artifact-v2.txt"));
    await writeFile(referencePath, bytes);
    replacement.argv[3] = reference;
    await writeJson(caseFile, fixture);

    let targetPassed: boolean | undefined;
    const summary = await runCorpus(root, {
      async onCaseStart(caseId) {
        if (caseId !== "corpus-contract-positive") return;
        await rm(referencePath);
        await mkdir(referencePath);
      },
      async onCaseResult(caseId, passed) {
        if (caseId !== "corpus-contract-positive") return;
        targetPassed = passed;
        await rm(referencePath, { recursive: true });
        await writeFile(referencePath, bytes);
      },
    });
    assert.equal(targetPassed, false);
    assert.ok(summary.failed > 0);
  });
});

test("a probe cannot certify an unrelated rule label", async () => {
  await withCorpusCopy(async (root) => {
    const caseFile = join(root, "cases", "positive", "protocol", "strict-json-valid", "case.json");
    const fixture = await readJson<{ normative_rule_ids: string[] }>(caseFile);
    fixture.normative_rule_ids.push("M0-HANDOFF-001");
    fixture.normative_rule_ids.sort();
    await writeJson(caseFile, fixture);

    await assert.rejects(runCorpus(root), /assertion binding|rule binding/u);
  });
});

test("an ordinary CLI case cannot certify an unrelated known rule label", async () => {
  await withCorpusCopy(async (root) => {
    const caseFile = join(root, "cases", "positive", "dossier", "dossier-create", "case.json");
    const fixture = await readJson<{ normative_rule_ids: string[] }>(caseFile);
    fixture.normative_rule_ids.push("M0-HANDOFF-001");
    fixture.normative_rule_ids.sort();
    await writeJson(caseFile, fixture);

    await assert.rejects(runCorpus(root), /assertion binding|rule binding/u);
  });
});

test("a fixture and binding manifest cannot collude through a generic result assertion", async () => {
  await withCorpusCopy(async (root) => {
    const caseFile = join(root, "cases", "positive", "dossier", "dossier-create", "case.json");
    const fixture = await readJson<{ case_id: string; normative_rule_ids: string[] }>(caseFile);
    fixture.normative_rule_ids.push("M0-HANDOFF-001");
    fixture.normative_rule_ids.sort();
    await writeJson(caseFile, fixture);

    const bindingsFile = join(root, "bindings.json");
    const bindings = await readJson<{
      rules: Array<{
        rule_id: string;
        positive: Array<{ case_id: string; assertion_ids: string[] }>;
      }>;
    }>(bindingsFile);
    const rule = bindings.rules.find(({ rule_id }) => rule_id === "M0-HANDOFF-001");
    assert.ok(rule);
    rule.positive.push({ case_id: fixture.case_id, assertion_ids: ["process:0:code=CASE_OK"] });
    rule.positive.sort((left, right) => left.case_id.localeCompare(right.case_id));
    await writeJson(bindingsFile, bindings);

    await assert.rejects(runCorpus(root), /lacks a clause-specific assertion/u);
  });
});

test("rule bindings reject generic or legacy assertion labels", async () => {
  await withCorpusCopy(async (root) => {
    const bindingsFile = join(root, "bindings.json");
    const bindings = await readJson<{
      rules: Array<{
        positive: Array<{ assertion_ids: string[] }>;
      }>;
    }>(bindingsFile);
    const firstBoundRule = bindings.rules.find(({ positive }) => positive.length > 0);
    assert.ok(firstBoundRule);
    firstBoundRule.positive[0]!.assertion_ids = ["invocation.0.stdout-exact"];
    await writeJson(bindingsFile, bindings);

    await assert.rejects(runCorpus(root), /bindings\.json.*closed schema/u);
  });
});

test("distinct normative clauses do not share an identical executable binding vector", async () => {
  const bindings = await readJson<{
    rules: Array<{
      rule_id: string;
      positive: Array<{ case_id: string; assertion_ids: string[] }>;
      negative: Array<{ case_id: string; assertion_ids: string[] }>;
    }>;
  }>(join(corpusRoot, "bindings.json"));
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  for (const rule of bindings.rules) {
    for (const direction of ["positive", "negative"] as const) {
      for (const entry of rule[direction]) {
        const signature = JSON.stringify([direction, entry.case_id, entry.assertion_ids]);
        const previous = seen.get(signature);
        if (previous === undefined) seen.set(signature, rule.rule_id);
        else duplicates.push(`${previous}/${rule.rule_id}:${direction}:${entry.case_id}`);
      }
    }
  }
  assert.deepEqual(duplicates, []);
});

test("positive and negative cases cannot be behavior-identical vectors", async () => {
  await withCorpusCopy(async (root) => {
    const source = join(root, "cases", "positive", "dossier", "dossier-create");
    const target = join(root, "cases", "negative", "dossier", "dossier-create-identical");
    await cp(source, target, { recursive: true, errorOnExist: true });
    const caseFile = join(target, "case.json");
    const fixture = await readJson<{ case_id: string; normative_rule_ids: string[] }>(caseFile);
    fixture.case_id = "dossier-create-identical";
    await writeJson(caseFile, fixture);
    const bindingsFile = join(root, "bindings.json");
    const bindings = await readJson<{
      rules: Array<{
        rule_id: string;
        negative: Array<{ case_id: string; assertion_ids: string[] }>;
      }>;
    }>(bindingsFile);
    for (const ruleId of fixture.normative_rule_ids) {
      const rule = bindings.rules.find(({ rule_id }) => rule_id === ruleId);
      assert.ok(rule);
      rule.negative.push({ case_id: fixture.case_id, assertion_ids: ['stdout:0:/command="dossier.create"'] });
      rule.negative.sort((left, right) => left.case_id.localeCompare(right.case_id));
    }
    await writeJson(bindingsFile, bindings);

    await assert.rejects(runCorpus(root), /behavior-identical|polarity/u);
  });
});

test("positive and negative fingerprints normalize alternate corpus references with identical bytes", async () => {
  await withCorpusCopy(async (root) => {
    const source = join(root, "cases", "positive", "dossier", "dossier-create");
    const target = join(root, "cases", "negative", "dossier", "dossier-create-identical-bytes");
    await cp(source, target, { recursive: true, errorOnExist: true });
    const caseFile = join(target, "case.json");
    const fixture = await readJson<{
      case_id: string;
      normative_rule_ids: string[];
      initial_tree: Array<{ content_file: string }>;
      invocations: Array<{ stdin_content_file: string | null }>;
      expected: Array<{ stdout_json_file: string | null; stderr_file: string | null }>;
      expected_derived_view_file: string | null;
    }>(caseFile);
    fixture.case_id = "dossier-create-identical-bytes";
    const duplicateRoot = join(root, "data", "fingerprint-duplicates");
    await mkdir(duplicateRoot);
    let duplicateIndex = 0;
    const duplicate = async (reference: string | null): Promise<string | null> => {
      if (reference === null) return null;
      const replacement = `data/fingerprint-duplicates/reference-${duplicateIndex++}`;
      await writeFile(join(root, ...replacement.split("/")), await readFile(join(root, ...reference.split("/"))));
      return replacement;
    };
    for (const entry of fixture.initial_tree) entry.content_file = (await duplicate(entry.content_file))!;
    for (const invocation of fixture.invocations) invocation.stdin_content_file = await duplicate(invocation.stdin_content_file);
    for (const expectation of fixture.expected) {
      expectation.stdout_json_file = await duplicate(expectation.stdout_json_file);
      expectation.stderr_file = await duplicate(expectation.stderr_file);
    }
    fixture.expected_derived_view_file = await duplicate(fixture.expected_derived_view_file);
    await writeJson(caseFile, fixture);

    const bindingsFile = join(root, "bindings.json");
    const bindings = await readJson<{
      rules: Array<{ rule_id: string; negative: Array<{ case_id: string; assertion_ids: string[] }> }>;
    }>(bindingsFile);
    for (const ruleId of fixture.normative_rule_ids) {
      const rule = bindings.rules.find(({ rule_id }) => rule_id === ruleId);
      assert.ok(rule);
      rule.negative.push({ case_id: fixture.case_id, assertion_ids: ['stdout:0:/command="dossier.create"'] });
      rule.negative.sort((left, right) => left.case_id.localeCompare(right.case_id));
    }
    await writeJson(bindingsFile, bindings);

    await assert.rejects(runCorpus(root), /behavior-identical|polarity/u);
  });
});

test("a trace-label-only change cannot distinguish cross-polarity behavior", async () => {
  await withCorpusCopy(async (root) => {
    const source = join(root, "cases", "positive", "dossier", "dossier-create");
    const target = join(root, "cases", "negative", "dossier", "dossier-create-actor-label-only");
    await cp(source, target, { recursive: true, errorOnExist: true });
    const caseFile = join(target, "case.json");
    const fixture = await readJson<{
      case_id: string;
      normative_rule_ids: string[];
      invocations: Array<{ actor_label: string }>;
    }>(caseFile);
    fixture.case_id = "dossier-create-actor-label-only";
    fixture.invocations[0]!.actor_label = "trace-peer";
    await writeJson(caseFile, fixture);

    const bindingsFile = join(root, "bindings.json");
    const bindings = await readJson<{
      rules: Array<{ rule_id: string; negative: Array<{ case_id: string; assertion_ids: string[] }> }>;
    }>(bindingsFile);
    for (const ruleId of fixture.normative_rule_ids) {
      const rule = bindings.rules.find(({ rule_id }) => rule_id === ruleId);
      assert.ok(rule);
      rule.negative.push({ case_id: fixture.case_id, assertion_ids: ['stdout:0:/command="dossier.create"'] });
      rule.negative.sort((left, right) => left.case_id.localeCompare(right.case_id));
    }
    await writeJson(bindingsFile, bindings);

    await assert.rejects(runCorpus(root), /behavior-identical|polarity/u);
  });
});

test("decoded prototype-spelling keys remain own unknown fields and fail closure", async () => {
  await withCorpusCopy(async (root) => {
    const caseFile = join(root, "cases", "positive", "dossier", "dossier-create", "case.json");
    const source = await readFile(caseFile, "utf8");
    await writeFile(caseFile, source.replace("{", "{\"\\u005f\\u005fproto__\":true,"));

    await assert.rejects(runCorpus(root), /closed schema/u);
  });
});

test("fixture paths reject ADS, device aliases, and trailing dot or space spellings lexically", async () => {
  await withCorpusCopy(async (root) => {
    const caseFile = join(root, "cases", "positive", "dossier", "dossier-create", "case.json");
    const original = await readJson<{ initial_tree: Array<{ content_file: string }> }>(caseFile);
    for (const path of ["data/file:alternate", "CON", "data/AUX.json", "data/file.", "data/file "]) {
      const fixture = structuredClone(original);
      fixture.initial_tree[0]!.content_file = path;
      await writeJson(caseFile, fixture);
      await assert.rejects(runCorpus(root), /closed schema|safe relative path/u);
    }
  });
});

test("actor_label is constrained to an explicit non-authoritative trace label", async () => {
  await withCorpusCopy(async (root) => {
    const caseFile = join(root, "cases", "positive", "dossier", "dossier-create", "case.json");
    const fixture = await readJson<{ invocations: Array<{ actor_label: string }> }>(caseFile);
    fixture.invocations[0]!.actor_label = "actor-b";
    await writeJson(caseFile, fixture);

    await assert.rejects(runCorpus(root), /closed schema|trace label/u);
  });
});

test("interactive scripts are closed and exact prompt or response mutations turn red", async (t) => {
  const decisionCase = join("cases", "positive", "decision", "decision-acceptance", "case.json");
  await t.test("unknown script field", async () => {
    await withCorpusCopy(async (root) => {
      const fixture = await readJson<{ invocations: Array<{ stdin_content_file: string | null }> }>(join(root, decisionCase));
      const scriptFile = join(root, ...fixture.invocations[2]!.stdin_content_file!.split("/"));
      const script = await readJson<Record<string, unknown>>(scriptFile);
      script.unknown = true;
      await writeJson(scriptFile, script);
      await assert.rejects(runCorpus(root), /interactive script.*closed schema/u);
    });
  });
  await t.test("wrong displayed prompt", async () => {
    await withCorpusCopy(async (root) => {
      const fixture = await readJson<{ invocations: Array<{ stdin_content_file: string | null }> }>(join(root, decisionCase));
      const script = await readJson<{ steps: Array<{ expected_prompt_file: string }> }>(
        join(root, ...fixture.invocations[2]!.stdin_content_file!.split("/")),
      );
      const prompt = join(root, ...script.steps.at(-1)!.expected_prompt_file.split("/"));
      await writeFile(prompt, `${await readFile(prompt, "utf8")}WRONG DISPLAY`);
      let passed: boolean | undefined;
      const summary = await runCorpus(root, { onCaseResult: (id, ok) => { if (id === "decision-acceptance") passed = ok; } });
      assert.equal(passed, false);
      assert.ok(summary.failed > 0);
    });
  });
  await t.test("wrong exact phrase", async () => {
    await withCorpusCopy(async (root) => {
      const fixture = await readJson<{ invocations: Array<{ stdin_content_file: string | null }> }>(join(root, decisionCase));
      const scriptFile = join(root, ...fixture.invocations[2]!.stdin_content_file!.split("/"));
      const script = await readJson<{ steps: Array<{ response: string }> }>(scriptFile);
      script.steps.at(-1)!.response += " ";
      await writeJson(scriptFile, script);
      let passed: boolean | undefined;
      const summary = await runCorpus(root, { onCaseResult: (id, ok) => { if (id === "decision-acceptance") passed = ok; } });
      assert.equal(passed, false);
      assert.ok(summary.failed > 0);
    });
  });
});

test("human show output is exact, bounded, and keeps every required recovery cue", async () => {
  const output = new Map<string, string>();
  const summary = await runCorpus(corpusRoot, {
    onInvocationResult: (caseId, _index, result) => {
      if (["human-show-20", "human-show-21", "human-show-huge"].includes(caseId)) output.set(caseId, result.stdout);
    },
  });
  assert.equal(summary.failed, 0);

  const twenty = output.get("human-show-20");
  const twentyOne = output.get("human-show-21");
  const huge = output.get("human-show-huge");
  assert.ok(twenty);
  assert.ok(twentyOne);
  assert.ok(huge);
  for (const rendered of [twenty, twentyOne]) {
    assert.match(rendered, /^OK CASE_OK: Current dossier$/mu);
    assert.match(rendered, /^dossier ID: case-dossier-1$/mu);
    assert.match(rendered, /^objective: Resume with bounded criteria$/mu);
    assert.match(rendered, /^active writer: actor-a$/mu);
    assert.match(rendered, /^active run: case-run-1$/mu);
    assert.match(rendered, /^revision: 0$/mu);
    assert.match(rendered, /^state digest: sha256:[0-9a-f]{12}…$/mu);
    assert.match(rendered, /^current checks: failed$/mu);
    assert.match(rendered, /^review: working$/mu);
    assert.match(rendered, /^acceptance: pending$/mu);
    assert.match(rendered, /^handoff: none$/mu);
    assert.match(rendered, /^next: CASE_NEXT_ADD_EVIDENCE$/mu);
    assert.match(rendered, /^warnings: total=0 shown=0 omitted=0$/mu);
    assert.equal(rendered.split("\n").filter((line) => line.startsWith("criterion: ")).length, 20);
    assert.ok(Buffer.byteLength(rendered, "utf8") <= 16_384);
  }
  assert.match(twenty, /^title: Bounded human view 20$/mu);
  assert.match(twenty, /^criterion: criterion-20 = failed$/mu);
  assert.match(twenty, /^criteria: total=20 shown=20 omitted=0$/mu);
  assert.doesNotMatch(twenty, /rerun with --json/u);
  assert.match(twentyOne, /^title: Bounded human view 21$/mu);
  assert.match(twentyOne, /^criteria: total=21 shown=20 omitted=1$/mu);
  assert.match(twentyOne, /^deeper: output abbreviated; rerun with --json for complete data$/mu);
  assert.doesNotMatch(twentyOne, /criterion: criterion-21/u);
  assert.doesNotMatch(twentyOne, /evidence gaps: .*criterion-21/u);
  assert.equal(huge, await readFile(join(corpusRoot, "data", "expected", "generated", "human-show-huge.txt"), "utf8"));
  assert.equal(Buffer.byteLength(huge, "utf8"), 11_741);
  assert.match(huge, /^dossier ID: case-dossier-1$/mu);
  assert.match(huge, /^active run: case-run-1$/mu);
  assert.match(huge, /^revision: 0$/mu);
  assert.match(huge, /^state digest: sha256:3e6622952fd5…$/mu);
  assert.match(huge, /^next: CASE_NEXT_ADD_EVIDENCE$/mu);
  assert.match(huge, /^deeper: output abbreviated; rerun with --json for complete data$/mu);
  for (const line of huge.trimEnd().split("\n")) {
    const separator = line.indexOf(": ");
    if (separator >= 0) assert.ok(Buffer.byteLength(line.slice(separator + 2), "utf8") <= 256);
  }
});

test("per-invocation environments may vary sequential clocks and concurrent process identities", async (t) => {
  await t.test("sequential clock reversal and process variation", async () => {
    await withCorpusCopy(async (root) => {
      const caseFile = join(root, "cases", "positive", "idempotency", "retry-immediate", "case.json");
      const fixture = await readJson<{ invocations: Array<{ fixed_environment: Record<string, string> }> }>(caseFile);
      Object.assign(fixture.invocations[1]!.fixed_environment, {
        CASE_CLOCK: "2000-01-01T00:00:00Z",
        CASE_ID_SEED: "later-invocation",
        CASE_PROCESS_PID: "2002",
        CASE_PROCESS_STARTED_AT: "1999-12-31T23:59:59Z",
      });
      await writeJson(caseFile, fixture);

      const summary = await runCorpus(root);
      assert.equal(summary.failed, 0);
    });
  });
  await t.test("concurrent process identities reach their own workflow dependencies", async () => {
    await withCorpusCopy(async (root) => {
      const caseFile = join(root, "cases", "positive", "concurrency", "writer-same-basis", "case.json");
      const fixture = await readJson<{ invocations: Array<{ fixed_environment: Record<string, string> }> }>(caseFile);
      Object.assign(fixture.invocations[1]!.fixed_environment, {
        CASE_PROCESS_PID: "2002",
        CASE_PROCESS_STARTED_AT: "2026-09-04T03:00:01Z",
      });
      await writeJson(caseFile, fixture);
      let assertions: readonly string[] | undefined;
      const summary = await runCorpus(root, {
        onCaseAssertions: (caseId, observed) => { if (caseId === "writer-same-basis") assertions = observed; },
      });

      assert.equal(summary.failed, 0);
      assert.ok(assertions?.includes("identity-current:op-writer-a:pid=1001:started=2026-09-04T03:00:00Z"));
      assert.ok(assertions?.includes("identity-current:op-writer-b:pid=2002:started=2026-09-04T03:00:01Z"));
    });
  });
});

test("the Windows profile case executes the frozen public CLI and stays unsupported", async () => {
  if (process.platform !== "win32") return;
  let observed: { process_exit: number; result_code: string; stdout: string; stderr: string } | undefined;
  const summary = await runCorpus(corpusRoot, {
    onInvocationResult: (caseId, _index, result) => {
      if (caseId === "production-windows-unsupported") observed = result;
    },
  });
  assert.equal(summary.failed, 0);
  assert.ok(observed);
  assert.equal(observed.process_exit, 10);
  assert.equal(observed.result_code, "CASE_E_UNSUPPORTED_PROFILE");
  assert.equal(observed.stderr, "");
  assert.equal(observed.stdout.trim().split(/\r?\n/u).length, 1);
  assert.equal((JSON.parse(observed.stdout) as { code: string }).code, "CASE_E_UNSUPPORTED_PROFILE");
});

test("local evidence validation emits exact open-validate-read-close assertions", async () => {
  let assertions: readonly string[] | undefined;
  const summary = await runCorpus(corpusRoot, {
    onCaseAssertions: (caseId, observed) => {
      if (caseId === "evidence-current") assertions = observed;
    },
  });
  assert.equal(summary.failed, 0);
  assert.ok(assertions);

  const evidenceEvents = assertions
    .filter((assertion) => assertion.startsWith("storage:--json.dossier.check:") && assertion.includes("=evidence."))
    .sort((left, right) => Number(left.match(/:([0-9]+)=/u)?.[1]) - Number(right.match(/:([0-9]+)=/u)?.[1]));
  assert.ok(evidenceEvents.some((event) => event.endsWith("=evidence.open:artifact.txt")));
  assert.ok(evidenceEvents.some((event) => event.endsWith("=evidence.read:artifact.txt")));
  assert.ok(evidenceEvents.some((event) => event.endsWith("=evidence.stat:artifact.txt")));
  assert.ok(evidenceEvents.some((event) => event.endsWith("=evidence.close:artifact.txt")));
  const operations = evidenceEvents
    .filter((event) => /evidence\.(?:open|read|stat|close):artifact\.txt$/u.test(event))
    .map((event) => event.match(/=evidence\.([a-z]+):/u)?.[1]);
  assert.deepEqual(operations, ["open", "stat", "read", "close"]);
});

test("fixture timestamp semantics, stable arrays, and exact nesting depth fail closed", async (t) => {
  await t.test("impossible timestamp", async () => {
    await withCorpusCopy(async (root) => {
      const caseFile = join(root, "cases", "positive", "dossier", "dossier-create", "case.json");
      const fixture = await readJson<{ invocations: Array<{ fixed_environment: { CASE_CLOCK: string } }> }>(caseFile);
      fixture.invocations[0]!.fixed_environment.CASE_CLOCK = "2026-02-30T03:02:01Z";
      await writeJson(caseFile, fixture);
      await assert.rejects(runCorpus(root), /timestamp/u);
    });
  });
  await t.test("unstable rule order", async () => {
    await withCorpusCopy(async (root) => {
      const caseFile = join(root, "cases", "positive", "dossier", "dossier-create", "case.json");
      const fixture = await readJson<{ normative_rule_ids: string[] }>(caseFile);
      fixture.normative_rule_ids.reverse();
      await writeJson(caseFile, fixture);
      await assert.rejects(runCorpus(root), /stable order/u);
    });
  });
  await t.test("unstable profile order", async () => {
    await withCorpusCopy(async (root) => {
      const caseFile = join(root, "cases", "positive", "dossier", "dossier-create", "case.json");
      const fixture = await readJson<{ applicable_platform_profiles: string[] }>(caseFile);
      fixture.applicable_platform_profiles = ["production-windows-unsupported", "controlled-test"];
      await writeJson(caseFile, fixture);
      await assert.rejects(runCorpus(root), /stable order/u);
    });
  });
  await t.test("256 containers accepted and 257 rejected", async () => {
    await withCorpusCopy(async (root) => {
      const caseFile = join(root, "cases", "positive", "dossier", "dossier-create", "case.json");
      const fixture = await readJson<{ expected: Array<{ stdout_json_file: string | null }> }>(caseFile);
      const expectedFile = join(root, ...fixture.expected[0]!.stdout_json_file!.split("/"));
      await writeFile(expectedFile, `${"[".repeat(256)}null${"]".repeat(256)}`);
      assert.ok((await runCorpus(root)).failed > 0);
      await writeFile(expectedFile, `${"[".repeat(257)}null${"]".repeat(257)}`);
      await assert.rejects(runCorpus(root), /nesting exceeds 256/u);
    });
  });
});

test("all decoded prototype-related key spellings survive parsing and fail schema closure", async () => {
  for (const encodedKey of ["\\u005f\\u005fproto__", "\\u0063onstructor", "proto\\u0074ype"]) {
    await withCorpusCopy(async (root) => {
      const caseFile = join(root, "cases", "positive", "dossier", "dossier-create", "case.json");
      const source = await readFile(caseFile, "utf8");
      await writeFile(caseFile, source.replace("{", `{\"${encodedKey}\":true,`));
      await assert.rejects(runCorpus(root), /closed schema/u);
    });
  }
});

test("harness-owned Git state is immutable and derived-view network attempts turn red", async (t) => {
  await t.test("Git config mutation", async () => {
    await withCorpusCopy(async (root) => {
      let passed: boolean | undefined;
      const summary = await runCorpus(root, {
        onRepositoryReady: async (caseId, repositoryRoot) => {
          if (caseId === "dossier-create") await writeFile(join(repositoryRoot, ".git", "config"), "[core]\n\tbare = false\n");
        },
        onCaseResult: (caseId, ok) => { if (caseId === "dossier-create") passed = ok; },
      });
      assert.equal(passed, false);
      assert.ok(summary.failed > 0);
    });
  });
  await t.test("derived-view network", async () => {
    await withCorpusCopy(async (root) => {
      let passed: boolean | undefined;
      const summary = await runCorpus(root, {
        onBeforeDerivedView: async (caseId) => {
          if (caseId === "show-context-loss") {
            await new Promise<void>((resolvePromise) => lookup("localhost", () => resolvePromise()));
          }
        },
        onCaseResult: (caseId, ok) => { if (caseId === "show-context-loss") passed = ok; },
      });
      assert.equal(passed, false);
      assert.ok(summary.failed > 0);
    });
  });
  await t.test("delayed network during final hooks", async () => {
    await withCorpusCopy(async (root) => {
      let passed: boolean | undefined;
      const summary = await runCorpus(root, {
        onFinalTree: (caseId) => {
          if (caseId === "dossier-create") setImmediate(() => lookup("localhost", () => undefined));
        },
        onCaseResult: (caseId, ok) => { if (caseId === "dossier-create") passed = ok; },
      });
      assert.equal(passed, false);
      assert.ok(summary.failed > 0);
    });
  });
  await t.test("100ms-plus delayed DNS timer in a derived-view hook remains visible without sleeping", async () => {
    await withCorpusCopy(async (root) => {
      let passed: boolean | undefined;
      let delayed: NodeJS.Timeout | undefined;
      const summary = await runCorpus(root, {
        onBeforeDerivedView: (caseId) => {
          if (caseId === "show-context-loss") delayed = setTimeout(() => lookup("localhost", () => undefined), 60_000);
        },
        onCaseResult: (caseId, ok) => { if (caseId === "show-context-loss") passed = ok; },
      });
      if (delayed !== undefined) clearTimeout(delayed);
      assert.equal(passed, false);
      assert.ok(summary.failed > 0);
    });
  });
  await t.test("100ms-plus delayed DNS timer in a final-tree hook remains visible without sleeping", async () => {
    await withCorpusCopy(async (root) => {
      let passed: boolean | undefined;
      let delayed: NodeJS.Timeout | undefined;
      const summary = await runCorpus(root, {
        onFinalTree: (caseId) => {
          if (caseId === "walking-skeleton-offline") delayed = setTimeout(() => lookup("localhost", () => undefined), 60_000);
        },
        onCaseResult: (caseId, ok) => { if (caseId === "walking-skeleton-offline") passed = ok; },
      });
      if (delayed !== undefined) clearTimeout(delayed);
      assert.equal(passed, false);
      assert.ok(summary.failed > 0);
    });
  });
  await t.test("delayed DNS scheduled by the final assertion hook remains visible without sleeping", async () => {
    await withCorpusCopy(async (root) => {
      let passed: boolean | undefined;
      let delayed: NodeJS.Timeout | undefined;
      const summary = await runCorpus(root, {
        onCaseAssertions: (caseId) => {
          if (caseId === "dossier-create") delayed = setTimeout(() => lookup("localhost", () => undefined), 60_000);
        },
        onCaseResult: (caseId, ok) => { if (caseId === "dossier-create") passed = ok; },
      });
      if (delayed !== undefined) clearTimeout(delayed);
      assert.equal(passed, false);
      assert.ok(summary.failed > 0);
    });
  });
  await t.test("a continuation registered on a pre-existing unresolved promise is pending work", async () => {
    await withCorpusCopy(async (root) => {
      let releaseGate!: () => void;
      const gate = new Promise<void>((resolveGate) => { releaseGate = resolveGate; });
      let continuationFinished!: () => void;
      const finished = new Promise<void>((resolveFinished) => { continuationFinished = resolveFinished; });
      let passed: boolean | undefined;
      let summary;
      try {
        summary = await runCorpus(root, {
          onCaseAssertions: (caseId) => {
            if (caseId !== "dossier-create") return;
            void gate.then(() => lookup("localhost", () => continuationFinished()));
          },
          onCaseResult: (caseId, ok) => { if (caseId === "dossier-create") passed = ok; },
        });
        assert.equal(passed, false);
        assert.ok(summary.failed > 0);

        const cleanSummary = await runCorpus(root);
        assert.equal(cleanSummary.total, 139);
        assert.equal(cleanSummary.failed, 0);
        assert.deepEqual(cleanSummary.uncovered_positive, []);
        assert.deepEqual(cleanSummary.uncovered_negative, []);
      } finally {
        releaseGate();
        await finished;
      }
    });
  });
  await t.test("a bare unresolved promise with no registered continuation is not pending work", async () => {
    await withCorpusCopy(async (root) => {
      let barePromise: Promise<never> | undefined;
      let passed: boolean | undefined;
      const summary = await runCorpus(root, {
        onCaseAssertions: (caseId) => {
          if (caseId === "dossier-create") barePromise = new Promise<never>(() => undefined);
        },
        onCaseResult: (caseId, ok) => { if (caseId === "dossier-create") passed = ok; },
      });
      assert.ok(barePromise);
      assert.equal(passed, true);
      assert.equal(summary.failed, 0);
      assert.deepEqual(summary.uncovered_positive, []);
      assert.deepEqual(summary.uncovered_negative, []);
    });
  });
  await t.test("a forged private timer flag cannot hide live delayed DNS work", async () => {
    await withCorpusCopy(async (root) => {
      let targetTimer: NodeJS.Timeout | undefined;
      let passed: boolean | undefined;
      let summary;
      try {
        summary = await runCorpus(root, {
          onCaseAssertions: (caseId) => {
            if (caseId !== "walking-skeleton-offline") return;
            targetTimer = setTimeout(() => lookup("localhost", () => undefined), 50);
            (targetTimer as unknown as { _destroyed: boolean })._destroyed = true;
          },
          onCaseResult: (caseId, ok) => { if (caseId === "walking-skeleton-offline") passed = ok; },
        });
      } finally {
        if (targetTimer !== undefined) clearTimeout(targetTimer);
      }
      assert.equal(passed, false);
      assert.ok(summary.failed > 0);
    });
  });
  await t.test("honestly cancelled final-hook timers and immediates are already quiescent", async () => {
    await withCorpusCopy(async (root) => {
      let passed: boolean | undefined;
      const summary = await runCorpus(root, {
        onCaseAssertions: (caseId) => {
          if (caseId !== "dossier-create") return;
          const cancelledTimer = setTimeout(() => lookup("localhost", () => undefined), 60_000);
          const cancelledImmediate = setImmediate(() => lookup("localhost", () => undefined));
          clearTimeout(cancelledTimer);
          clearImmediate(cancelledImmediate);
        },
        onCaseResult: (caseId, ok) => { if (caseId === "dossier-create") passed = ok; },
      });
      assert.equal(passed, true);
      assert.equal(summary.failed, 0);
      assert.deepEqual(summary.uncovered_positive, []);
      assert.deepEqual(summary.uncovered_negative, []);
    });
  });
  await t.test("a real case-created TCP server is a network violation", async () => {
    await withCorpusCopy(async (root) => {
      let passed: boolean | undefined;
      let server: Server | undefined;
      const summary = await runCorpus(root, {
        onCaseAssertions: async (caseId) => {
          if (caseId !== "walking-skeleton-offline") return;
          server = createServer();
          await new Promise<void>((resolveListening, rejectListening) => {
            server!.once("error", rejectListening);
            server!.listen(0, "127.0.0.1", resolveListening);
          });
        },
        onCaseResult: (caseId, ok) => { if (caseId === "walking-skeleton-offline") passed = ok; },
      });
      assert.equal(passed, false);
      assert.ok(summary.failed > 0);
      assert.equal(server?.listening, false);
    });
  });
  await t.test("a real case-created DNS channel is a network violation", async () => {
    const sink = createSocket("udp4");
    await new Promise<void>((resolveListening, rejectListening) => {
      sink.once("error", rejectListening);
      sink.bind(0, "127.0.0.1", resolveListening);
    });
    try {
      await withCorpusCopy(async (root) => {
        let passed: boolean | undefined;
        let queryResult = "pending";
        const port = (sink.address() as AddressInfo).port;
        const summary = await runCorpus(root, {
          onCaseAssertions: (caseId) => {
            if (caseId !== "walking-skeleton-offline") return;
            const resolver = new Resolver();
            resolver.setServers([`127.0.0.1:${port}`]);
            resolver.resolve4("case-agent.invalid", (error) => {
              queryResult = error?.code ?? "unexpected-success";
            });
          },
          onCaseResult: (caseId, ok) => { if (caseId === "walking-skeleton-offline") passed = ok; },
        });
        await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));
        assert.equal(queryResult, "ECANCELLED");
        assert.equal(passed, false);
        assert.ok(summary.failed > 0);
      });
    } finally {
      await new Promise<void>((resolveClosed) => sink.close(() => resolveClosed()));
    }
  });
  await t.test("case-created PBKDF2 work that later starts DNS is rejected without sleeping", async () => {
    await withCorpusCopy(async (root) => {
      let passed: boolean | undefined;
      let started = false;
      let resolveDns!: () => void;
      let rejectDns!: (error: Error) => void;
      const dnsCompleted = new Promise<void>((resolvePromise, rejectPromise) => {
        resolveDns = resolvePromise;
        rejectDns = rejectPromise;
      });
      const summary = await runCorpus(root, {
        onCaseAssertions: (caseId) => {
          if (caseId !== "walking-skeleton-offline") return;
          started = true;
          pbkdf2("password", "salt", 1, 16, "sha256", (error) => {
            if (error !== null) {
              rejectDns(error);
              return;
            }
            lookup("localhost", () => resolveDns());
          });
        },
        onCaseResult: (caseId, ok) => { if (caseId === "walking-skeleton-offline") passed = ok; },
      });
      assert.equal(started, true);
      await dnsCompleted;
      assert.equal(passed, false);
      assert.ok(summary.failed > 0);
    });
  });
});

test("network handles created outside every case scope are not attributed to corpus execution", async () => {
  const resolver = new Resolver();
  resolver.setServers(["127.0.0.1"]);
  const server = createServer();
  await new Promise<void>((resolveListening, rejectListening) => {
    server.once("error", rejectListening);
    server.listen(0, "127.0.0.1", resolveListening);
  });
  try {
    const summary = await runCorpus(corpusRoot);
    assert.equal(summary.failed, 0);
    assert.deepEqual(summary.uncovered_positive, []);
    assert.deepEqual(summary.uncovered_negative, []);
  } finally {
    resolver.cancel();
    await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
  }
});

test("poisoned Timeout coercion cannot steal cleanup ownership from a red case", async () => {
  await withCorpusCopy(async (root) => {
    const timeoutIds = new WeakMap<object, number>();
    const destroyed = new Set<number>();
    const lifecycle = createHook({
      init: (asyncId, type, _triggerAsyncId, resource) => {
        if (type === "Timeout") timeoutIds.set(resource, asyncId);
      },
      destroy: (asyncId) => { destroyed.add(asyncId); },
    });
    lifecycle.enable();
    const originalClearTimeout = globalThis.clearTimeout;
    const baselineTimer = setTimeout(() => undefined, 60_000);
    const timeoutPrototype = Object.getPrototypeOf(baselineTimer) as object;
    const primitiveDescriptor = Object.getOwnPropertyDescriptor(timeoutPrototype, Symbol.toPrimitive);
    assert.ok(primitiveDescriptor);
    let caseTimer: NodeJS.Timeout | undefined;
    let casePassed: boolean | undefined;
    let poisonInstalled = false;
    try {
      const summary = await runCorpus(root, {
        onCaseStart: (caseId) => {
          if (caseId !== "walking-skeleton-offline") return;
          Object.defineProperty(timeoutPrototype, Symbol.toPrimitive, {
            ...primitiveDescriptor,
            value: () => { throw new Error("poisoned timer coercion"); },
          });
          globalThis.clearTimeout = (() => {
            originalClearTimeout(baselineTimer);
          }) as typeof clearTimeout;
          poisonInstalled = true;
        },
        onCaseAssertions: (caseId) => {
          if (caseId === "walking-skeleton-offline") {
            caseTimer = setTimeout(() => lookup("localhost", () => undefined), 50);
          }
        },
        onCaseResult: (caseId, passed) => {
          if (caseId !== "walking-skeleton-offline") return;
          casePassed = passed;
          globalThis.clearTimeout = originalClearTimeout;
          Object.defineProperty(timeoutPrototype, Symbol.toPrimitive, primitiveDescriptor);
          poisonInstalled = false;
        },
      });
      await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));
      assert.ok(caseTimer);
      const baselineAsyncId = timeoutIds.get(baselineTimer);
      const caseAsyncId = timeoutIds.get(caseTimer);
      assert.notEqual(baselineAsyncId, undefined);
      assert.notEqual(caseAsyncId, undefined);
      assert.equal(casePassed, false);
      assert.ok(summary.failed > 0);
      assert.equal(destroyed.has(baselineAsyncId!), false);
      assert.equal(destroyed.has(caseAsyncId!), true);
    } finally {
      if (poisonInstalled) {
        globalThis.clearTimeout = originalClearTimeout;
        Object.defineProperty(timeoutPrototype, Symbol.toPrimitive, primitiveDescriptor);
      }
      if (caseTimer !== undefined) originalClearTimeout(caseTimer);
      originalClearTimeout(baselineTimer);
      lifecycle.disable();
    }
  });
});

test("state-dependent oracles are revalidated after every final assertion hook turn", async (t) => {
  for (const mode of ["sync", "nextTick", "microtask", "git"] as const) {
    await t.test(mode, async () => {
      await withCorpusCopy(async (root) => {
        let repositoryRoot: string | undefined;
        let casePassed: boolean | undefined;
        const mutateRepository = (): void => {
          assert.ok(repositoryRoot);
          const target = mode === "git" ? join(repositoryRoot, ".git", "config") : join(repositoryRoot, "late-port-mutation.txt");
          writeFileSync(target, `${mode}\n`);
        };
        const summary = await runCorpus(root, {
          onRepositoryReady: (caseId, observedRoot) => {
            if (caseId === "dossier-create") repositoryRoot = observedRoot;
          },
          onCaseAssertions: (caseId) => {
            if (caseId !== "dossier-create") return;
            if (mode === "sync" || mode === "git") mutateRepository();
            else if (mode === "nextTick") process.nextTick(mutateRepository);
            else queueMicrotask(mutateRepository);
          },
          onCaseResult: (caseId, passed) => {
            if (caseId === "dossier-create") casePassed = passed;
          },
        });
        assert.equal(casePassed, false);
        assert.ok(summary.failed > 0);
      });
    });
  }
});

test("completed Immediate work is quiescent but its case-causal children remain audited", async (t) => {
  await t.test("a completed benign Immediate is quiescent", async () => {
    await withCorpusCopy(async (root) => {
      let immediateRan = false;
      let casePassed: boolean | undefined;
      const summary = await runCorpus(root, {
        onCaseAssertions: (caseId) => {
          if (caseId === "dossier-create") {
            setImmediate(() => { immediateRan = true; });
          }
        },
        onCaseResult: (caseId, passed) => {
          if (caseId === "dossier-create") casePassed = passed;
        },
      });
      assert.equal(immediateRan, true);
      assert.equal(casePassed, true);
      assert.equal(summary.failed, 0);
      assert.deepEqual(summary.uncovered_positive, []);
      assert.deepEqual(summary.uncovered_negative, []);
    });
  });

  await t.test("a completed Immediate cannot hide its pending child timer", async () => {
    await withCorpusCopy(async (root) => {
      let immediateRan = false;
      let childTimer: NodeJS.Timeout | undefined;
      let casePassed: boolean | undefined;
      try {
        const summary = await runCorpus(root, {
          onCaseAssertions: (caseId) => {
            if (caseId !== "walking-skeleton-offline") return;
            setImmediate(() => {
              immediateRan = true;
              childTimer = setTimeout(() => lookup("localhost", () => undefined), 60_000);
            });
          },
          onCaseResult: (caseId, passed) => {
            if (caseId === "walking-skeleton-offline") casePassed = passed;
          },
        });
        assert.equal(immediateRan, true);
        assert.equal(casePassed, false);
        assert.ok(summary.failed > 0);
      } finally {
        if (childTimer !== undefined) clearTimeout(childTimer);
      }
    });
  });
});

test("the runtime capability probe fails closed when Promise parent correlation is unavailable", async () => {
  const mutations = [
    { name: "missing-continuation-parent", parentExpression: "undefined" },
    { name: "invented-bare-parent", parentExpression: "parent === undefined ? promise : parent" },
  ] as const;
  for (const mutation of mutations) {
    const script = [
      'import { promiseHooks } from "node:v8";',
      "const originalCreateHook = promiseHooks.createHook;",
      "promiseHooks.createHook = (callbacks) => {",
      "  if (callbacks.init === undefined) return originalCreateHook(callbacks);",
      "  const originalInit = callbacks.init;",
      `  return originalCreateHook({ ...callbacks, init: (promise, parent) => originalInit(promise, ${mutation.parentExpression}) });`,
      "};",
      `const { runCorpus } = await import("./dist/src/conformance/runner.js?${mutation.name}");`,
      "try {",
      '  await runCorpus("./conformance");',
      '  process.stdout.write("unexpected success\\n");',
      "  process.exitCode = 1;",
      "} catch (error) {",
      '  const message = error instanceof Error ? error.message : String(error);',
      '  process.stdout.write(`${message}\\n`);',
      '  process.exitCode = message === "CASE_E_CONFORMANCE: Node 24 async lifecycle capability probe failed" ? 0 : 2;',
      "}",
    ].join("\n");
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const exit = await new Promise<number | null>((resolveExit, rejectExit) => {
      child.once("error", rejectExit);
      child.once("close", resolveExit);
    });
    assert.equal(exit, 0, mutation.name);
    assert.equal(
      Buffer.concat(stdout).toString("utf8"),
      "CASE_E_CONFORMANCE: Node 24 async lifecycle capability probe failed\n",
      mutation.name,
    );
    assert.equal(Buffer.concat(stderr).toString("utf8"), "", mutation.name);
  }
});

test("a runner port cannot replace Promise parent correlation after capability preflight", async () => {
  await withCorpusCopy(async (root) => {
    const originalCreateHook = promiseHooks.createHook;
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolveGate) => { releaseGate = resolveGate; });
    let continuationFinished!: () => void;
    const finished = new Promise<void>((resolveFinished) => { continuationFinished = resolveFinished; });
    let casePassed: boolean | undefined;
    let hookReplaced = false;
    try {
      const summary = await runCorpus(root, {
        onCaseStart: (caseId) => {
          if (caseId !== "dossier-create") return;
          promiseHooks.createHook = ((callbacks) => {
            if (callbacks.init === undefined) return originalCreateHook(callbacks);
            const originalInit = callbacks.init;
            return originalCreateHook({
              ...callbacks,
              init: (promise) => originalInit(promise, undefined as never),
            });
          }) as typeof promiseHooks.createHook;
          hookReplaced = true;
        },
        onCaseAssertions: (caseId) => {
          if (caseId === "dossier-create") {
            void gate.then(() => lookup("localhost", () => continuationFinished()));
          }
        },
        onCaseResult: (caseId, passed) => {
          if (caseId !== "dossier-create") return;
          casePassed = passed;
          promiseHooks.createHook = originalCreateHook;
          hookReplaced = false;
        },
      });
      assert.equal(casePassed, false);
      assert.ok(summary.failed > 0);
    } finally {
      if (hookReplaced) promiseHooks.createHook = originalCreateHook;
      releaseGate();
      await finished;
    }
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
