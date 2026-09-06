#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './core/index.mjs';
import { need, fail } from './core/io.mjs';
export function run(args) {
    if (args.length === 1 && ['--help', '-h'].includes(args[0]))
        return 'CASE v2: init | migrate | project | set-project --data FILE --revision N --reason TEXT | create --data FILE | get --case ID | list | dispatch --case ID --data FILE --revision N --request ID | context --case ID --packet ID [--max-chars N]\nEvery command requires --project PATH. JSON action/contract files are read as data. set-project requires user-authorized consensus; it does not edit existing instruction files.\nDiscovery actions through dispatch: report_discovery (packetId, attemptId, discovery), resolve_discoveries (decisions; optional packets, rerunPacketIds, reason), reopen_discovery (id, reason). First discovery upgrades case state to case-workflow/2.1; older cores must not read it.\n';
    const [command, ...rest] = args, opts = {};
    for (let i = 0; i < rest.length; i += 2) {
        need(rest[i]?.startsWith('--') && rest[i + 1] && !Object.hasOwn(opts, rest[i]), 'Invalid options');
        opts[rest[i]] = rest[i + 1];
    }
    need(opts['--project'], '--project required');
    const store = createStore(opts['--project']);
    const flags = {
        init: [], migrate: [], project: [], 'set-project': ['--data', '--revision', '--reason'], create: ['--data'], get: ['--case'], show: ['--case'], list: [], dispatch: ['--case', '--data', '--revision', '--request'], context: ['--case', '--packet', '--max-chars']
    };
    need(Object.hasOwn(flags, command), 'Unknown command');
    need(Object.keys(opts).every(k => k === '--project' || flags[command].includes(k)), 'Unknown option');
    const data = () => JSON.parse(fs.readFileSync(opts['--data'], 'utf8'));
    switch (command) {
        case 'init': return store.init();
        case 'migrate': return store.migrate();
        case 'project': return store.project();
        case 'set-project': return store.setProject(data(), { expectedRevision: Number(opts['--revision']), reason: opts['--reason'] });
        case 'create': return store.create(data());
        case 'get':
        case 'show': return store.get(opts['--case']);
        case 'list': return store.list();
        case 'dispatch': return store.dispatch(opts['--case'], data(), { expectedRevision: Number(opts['--revision']), requestId: opts['--request'] });
        case 'context': return store.context(opts['--case'], opts['--packet'], opts['--max-chars'] ? { maxChars: Number(opts['--max-chars']) } : {});
        default: fail('INVALID_ARGUMENT', 'Unknown command; use --help');
    }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const result = run(process.argv.slice(2));
        process.stdout.write(typeof result === 'string' ? result : JSON.stringify(result) + '\n');
    }
    catch (e) {
        process.stderr.write(JSON.stringify({ ok: false, code: e.code ?? 'IO_ERROR', message: e.message }) + '\n');
        process.exitCode = 1;
    }
}
