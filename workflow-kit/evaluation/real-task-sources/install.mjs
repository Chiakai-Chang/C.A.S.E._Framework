#!/usr/bin/env node
import { mkdir, lstat, readdir, readFile, writeFile, rename, rm, rmdir } from 'node:fs/promises';
import { resolve, join, dirname, parse } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const SOURCE = fileURLToPath(new URL('./skills/case-workflow/', import.meta.url));
const MARKER = '.case-install.json';
const FORMAT = 'case-workflow-install/1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };

async function exists(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function safeDirectory(path, required = false) {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    const stat = await exists(current);
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) fail(`Expected an ordinary directory: ${current}`);
    if (!stat && required) fail(`Directory does not exist: ${current}`);
  }
}

async function fileMap(directory, prefix = '') {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === MARKER && !prefix) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) fail(`Linked skill content is not supported: ${path}`);
    if (entry.isDirectory()) Object.assign(result, await fileMap(path, relative));
    else if (entry.isFile()) result[relative] = await readFile(path);
    else fail(`Unsupported skill content: ${path}`);
  }
  return result;
}

function digestMap(files) {
  return Object.fromEntries(Object.keys(files).sort().map(path => [path, hash(files[path])]));
}

async function inspectInstalled(destination) {
  if (!await exists(destination)) return null;
  await safeDirectory(destination, true);
  const marker = join(destination, MARKER);
  const stat = await exists(marker);
  if (!stat?.isFile() || stat.isSymbolicLink()) fail(`Foreign or incomplete installation: ${destination}`);
  let metadata;
  try { metadata = JSON.parse(await readFile(marker, 'utf8')); } catch { fail(`Invalid installation manifest: ${destination}`); }
  if (metadata.format !== FORMAT || !metadata.files || typeof metadata.files !== 'object' || Array.isArray(metadata.files)) fail(`Unknown installation owner: ${destination}`);
  const actual = digestMap(await fileMap(destination));
  const expected = Object.fromEntries(Object.entries(metadata.files).sort(([a], [b]) => a.localeCompare(b, 'en')));
  if (JSON.stringify(Object.keys(actual).sort().map(k => [k, actual[k]])) !== JSON.stringify(Object.keys(expected).sort().map(k => [k, expected[k]]))) {
    fail(`Installation was edited; preserve or move your custom copy before retrying: ${destination}`);
  }
  return actual;
}

export async function installSkill({ project, host = 'all', update = false, uninstall = false, source = SOURCE }) {
  if (!['pi', 'codex', 'claude', 'all'].includes(host)) fail('host must be pi, codex, claude or all');
  if (update && uninstall) fail('update and uninstall cannot be combined');
  const root = resolve(project);
  await safeDirectory(root, true);
  await safeDirectory(source, true);
  const files = await fileMap(source);
  if (!files['SKILL.md'] || !files['scripts/case.mjs']) fail('Skill source is incomplete');
  const expected = digestMap(files);
  // Pi and Codex both discover .agents/skills. One copy avoids duplicate Pi names.
  const locations = host === 'all' ? ['.agents', '.claude'] : [host === 'claude' ? '.claude' : '.agents'];
  const targets = [];
  for (const location of locations) {
    const base = join(root, location);
    const destination = join(base, 'skills', 'case-workflow');
    await safeDirectory(destination);
    await safeDirectory(join(base, 'case-workflow-backups'));
    const old = await inspectInstalled(destination);
    const same = old && JSON.stringify(old) === JSON.stringify(expected);
    if (old && !same && !update && !uninstall) fail(`Different managed version exists; use --update: ${destination}`);
    targets.push({ base, destination, old, same });
  }
  const results = [];
  for (const target of targets) {
    const { base, destination } = target;
    if (uninstall && !target.old) { results.push({ destination, action: 'absent' }); continue; }
    if (!uninstall && target.same) { results.push({ destination, action: 'unchanged' }); continue; }
    await mkdir(base, { recursive: true });
    const lockPath = join(base, '.case-workflow-install.lock');
    let lock;
    try {
      // mkdir is an exclusive cooperative reservation; never remove someone else's lock.
      await mkdir(lockPath);
      lock = true;
      await safeDirectory(destination);
      const current = await inspectInstalled(destination);
      if (JSON.stringify(current) !== JSON.stringify(target.old)) fail(`Installation changed during setup: ${destination}`);
      const id = randomUUID();
      let backup = null;
      let stage = null;
      try {
        if (!uninstall) {
          stage = join(base, `.case-workflow-stage-${id}`);
          await mkdir(stage);
          for (const [relative, bytes] of Object.entries(files)) {
            const path = join(stage, relative);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, bytes, { flag: 'wx' });
          }
          await writeFile(join(stage, MARKER), `${JSON.stringify({ format: FORMAT, files: expected }, null, 2)}\n`, { flag: 'wx' });
          await mkdir(dirname(destination), { recursive: true });
        }
        if (target.old) {
          const backups = join(base, 'case-workflow-backups');
          await mkdir(backups, { recursive: true });
          backup = join(backups, id);
          await rename(destination, backup);
        }
        if (stage) {
          try { await rename(stage, destination); stage = null; }
          catch (error) { if (backup) await rename(backup, destination); throw error; }
        }
        results.push({ destination, action: uninstall ? 'removed' : target.old ? 'updated' : 'installed', backup });
      } finally {
        if (stage) await rm(stage, { recursive: true, force: true });
      }
    } finally {
      if (lock) await rmdir(lockPath);
    }
  }
  return { ok: true, host, project: root, results, note: 'Shared .agents installation serves both Pi and Codex; task data is unchanged.' };
}

async function main(args) {
  if (args.includes('--help') || args.length === 0) {
    console.log('C.A.S.E. project skill installer\nnode install.mjs --project PATH --host pi|codex|claude|all [--update | --uninstall]\nDefault host: all. Existing custom files are never overwritten. Update/removal retains a backup.\nPi and Codex share .agents/skills/case-workflow; Claude uses .claude/skills/case-workflow.\nNo global config, credentials, project instruction files, or task data are changed.');
    return;
  }
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--project', '--host', '--update', '--uninstall'].includes(key) || Object.hasOwn(options, key.slice(2))) fail(`Unknown or duplicate option: ${key}`);
    options[key.slice(2)] = ['--update', '--uninstall'].includes(key) ? true : args[++i];
    if (typeof options[key.slice(2)] === 'string' && (!options[key.slice(2)].trim() || options[key.slice(2)].startsWith('--'))) fail(`Missing value: ${key}`);
  }
  if (!options.project || (Object.hasOwn(options, 'host') && !options.host)) fail('--project PATH and valid option values are required');
  console.log(JSON.stringify(await installSkill(options), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(JSON.stringify({ ok: false, code: 'CASE_INSTALL_ERROR', message: error.message })); process.exitCode = 1; });
}
