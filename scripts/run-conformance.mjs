import { writeSync } from "node:fs";
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
  writeSync(2, `${error instanceof Error ? error.message : "CASE_E_CONFORMANCE: corpus startup failed"}\n`);
}

writeSync(1, `${JSON.stringify(summary)}\n`);
const failed = summary.failed !== 0
  || summary.uncovered_positive.length !== 0
  || summary.uncovered_negative.length !== 0;
// The formal command is a bounded process boundary. The in-process audit can
// report unknown case-created handles but does not pretend it can safely close
// every possible Node resource; synchronous output is complete before exit.
process.exit(failed ? 1 : 0);
