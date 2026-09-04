import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lookup } from "node:dns";
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
      if (caseId === "human-show-20" || caseId === "human-show-21") output.set(caseId, result.stdout);
    },
  });
  assert.equal(summary.failed, 0);

  const twenty = output.get("human-show-20");
  const twentyOne = output.get("human-show-21");
  assert.ok(twenty);
  assert.ok(twentyOne);
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
    assert.match(rendered, /^warnings: none$/mu);
    assert.equal(rendered.split("\n").filter((line) => line.startsWith("criterion: ")).length, 20);
  }
  assert.match(twenty, /^title: Bounded human view 20$/mu);
  assert.match(twenty, /^criterion: criterion-20 = failed$/mu);
  assert.match(twentyOne, /^title: Bounded human view 21$/mu);
  assert.doesNotMatch(twentyOne, /criterion: criterion-21/u);
  assert.doesNotMatch(twentyOne, /evidence gaps: .*criterion-21/u);
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
