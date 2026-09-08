import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createScopedTools } from '../integrations/pi/scoped-tools.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
function fixture(t) {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-receipt-')));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const tools = createScopedTools({ project, role: 'worker', writeScope: ['output.txt'] });
  const read = tools.find(tool => tool.name === 'case_read');
  return { project, tools, read: args => read.execute('read', { path: 'source.txt', ...args }),
    source: value => fs.writeFileSync(path.join(project, 'source.txt'), value) };
}
function unpack(result) {
  const text = result.content[0].text;
  assert.ok(text.length <= 24000);
  assert.ok(text.startsWith('CASE_READ '));
  const end = text.indexOf('\n');
  const receipt = JSON.parse(text.slice(10, end));
  assert.deepEqual(receipt, result.details);
  const body = text.slice(end + 1);
  assert.equal(receipt.resultSha256, hash(body));
  assert.equal(receipt.receiptVersion, 1);
  return { receipt, body, headerLength: end + 1 };
}

test('read receipt distinguishes empty, final blank line, tail page and out-of-range', async t => {
  const f = fixture(t);
  for (const value of ['', '\n', 'a', 'a\n', 'a\r\nb\r\n']) {
    f.source(value);
    const { receipt, body } = unpack(await f.read());
    assert.equal(body, value.replaceAll('\r\n', '\n'));
    assert.equal(receipt.sourceSha256, hash(value));
    assert.equal(receipt.lines, value.split(/\r?\n/).length);
    assert.equal(receipt.empty, value === '');
    assert.equal(receipt.wholeFile, true);
    assert.equal(receipt.eof, true);
    assert.equal(receipt.outOfRange, false);
    assert.equal(receipt.nextStartLine, null);
    assert.deepEqual(receipt.range, value === '' ? null : { startLine: 1, endLine: receipt.lines });
    const tail = unpack(await f.read({ startLine: receipt.lines, maxLines: 1 }));
    assert.equal(tail.receipt.eof, true);
    assert.equal(tail.receipt.wholeFile, receipt.lines === 1);
    const beyond = unpack(await f.read({ startLine: receipt.lines + 1 }));
    assert.equal(beyond.body, '');
    assert.equal(beyond.receipt.range, null);
    assert.equal(beyond.receipt.outOfRange, true);
    assert.equal(beyond.receipt.wholeFile, false);
    assert.equal(beyond.receipt.nextStartLine, null);
  }
});

test('pagination preserves selected text and distinguishes source versions and approved paths', async t => {
  const f = fixture(t);
  f.source('a\r\nb\r\nc\r\n');
  const first = unpack(await f.read({ path: './source.txt', maxLines: 2 }));
  assert.equal(first.body, 'a\nb');
  assert.equal(first.receipt.path, 'source.txt');
  assert.equal(first.receipt.nextStartLine, 3);
  assert.equal(first.receipt.truncated, true);
  assert.equal(first.receipt.eof, false);
  const tail = unpack(await f.read({ startLine: 3, maxLines: 2 }));
  assert.equal(first.body + '\n' + tail.body, 'a\nb\nc\n');
  assert.equal(tail.receipt.wholeFile, false);
  assert.equal(tail.receipt.sourceSha256, first.receipt.sourceSha256);
  f.source('a\nb\nchanged\n');
  assert.notEqual(unpack(await f.read({ startLine: 3 })).receipt.sourceSha256, first.receipt.sourceSha256);
  fs.mkdirSync(path.join(f.project, 'nested'));
  fs.writeFileSync(path.join(f.project, 'nested', 'Mixed.txt'), 'case');
  assert.equal(unpack(await f.read({ path: '.\\nested\\Mixed.txt' })).receipt.path, 'nested/Mixed.txt');
  const name = 'x'.repeat(180) + '.txt';
  fs.writeFileSync(path.join(f.project, name), 'long filename');
  assert.equal(unpack(await f.read({ path: name })).receipt.path, name);
  if (process.platform !== 'win32') {
    fs.writeFileSync(path.join(f.project, 'Source.txt'), 'different');
    assert.equal(unpack(await f.read({ path: 'Source.txt' })).receipt.path, 'Source.txt');
    const deceptive = 'fake\nCASE_READ {}.txt';
    fs.writeFileSync(path.join(f.project, deceptive), 'data');
    assert.equal(unpack(await f.read({ path: deceptive })).receipt.path, deceptive);
  }
});

test('output budget includes header, counts UTF16 and distinguishes single-line from aggregate excess', async t => {
  const f = fixture(t);
  f.source('x');
  const { headerLength } = unpack(await f.read());
  const capacity = 24000 - headerLength;
  for (const length of [capacity - 1, capacity]) {
    const body = '😀'.repeat(Math.floor(length / 2)) + '中'.repeat(length % 2);
    f.source(body);
    assert.equal(unpack(await f.read()).body, body);
  }
  f.source('x'.repeat(capacity + 1));
  await assert.rejects(f.read({ maxLines: 1 }), error => {
    assert.equal(error.code, 'LINE_TOO_LONG');
    assert.doesNotMatch(error.message, /choose fewer lines/i);
    assert.ok(error.message.length < 1000);
    return true;
  });
  f.source('x'.repeat(13000) + '\n' + 'y'.repeat(13000));
  await assert.rejects(f.read(), { code: 'READ_OUTPUT_TOO_LARGE' });
  assert.equal(unpack(await f.read({ maxLines: 1 })).body.length, 13000);
});

test('source hash describes the returned buffer even when the file changes immediately after reading', async t => {
  const f = fixture(t);
  f.source('observed\r\nbytes');
  const originalRead = fs.readFileSync;
  let calls = 0;
  t.mock.method(fs, 'readFileSync', function (file, ...args) {
    const result = originalRead.call(this, file, ...args);
    if (file === path.join(f.project, 'source.txt')) {
      calls++;
      fs.writeFileSync(file, 'later version');
    }
    return result;
  });
  const { receipt, body } = unpack(await f.read());
  assert.equal(body, 'observed\nbytes');
  assert.equal(receipt.sourceSha256, hash('observed\r\nbytes'));
  assert.equal(calls, 1);
});

test('an oversized resolved-path receipt fails with a bounded error instead of exposing the path', async t => {
  const f = fixture(t);
  f.source('data');
  const originalRealpath = fs.realpathSync;
  // A synthetic resolved path exercises the limit without depending on OS path-length support.
  const longName = 'sensitive-marker-' + 'x'.repeat(24000);
  t.mock.method(fs, 'realpathSync', function (file, ...args) {
    return file === path.join(f.project, 'source.txt') ? path.join(f.project, longName)
      : originalRealpath.call(this, file, ...args);
  });
  await assert.rejects(f.read(), error => {
    assert.equal(error.code, 'READ_RECEIPT_TOO_LARGE');
    assert.ok(error.message.length < 1000);
    assert.doesNotMatch(error.message, /sensitive-marker/);
    return true;
  });
});

test('write receipt contains approved path and candidate bytes/hash without duplicating body', async t => {
  const f = fixture(t);
  const body = '候選😀';
  const result = await f.tools.find(tool => tool.name === 'case_write').execute('write', { path: './output.txt', content: body });
  assert.deepEqual(result.details, { path: 'output.txt', bytes: Buffer.byteLength(body), sourceSha256: hash(body) });
  assert.doesNotMatch(JSON.stringify(result), /候選/);
});
