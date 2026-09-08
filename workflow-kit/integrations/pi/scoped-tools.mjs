import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isProtectedMaterialPart } from '../../skills/case-workflow/scripts/core/io.mjs';

const fail = message => { throw Object.assign(new Error(message), { code: 'UNSAFE_TOOL_PATH' }); };
const schema = properties => ({ type: 'object', properties, required: Object.keys(properties).filter(k => !['startLine', 'maxLines'].includes(k)), additionalProperties: false });
const string = description => ({ type: 'string', description });
const content = (text, details = {}) => ({ content: [{ type: 'text', text }], details });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readError = (code, message) => { throw Object.assign(new Error(message), { code }); };
const readLimit = 24000; // UTF-16 code units, including the model-visible receipt.

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
    name: 'case_read', label: 'Read project material', description: 'Read a project file. CASE_READ receipt states source, returned lines and EOF; EOF alone does not mean the whole file was read. Large results require explicit line pagination. Text including receipt is limited to 24000 UTF-16 units; oversized single lines cannot be paged by this tool.',
    parameters: schema({ path: string('Relative file path'), startLine: { type: 'integer', minimum: 1 }, maxLines: { type: 'integer', minimum: 1, maximum: 200 } }),
    async execute(_id, args) {
      const file = resolve(args.path);
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > 1024 * 1024) fail('Expected a regular file of at most 1 MiB; pre-process larger data');
      const start = args.startLine ?? 1;
      const count = args.maxLines ?? 200;
      if (!Number.isInteger(start) || start < 1 || !Number.isInteger(count) || count < 1 || count > 200) fail('Invalid line range');
      const bytes = fs.readFileSync(file);
      if (bytes.length > 1024 * 1024) fail('Expected a regular file of at most 1 MiB; pre-process larger data');
      const lines = bytes.toString('utf8').split(/\r?\n/);
      const sourceSha256 = sha256(bytes);
      const relative = path.relative(root, fs.realpathSync(file)).split(path.sep).join('/');
      const makePage = (pageStart, pageCount) => {
        const empty = bytes.length === 0;
        const outOfRange = pageStart > lines.length;
        const end = Math.min(pageStart - 1 + pageCount, lines.length);
        const body = lines.slice(pageStart - 1, end).join('\n');
        const more = pageStart - 1 + pageCount < lines.length;
        const details = { lines: lines.length, startLine: pageStart, truncated: more,
          receiptVersion: 1, path: relative, sourceSha256, resultSha256: sha256(body),
          range: empty || outOfRange ? null : { startLine: pageStart, endLine: end },
          eof: !more, wholeFile: pageStart === 1 && !more && !outOfRange,
          empty, outOfRange, nextStartLine: more ? end + 1 : null };
        return { body, details, header: `CASE_READ ${JSON.stringify(details)}\n` };
      };
      const page = makePage(start, count);
      if (page.header.length > readLimit) readError('READ_RECEIPT_TOO_LARGE', 'Read receipt exceeds the output budget. This source path cannot be represented by this tool; use the existing discovery process for required material preparation.');
      if (page.header.length + page.body.length > readLimit) {
        // Distinguish an impossible line-page retry from a recoverable aggregate limit.
        for (let line = start; line <= Math.min(start - 1 + count, lines.length); line++) {
          const single = makePage(line, 1);
          if (single.header.length + single.body.length > readLimit)
            readError('LINE_TOO_LONG', 'A selected line cannot fit with its receipt in 24000 UTF-16 units. Line pagination cannot recover it. Do not change frozen sources or run unapproved preprocessing; report the material limitation through the existing discovery process.');
        }
        readError('READ_OUTPUT_TOO_LARGE', 'Selected lines plus receipt exceed 24000 UTF-16 units; choose fewer lines with maxLines. No source text was returned or silently shortened.');
      }
      return content(page.header + page.body, page.details);
    },
  }, {
    name: 'case_list', label: 'List project material', description: role === 'planner'
      ? 'Get a shallow material index (names, file/directory kinds, byte sizes), without loading file bodies. Use it to locate inputs and choose inline/indexed delivery. It does not establish relevance, source facts or permission. Protected settings and links are excluded; complete means this visible directory only. At most 300 entries and 24000 UTF-16 units; narrow the directory if oversized.'
      : 'List one directory, excluding agent settings and CASE state. No recursive dumping.',
    parameters: schema({ path: string('Relative directory, or .') }),
    async execute(_id, args) {
      const entries = fs.readdirSync(resolve(args.path), { withFileTypes: true })
        .filter(e => !isProtectedMaterialPart(e.name) && !e.isSymbolicLink());
      if (entries.length > 300) fail('Directory has more than 300 entries; use a narrower material index');
      if (role === 'planner') {
        const index = {path:path.relative(root,resolve(args.path)).split(path.sep).join('/') || '.',complete:true,recursive:false,
          entries:entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0).map(e=>({name:e.name,
            kind:e.isFile()?'file':e.isDirectory()?'directory':'other',
            bytes:e.isFile()?fs.statSync(resolve(path.posix.join(args.path.replaceAll('\\','/'),e.name))).size:null}))};
        const text=JSON.stringify(index);
        if(text.length>24000)readError('MATERIAL_INDEX_TOO_LARGE','Material index exceeds 24000 UTF-16 units; use a narrower directory or report the material organization limitation. No partial index was returned.');
        return content(text);
      }
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
      const bytes = Buffer.from(args.content, 'utf8');
      fs.writeFileSync(file, bytes, { flag: 'w' });
      return content(`Wrote ${args.path}`, { path: path.relative(root, fs.realpathSync(file)).split(path.sep).join('/'),
        bytes: bytes.length, sourceSha256: sha256(bytes) });
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
