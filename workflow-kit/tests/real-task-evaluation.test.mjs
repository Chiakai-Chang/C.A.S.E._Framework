import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gradeRealTask, expectedMap, sourceFiles, sourceDirectory, task } from '../evaluation/real-task-spec.mjs';

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'case-real-grade-'));
  for (const f of sourceFiles) fs.copyFileSync(path.join(sourceDirectory, f), path.join(root, f));
  fs.writeFileSync(path.join(root, 'requirements.md'), task);
  fs.writeFileSync(path.join(root, 'adoption-map.json'), JSON.stringify(expectedMap));
  return root;
}
test('accepts the complete frozen-source map and rejects unsupported agy claims', () => {
  const root = project();
  assert.equal(gradeRealTask(root).passed, true);
  const wrong = structuredClone(expectedMap);
  wrong.support.antigravitySessionTested = true;
  fs.writeFileSync(path.join(root, 'adoption-map.json'), JSON.stringify(wrong));
  assert.equal(gradeRealTask(root).passed, false);
  assert.ok(gradeRealTask(root).mismatches.includes('support'));
});
test('rejects missing or extra fields and malformed output', () => {
  const root = project();
  const wrong = structuredClone(expectedMap);
  delete wrong.install.backupRoots;
  fs.writeFileSync(path.join(root, 'adoption-map.json'), JSON.stringify(wrong));
  assert.equal(gradeRealTask(root).passed, false);
  fs.writeFileSync(path.join(root, 'adoption-map.json'), JSON.stringify({...expectedMap, fabricated: true}));
  assert.equal(gradeRealTask(root).passed, false);
  fs.writeFileSync(path.join(root, 'adoption-map.json'), '{');
  assert.equal(gradeRealTask(root).passed, false);
});
test('rejects source edits even when the artifact is correct', () => {
  const root = project();
  fs.appendFileSync(path.join(root, 'install.mjs'), '\n// edited\n');
  const result = gradeRealTask(root);
  assert.equal(result.artifactPassed, true);
  assert.equal(result.sourcesUnchanged, false);
  assert.equal(result.passed, false);
});
test('rejects extra output files even when requested JSON is correct', () => {
  const root = project();
  fs.writeFileSync(path.join(root, 'README.md'), 'placeholder');
  assert.equal(gradeRealTask(root).passed, false);
});
test('rejects modified task instructions even when requested JSON is correct', () => {
  const root = project();
  fs.writeFileSync(path.join(root, 'requirements.md'), 'placeholder');
  assert.equal(gradeRealTask(root).passed, false);
});
