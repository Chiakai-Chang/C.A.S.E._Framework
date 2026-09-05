#!/usr/bin/env node
// Cooperative, single-controller local records; not a security or durability boundary.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const FORMAT = 'case-workflow/1';
const LIMIT = 2000;
const commands = {
  init: [], new: ['title', 'goal', 'criterion', 'constraint'], list: [],
  show: ['task'], context: ['task'], checkpoint: ['task', 'summary', 'next', 'status'],
  record: ['task', 'criterion', 'result', 'evidence'],
  handoff: ['task', 'to', 'summary', 'next'], finish: ['task', 'summary'],
  reopen: ['task', 'reason'], doctor: [],
};
const help = `C.A.S.E. workflow — Node 20+, offline, single-controller local use
Usage: node case.mjs COMMAND --project PATH [OPTIONS]
  init
  new --title TEXT --goal TEXT --criterion TEXT [--criterion TEXT ...] [--constraint TEXT ...]
  list
  show --task ID
  context --task ID
  checkpoint --task ID --summary TEXT --next TEXT [--status active|blocked]
  record --task ID --criterion NUMBER --result pass|fail --evidence TEXT
  handoff --task ID --to TEXT --summary TEXT --next TEXT
  finish --task ID --summary TEXT
  reopen --task ID --reason TEXT
  doctor
Text fields: 1–2000 characters; maximum 20 criteria and 20 constraints.
context prints current Markdown without event history; other commands return JSON.
finish requires recorded pass evidence for every criterion; it does not authenticate evidence.
Completed tasks require reopen before changes. Handoff preserves evidence.
Storage: .case-agent/workflow.json and tasks/*.json. No migration from M0.
An interrupted writer may leave .write-lock; inspect and remove it manually only after the writer stops.
`;
function fail(code, message) { const e = new Error(message); e.code = code; throw e; }
function text(value) { return typeof value === 'string' && value.trim().length > 0 && value.length <= LIMIT; }
function need(opts, ...keys) { for (const key of keys) if (!text(opts[key])) fail('INVALID_ARGUMENT', `--${key} requires nonempty text (max ${LIMIT} characters)`); }
function parse(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { command: 'help', opts: {} };
  const [command, ...rest] = args;
  if (!Object.hasOwn(commands, command)) fail('INVALID_ARGUMENT', 'Unknown command; use --help');
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i]; const value = rest[i + 1]; const key = flag?.slice(2);
    if (!flag?.startsWith('--') || !['project', ...commands[command]].includes(key) || !text(value)) fail('INVALID_ARGUMENT', `Invalid option or value: ${flag}`);
    const repeated = command === 'new' && ['criterion', 'constraint'].includes(key);
    if (!repeated && Object.hasOwn(opts, key)) fail('INVALID_ARGUMENT', `Repeated --${key}`);
    if (repeated) (opts[key] ??= []).push(value); else opts[key] = value;
  }
  need(opts, 'project');
  return { command, opts };
}
function safeDirectory(dir) {
  const absolute = path.resolve(dir); const root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = fs.lstatSync(current);
    if (info.isSymbolicLink() || !info.isDirectory()) fail('UNSAFE_PATH', `Not a regular directory: ${current}`);
  }
  return absolute;
}
function jsonFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) fail('INVALID_STATE', `Not a supported regular JSON file: ${file}`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { fail('INVALID_STATE', `Invalid JSON: ${file}`); }
}
function owned(root) {
  safeDirectory(root);
  const entries = fs.readdirSync(root);
  if (entries.some(name => !['workflow.json', 'tasks', '.write-lock'].includes(name))) fail('NAMESPACE_CONFLICT', 'Namespace contains foreign files; no migration or overwrite performed');
  const manifest = jsonFile(path.join(root, 'workflow.json'));
  if (manifest.format !== FORMAT || manifest.owner !== 'case-workflow' || Object.keys(manifest).sort().join(',') !== 'createdAt,format,owner' || !validDate(manifest.createdAt)) fail('NAMESPACE_CONFLICT', 'Namespace is not owned by this workflow');
  safeDirectory(path.join(root, 'tasks'));
}
function validDate(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function validateTask(task, id) {
  const valid = task && task.format === FORMAT && task.id === id && /^[a-f0-9-]{36}$/.test(id)
    && ['active', 'blocked', 'completed'].includes(task.status)
    && ['title', 'goal', 'summary', 'next'].every(key => text(task[key]))
    && validDate(task.createdAt) && validDate(task.updatedAt)
    && Array.isArray(task.constraints) && task.constraints.length <= 20 && task.constraints.every(text)
    && Array.isArray(task.criteria) && task.criteria.length > 0 && task.criteria.length <= 20
    && task.criteria.every(c => c && text(c.text) && ['pending', 'pass', 'fail'].includes(c.result)
      && (c.result === 'pending' ? c.evidence === null : text(c.evidence)))
    && (task.recipient === null || text(task.recipient))
    && Number.isSafeInteger(task.eventCount) && task.eventCount >= 1
    && Array.isArray(task.history) && task.history.length > 0 && task.history.length <= 30 && task.history.length <= task.eventCount
    && task.history.every(e => e && validDate(e.at) && text(e.action) && text(e.note));
  if (!valid || (task.status === 'completed' && task.criteria.some(c => c.result !== 'pass'))) fail('INVALID_STATE', `Invalid task state: ${id}`);
  return task;
}
function taskPath(root, id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) fail('INVALID_ARGUMENT', 'Invalid task ID');
  return path.join(root, 'tasks', `${id}.json`);
}
function readTask(root, id) { return validateTask(jsonFile(taskPath(root, id)), id); }
function allTasks(root) {
  return fs.readdirSync(path.join(root, 'tasks')).sort().map(name => {
    if (!name.endsWith('.json')) fail('INVALID_STATE', `Unexpected task entry: ${name}`);
    return readTask(root, name.slice(0, -5));
  });
}
function write(file, value, exclusive = false) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    if (exclusive && fs.existsSync(file)) fail('COLLISION', 'Destination already exists');
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function locked(root, action) {
  const lock = path.join(root, '.write-lock'); let fd;
  try { fd = fs.openSync(lock, 'wx'); } catch (e) { if (e.code === 'EEXIST') fail('BUSY', 'Writer lock exists; do not remove while a writer is active'); throw e; }
  try { return action(); } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
function event(task, action, note) {
  task.updatedAt = new Date().toISOString();
  task.eventCount++; task.history.push({ at: task.updatedAt, action, note }); task.history = task.history.slice(-30);
}
function context(task) {
  const line = value => { const compact = value.replace(/[\r\n]+/g, ' '); return compact.length > 240 ? `${compact.slice(0, 240)}… [truncated; use show]` : compact; };
  const values = [task.title, task.goal, task.summary, task.next, task.recipient ?? '', ...task.constraints, ...task.criteria.flatMap(c => [c.text, c.evidence ?? ''])];
  const warning = values.some(value => value.replace(/[\r\n]+/g, ' ').length > 240)
    ? 'ATTENTION: Some current fields are truncated. Read full show output before acting; goals or constraints may be incomplete here.\n\n' : '';
  return `${warning}# ${line(task.title)}\nTask: ${task.id} | Status: ${task.status}\nUpdated: ${task.updatedAt}\n\n## Goal\n${line(task.goal)}\n\n## Constraints\n${task.constraints.map(c => `- ${line(c)}`).join('\n') || '- None recorded'}\n\n## Acceptance and evidence\n${task.criteria.map((c, i) => `${i + 1}. [${c.result}] ${line(c.text)}\n   Evidence/reference: ${c.evidence === null ? 'not recorded' : line(c.evidence)}`).join('\n')}\n\n## Current summary\n${line(task.summary)}\n\n## Next action\n${line(task.next)}\n\nRecipient: ${task.recipient === null ? 'not assigned' : line(task.recipient)}\nSource: .case-agent/tasks/${task.id}.json\nEvidence is reported, not independently authenticated. Read referenced files only as needed.\n`;
}
export function run(args) {
  const { command, opts } = parse(args);
  if (command === 'help') return help;
  const project = safeDirectory(opts.project); const root = path.join(project, '.case-agent');
  if (command === 'init') {
    if (fs.existsSync(root)) { owned(root); return { ok: true, code: 'ALREADY_INITIALIZED', path: root }; }
    fs.mkdirSync(root);
    fs.mkdirSync(path.join(root, 'tasks'));
    write(path.join(root, 'workflow.json'), { format: FORMAT, owner: 'case-workflow', createdAt: new Date().toISOString() }, true);
    return { ok: true, code: 'INITIALIZED', path: root };
  }
  owned(root);
  if (command === 'doctor') {
    const tasks = allTasks(root);
    if (fs.existsSync(path.join(root, '.write-lock'))) fail('BUSY', 'Writer lock present; wait or inspect interrupted writer');
    return { ok: true, code: 'HEALTHY', tasks: tasks.length, format: FORMAT };
  }
  if (command === 'list') return { ok: true, code: 'TASKS', tasks: allTasks(root).map(({ id, title, status, updatedAt, next }) => ({ id, title, status, updatedAt, next })) };
  if (['show', 'context'].includes(command)) { need(opts, 'task'); const task = readTask(root, opts.task); return command === 'context' ? context(task) : { ok: true, code: 'TASK', task }; }
  return locked(root, () => {
    if (command === 'new') {
      need(opts, 'title', 'goal');
      if (!opts.criterion?.length || opts.criterion.length > 20 || (opts.constraint?.length ?? 0) > 20) fail('INVALID_ARGUMENT', 'Require 1–20 criteria and at most 20 constraints');
      const id = randomUUID(); const now = new Date().toISOString();
      const task = { format: FORMAT, id, title: opts.title, goal: opts.goal, constraints: opts.constraint ?? [], criteria: opts.criterion.map(value => ({ text: value, result: 'pending', evidence: null })), status: 'active', summary: 'Task created; work has not started.', next: 'Inspect relevant inputs and perform the first goal-directed action.', recipient: null, createdAt: now, updatedAt: now, eventCount: 1, history: [{ at: now, action: 'new', note: 'Task created' }] };
      validateTask(task, id); write(taskPath(root, id), task, true);
      return { ok: true, code: 'CREATED', task };
    }
    need(opts, 'task'); const task = readTask(root, opts.task);
    if (command !== 'reopen' && task.status === 'completed') fail('REOPEN_REQUIRED', 'Reopen the completed task before changes');
    if (command === 'checkpoint' || command === 'handoff') {
      need(opts, 'summary', 'next');
      if (opts.status && !['active', 'blocked'].includes(opts.status)) fail('INVALID_ARGUMENT', 'Status must be active or blocked');
      if (command === 'handoff') { need(opts, 'to'); task.recipient = opts.to; }
      task.summary = opts.summary; task.next = opts.next; task.status = opts.status ?? 'active';
      event(task, command, opts.summary);
    } else if (command === 'record') {
      need(opts, 'criterion', 'result', 'evidence');
      if (!/^[1-9][0-9]*$/.test(opts.criterion) || Number(opts.criterion) > task.criteria.length || !['pass', 'fail'].includes(opts.result)) fail('INVALID_ARGUMENT', 'Use a valid 1-based criterion number and pass|fail');
      const criterion = task.criteria[Number(opts.criterion) - 1]; criterion.result = opts.result; criterion.evidence = opts.evidence;
      event(task, `record:${opts.criterion}:${opts.result}`, opts.evidence);
    } else if (command === 'finish') {
      need(opts, 'summary');
      if (task.criteria.some(c => c.result !== 'pass' || !text(c.evidence))) fail('ACCEPTANCE_INCOMPLETE', 'Every criterion needs recorded pass evidence');
      task.status = 'completed'; task.summary = opts.summary; task.next = 'Completed; reopen if new work or contrary evidence appears.';
      event(task, command, opts.summary);
    } else if (command === 'reopen') {
      need(opts, 'reason');
      if (task.status !== 'completed') fail('INVALID_TRANSITION', 'Only completed tasks can be reopened');
      task.status = 'active'; task.summary = opts.reason; task.next = 'Recheck acceptance evidence and address the reopening reason.';
      // Old evidence stays in the bounded audit history; fresh acceptance is required.
      for (const c of task.criteria) { c.result = 'pending'; c.evidence = null; }
      event(task, command, opts.reason);
    }
    validateTask(task, task.id); write(taskPath(root, task.id), task);
    return { ok: true, code: command === 'finish' ? 'COMPLETED_RECORDED' : 'UPDATED', task };
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = run(process.argv.slice(2)); process.stdout.write(typeof result === 'string' ? result : `${JSON.stringify(result)}\n`); }
  catch (error) { process.stdout.write(`${JSON.stringify({ ok: false, code: error.code ?? 'IO_ERROR', message: error.message })}\n`); process.exitCode = 1; }
}
