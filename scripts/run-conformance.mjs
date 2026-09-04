import { join } from "node:path";
import { runCorpus } from "../dist/src/conformance/runner.js";

let summary;
try {
  summary = await runCorpus(join(process.cwd(), "conformance"));
} catch (error) {
  summary = {
    total: 0,
    passed: 0,
    failed: 1,
    uncovered_positive: [],
    uncovered_negative: [],
  };
  process.stderr.write(`${error instanceof Error ? error.message : "CASE_E_CONFORMANCE: corpus startup failed"}\n`);
}

process.stdout.write(`${JSON.stringify(summary)}\n`);
if (summary.failed !== 0 || summary.uncovered_positive.length !== 0 || summary.uncovered_negative.length !== 0) {
  process.exitCode = 1;
}
