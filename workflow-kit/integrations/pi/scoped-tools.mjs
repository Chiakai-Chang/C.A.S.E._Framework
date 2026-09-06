import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { isProtectedMaterialPart } from '../../skills/case-workflow/scripts/core/io.mjs';

const fail = message => { throw Object.assign(new Error(message), { code: 'UNSAFE_TOOL_PATH' }); };
const schema = properties => ({ type: 'object', properties, required: Object.keys(properties).filter(k => !['startLine', 'maxLines'].includes(k)), additionalProperties: false });
const string = description => ({ type: 'string', description });
const content = (text, details = {}) => ({ content: [{ type: 'text', text }], details });

export function createScopedTools({ project, role, writeScope = [], checks = {} }) {
  const root = fs.realpathSync(project);
  function resolve(relative, write = false) {
    if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes(':') || relative.includes('\0')) fail('Use a relative project path');
    const parts = relative.replaceAll('\\', '/').split('/').filter(p => p !== '.');
    if (parts.some(p => p === '..' || isProtectedMaterialPart(p))) fail('Path escapes the permitted project data');
    if (write && ['agents.md', 'claude.md', 'gemini.md'].includes(parts.at(-1)?.toLowerCase())) fail('Agent instructions are not worker deliverables');
    const target = path.resolve(root, ...parts);
    for (let current = target; current !== root; current = path.dirname(current)) {
      if (!current.startsWith(root + path.sep)) fail('Path escapes project');
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail('Symbolic links are not followed');
    }
    if (write && !writeScope.some(scope => {
      const allowed = resolve(scope);
      return target === allowed || ((!fs.existsSync(allowed) || fs.statSync(allowed).isDirectory()) && target.startsWith(allowed + path.sep));
    })) fail(`Write is outside packet writeScope. Requested: ${JSON.stringify(relative)}. Allowed: ${JSON.stringify(writeScope)}. Use a declared path; do not retry the same rejected path.`);
    return target;
  }
  const tools = [{
    name: 'case_read', label: 'Read project material', description: 'Read a project file. Large results require explicit line pagination.',
    parameters: schema({ path: string('Relative file path'), startLine: { type: 'integer', minimum: 1 }, maxLines: { type: 'integer', minimum: 1, maximum: 200 } }),
    async execute(_id, args) {
      const file = resolve(args.path);
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > 1024 * 1024) fail('Expected a regular file of at most 1 MiB; pre-process larger data');
      const start = args.startLine ?? 1;
      const count = args.maxLines ?? 200;
      if (!Number.isInteger(start) || start < 1 || !Number.isInteger(count) || count < 1 || count > 200) fail('Invalid line range');
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      const selected = lines.slice(start - 1, start - 1 + count).join('\n');
      if (selected.length > 24000) fail('Selected lines exceed output budget; choose fewer lines');
      const more = start - 1 + count < lines.length;
      return content(selected + (more ? `\n[More material: continue at line ${start + count}]` : ''), { lines: lines.length, startLine: start, truncated: more });
    },
  }, {
    name: 'case_list', label: 'List project material', description: 'List one directory, excluding agent settings and CASE state. No recursive dumping.',
    parameters: schema({ path: string('Relative directory, or .') }),
    async execute(_id, args) {
      const entries = fs.readdirSync(resolve(args.path), { withFileTypes: true })
        .filter(e => !isProtectedMaterialPart(e.name) && !e.isSymbolicLink());
      if (entries.length > 300) fail('Directory has more than 300 entries; use a narrower material index');
      return content(entries.map(e => e.name + (e.isDirectory() ? '/' : '')).join('\n'));
    },
  }];
  if (role === 'worker') tools.push({
    name: 'case_write', label: 'Write declared deliverable', description: 'Write a complete UTF-8 file inside the packet writeScope. Cannot change agent settings or CASE records.',
    parameters: schema({ path: string('Declared relative deliverable path'), content: string('Complete file contents') }),
    async execute(_id, args) {
      const file = resolve(args.path, true);
      if (typeof args.content !== 'string' || Buffer.byteLength(args.content) > 1024 * 1024) fail('Content must be text of at most 1 MiB');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      resolve(args.path, true);
      fs.writeFileSync(file, args.content, { encoding: 'utf8', flag: 'w' });
      return content(`Wrote ${args.path}`);
    },
  });
  if (Object.keys(checks).length) tools.push({
    name: 'case_check', label: 'Run approved check', description: `Run an operator-configured check by ID; no shell commands or arguments may be supplied. IDs: ${Object.keys(checks).join(', ')}`,
    parameters: schema({ id: string('Approved check ID') }),
    async execute(_id, args, signal) {
      if (!Object.hasOwn(checks, args.id)) throw Object.assign(new Error('Unknown check ID'), { code: 'CHECK_NOT_APPROVED' });
      const check = checks[args.id];
      if (typeof check.command !== 'string' || !Array.isArray(check.args) || check.args.some(a => typeof a !== 'string')) throw new Error('Invalid operator check configuration');
      const timeoutMs = check.timeoutMs ?? 30000;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw Object.assign(new Error('Check timeoutMs must be a positive integer'), { code: 'INVALID_CHECK_CONFIG' });
      return await new Promise(resolveResult => {
        execFile(check.command, check.args, { cwd: root, shell: false, windowsHide: true, signal,
          timeout: Math.min(timeoutMs, 120000), maxBuffer: 256 * 1024 }, (error, stdout, stderr) => {
          const exitCode = error ? (typeof error.code === 'number' ? error.code : null) : 0;
          const details = { id: args.id, exitCode, error: error?.message ?? null, stdout, stderr };
          resolveResult(content(JSON.stringify(details), details));
        });
      });
    },
  });
  return tools;
}
