import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { run as legacy } from '../case.mjs';
import { safe, json, write, locked, fail, fingerprint } from './io.mjs';
// A journal outside the v1 namespace makes a pre-commit interruption recognizable.
// Locks are never automatically broken, including after a migration interruption.
export function migrate(project, root) {
    const journalFile = path.join(project, '.case-agent-migration.json');
    const preparedFile = path.join(project, '.case-agent-migration-state.json');
    const manifest = json(path.join(root, 'workflow.json'));
    let journal;
    if (fs.existsSync(path.join(root, '.write-lock')))
        fail('BUSY', 'Confirm the previous writer stopped before recovering its lock');
    if (fs.existsSync(journalFile)) {
        journal = json(journalFile);
        if (journal.owner !== 'case-workflow' || journal.format !== 'case-migration/1' || journal.manifestHash !== fingerprint(manifest) || typeof journal.backupPath !== 'string' || path.dirname(journal.backupPath) !== project || !/^\.case-agent-backup-[a-f0-9-]{36}$/.test(path.basename(journal.backupPath)))
            fail('NAMESPACE_CONFLICT', 'Unrecognized migration journal');
        safe(journal.backupPath);
        if (fingerprint(json(path.join(journal.backupPath, 'workflow.json'))) !== fingerprint(manifest))
            fail('BACKUP_FAILED', 'Backup manifest differs');
        const cases = path.join(root, 'cases');
        if (fs.existsSync(cases)) {
            safe(cases);
            if (fs.readdirSync(cases).length)
                fail('NAMESPACE_CONFLICT', 'Interrupted cases directory is not empty');
            fs.rmdirSync(cases);
        }
    }
    else if (fs.existsSync(preparedFile))
        fail('NAMESPACE_CONFLICT', 'Foreign migration staging file');
    legacy(['doctor', '--project', project]);
    return locked(root, () => {
        if (!journal) {
            const backupPath = path.join(project, `.case-agent-backup-${randomUUID()}`);
            function checkTree(dir) {
                for (const entry of fs.readdirSync(dir)) {
                    const target = path.join(dir, entry);
                    safe(target);
                    const s = fs.lstatSync(target);
                    if (s.isDirectory())
                        checkTree(target);
                    else if (!s.isFile())
                        fail('UNSAFE_PATH', 'Unsupported backup entry');
                }
            }
            checkTree(root);
            fs.cpSync(root, backupPath, {
                recursive: true, filter: src => path.basename(src) !== '.write-lock', errorOnExist: true, force: false
            });
            journal = {
                owner: 'case-workflow', format: 'case-migration/1', manifestHash: fingerprint(manifest), backupPath
            };
            write(journalFile, journal);
        }
        if (fingerprint(json(path.join(journal.backupPath, 'workflow.json'))) !== fingerprint(manifest))
            fail('BACKUP_FAILED', 'Manifest backup mismatch');
        const names = fs.readdirSync(path.join(root, 'tasks')).sort();
        if (JSON.stringify(names) !== JSON.stringify(fs.readdirSync(path.join(journal.backupPath, 'tasks')).sort()))
            fail('BACKUP_FAILED', 'Task list differs');
        for (const name of names)
            if (fingerprint(json(path.join(root, 'tasks', name))) !== fingerprint(json(path.join(journal.backupPath, 'tasks', name))))
                fail('BACKUP_FAILED', 'Task backup mismatch');
        write(preparedFile, {
            ...manifest, format: 'case-workflow/2', backupPath: journal.backupPath, migratedAt: new Date().toISOString(), legacy: 'tasks retained as v1 history; not independent verification'
        });
        fs.mkdirSync(path.join(root, 'cases'));
        fs.renameSync(preparedFile, path.join(root, 'workflow.json'));
        fs.unlinkSync(journalFile);
        return { format: 'case-workflow/2', migrated: true, backupPath: journal.backupPath };
    });
}
