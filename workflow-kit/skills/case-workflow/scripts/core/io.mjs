import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
export function fail(code, message) {
    throw Object.assign(new Error(message), { code });
}
export function need(value, message = 'Invalid argument') {
    if (!value)
        fail('INVALID_ARGUMENT', message);
}
export const text = value => typeof value === 'string' && value.trim().length > 0;
const protectedMaterialParts = new Set(['.case-agent', '.git', '.pi', '.agents', '.codex', '.claude']);
export const isProtectedMaterialPart = part => protectedMaterialParts.has(part.toLowerCase());
export function jsonValue(value, seen = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value))
        return;
    need(value && typeof value === 'object' && !seen.has(value) && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype), 'Value must be plain JSON');
    seen.add(value);
    Object.values(value).forEach(v => jsonValue(v, seen));
    seen.delete(value);
}
export const evidence = value => text(value) || Array.isArray(value) && value.length > 0 && value.every(evidence) || value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
export function safe(file, missing = false) {
    const absolute = path.resolve(file);
    let current = path.parse(absolute).root;
    for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
        current = path.join(current, part);
        let s;
        try {
            s = fs.lstatSync(current);
        }
        catch (e) {
            if (e.code === 'ENOENT' && missing)
                return absolute;
            throw e;
        }
        if (s.isSymbolicLink())
            fail('UNSAFE_PATH', `Symbolic link: ${current}`);
        if (current !== absolute && !s.isDirectory())
            fail('UNSAFE_PATH', `Not directory: ${current}`);
    }
    return absolute;
}
export function resolveMaterial(project, name) {
    need(text(name), 'Path required');
    if (path.isAbsolute(name) || name.includes('\\') || name.split('/').includes('..') || name.includes(':'))
        fail('UNSAFE_PATH', 'Require project-relative path');
    const target = path.resolve(project, name);
    const first = path.relative(project, target).split(path.sep)[0].toLowerCase();
    if (target === project || !target.startsWith(project + path.sep) || first.startsWith('.case-agent') || name.split('/').some(isProtectedMaterialPart))
        fail('UNSAFE_PATH', 'Path outside materials');
    return safe(target, true);
}
export function digest(project, item) {
    const file = resolveMaterial(project, item.path);
    if (!fs.existsSync(file)) {
        if (item.required)
            fail('MISSING_INPUT', `Missing ${item.path}`);
        return null;
    }
    if (!fs.lstatSync(file).isFile())
        fail('UNSAFE_PATH', 'Material must be a regular file');
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
export function json(file) {
    safe(file);
    if (!fs.lstatSync(file).isFile())
        fail('INVALID_STATE', 'Expected JSON file');
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    catch {
        fail('INVALID_STATE', 'Invalid JSON');
    }
}
export function write(file, value) {
    safe(file, true);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
        fs.renameSync(temporary, file);
    }
    finally {
        if (fs.existsSync(temporary))
            fs.unlinkSync(temporary);
    }
}
export function locked(root, fn) {
    safe(root);
    const file = path.join(root, '.write-lock');
    let fd;
    try {
        fd = fs.openSync(file, 'wx');
    }
    catch (e) {
        if (e.code === 'EEXIST')
            fail('BUSY', 'Writer lock exists; inspect stopped writer before manual recovery');
        throw e;
    }
    try {
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
        return fn();
    }
    finally {
        fs.closeSync(fd);
        fs.unlinkSync(file);
    }
}
export function fingerprint(value) {
    const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
