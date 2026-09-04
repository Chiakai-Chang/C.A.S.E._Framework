#!/usr/bin/env node
const envelope = {
  ok: true,
  command: "version",
  code: "CASE_OK",
  message: "case-agent 0.1.0-preview",
  data: { version: "0.1.0-preview" },
  remediation: null,
};

if (process.argv.includes("--version")) {
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
  process.exitCode = 0;
} else {
  process.stderr.write("case-agent: command required\n");
  process.exitCode = 2;
}
