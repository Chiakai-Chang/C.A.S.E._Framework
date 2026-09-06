import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { migrate } from './migration.mjs';
import { safe, json, write, locked, need, fail, text, fingerprint, jsonValue } from './io.mjs';
import { contract } from './contracts.mjs';
import { transition } from './state.mjs';
import { context as buildContext } from './context.mjs';
import { preparePolicy, assertProjectAligned, inheritProject } from './project-policy.mjs';
const FORMAT = 'case-workflow/2';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function createStore(directory) {
    need(text(directory), 'Project directory required');
    const project = safe(directory);
    need(fs.statSync(project).isDirectory(), 'Project directory required');
    const root = path.join(project, '.case-agent');
    function owned() {
        safe(root);
        const manifest = json(path.join(root, 'workflow.json'));
        if (manifest.owner !== 'case-workflow')
            fail('NAMESPACE_CONFLICT', 'Unrecognized owner');
        if (manifest.format === 'case-workflow/1')
            fail('MIGRATION_REQUIRED', 'Explicit migration required');
        if (manifest.format !== FORMAT)
            fail('NAMESPACE_CONFLICT', 'Unsupported format');
        if (fs.readdirSync(root).some(n => !['workflow.json', 'tasks', 'cases', '.write-lock'].includes(n)))
            fail('NAMESPACE_CONFLICT', 'Foreign entry in store');
        safe(path.join(root, 'cases'));
        return manifest;
    }
    function location(id) {
        need(typeof id === 'string' && uuid.test(id), 'Invalid case ID');
        return safe(path.join(root, 'cases', id), true);
    }
    function read(id) {
        owned();
        const state = json(path.join(location(id), 'state.json'));
        if (![FORMAT,'case-workflow/2.1'].includes(state.format) || state.id !== id || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.packets) || !state.requests || !state.contract)
            fail('INVALID_STATE', 'Invalid case state');
        return state;
    }
    const api = {
        project() {
            const manifest = owned();
            return { policy: manifest.projectPolicy ?? null, history: manifest.projectHistory ?? [] };
        },
        setProject(input, { expectedRevision, reason } = {}) {
            owned();
            need(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0, 'Project expectedRevision required');
            return locked(root, () => {
                const manifest = owned();
                if ((manifest.projectPolicy?.revision ?? 0) !== expectedRevision)
                    fail('REVISION_CONFLICT', 'Project consensus revision changed');
                const policy = preparePolicy(project, input, expectedRevision + 1, reason);
                if (manifest.projectPolicy) (manifest.projectHistory ??= []).push(manifest.projectPolicy);
                manifest.projectPolicy = policy;
                write(path.join(root, 'workflow.json'), manifest);
                return policy;
            });
        },
        init() {
            if (fs.existsSync(root)) {
                owned();
                return { format: FORMAT, path: root, initialized: false };
            }
            fs.mkdirSync(root);
            fs.mkdirSync(path.join(root, 'cases'));
            fs.mkdirSync(path.join(root, 'tasks'));
            write(path.join(root, 'workflow.json'), { format: FORMAT, owner: 'case-workflow', createdAt: new Date().toISOString() });
            return { format: FORMAT, path: root, initialized: true };
        },
        migrate() {
            safe(root);
            const manifest = json(path.join(root, 'workflow.json'));
            if (manifest.format === FORMAT) {
                owned();
                return { format: FORMAT, migrated: false, backupPath: manifest.backupPath ?? null };
            }
            return migrate(project, root);
        },
        create(input) {
            owned();
            return locked(root, () => {
                const id = randomUUID(), now = new Date().toISOString();
                const state = {
                    format: FORMAT, id, revision: 0, status: 'active', contract: contract(inheritProject(project, input, owned().projectPolicy)), packets: [], integration: null, requests: {}, createdAt: now, updatedAt: now
                };
                fs.mkdirSync(location(id));
                fs.mkdirSync(path.join(location(id), 'artifacts'));
                write(path.join(location(id), 'state.json'), state);
                return state;
            });
        },
        get: read,
        readDiscovery(id, discoveryId, {start=0,maxChars=6000,expectedRevision} = {}) {
            const state=read(id);
            assertProjectAligned(project,owned().projectPolicy,state.contract.project);
            if (expectedRevision !== undefined && expectedRevision !== state.revision) fail('REVISION_CONFLICT','Revision has changed');
            need(Number.isSafeInteger(start) && start>=0 && Number.isSafeInteger(maxChars) && maxChars>0 && maxChars<=12000,'Discovery read requires nonnegative start and maxChars from 1 to 12000');
            const d=(state.discoveries??[]).find(d=>d.id===discoveryId);
            need(d,'Unknown discovery ID');
            const content=JSON.stringify(d,null,2);
            need(start<=content.length,'Discovery start exceeds record length');
            const nextStart=Math.min(content.length,start+maxChars);
            return {id:d.id,revision:state.revision,start,nextStart,totalChars:content.length,complete:nextStart===content.length,text:content.slice(start,nextStart)};
        },
        validateAction(id, action, {expectedRevision} = {}) {
            jsonValue(action);
            need(['submit','resolve_discoveries'].includes(action?.type), 'Unsupported preflight action');
            const state = read(id);
            if (state.revision !== expectedRevision) fail('REVISION_CONFLICT', 'Revision has changed');
            assertProjectAligned(project, owned().projectPolicy, state.contract.project);
            transition(project, state, structuredClone(action));
            return {valid:true};
        },
        validatePlan(id, action, {expectedRevision} = {}) {
            jsonValue(action);
            need(['plan','amend_plan'].includes(action?.type), 'Only plan actions can be validated');
            const state = read(id);
            if (state.revision !== expectedRevision) fail('REVISION_CONFLICT', 'Revision has changed');
            assertProjectAligned(project, owned().projectPolicy, state.contract.project);
            // read() returns a fresh object. Use the same transition, without committing it.
            transition(project, state, structuredClone(action));
            return {valid:true};
        },
        list() {
            owned();
            return fs.readdirSync(path.join(root, 'cases')).sort().map(read);
        },
        dispatch(id, action, { expectedRevision, requestId } = {}) {
            owned();
            jsonValue(action);
            need(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0 && text(requestId), 'expectedRevision and requestId required');
            return locked(root, () => {
                const state = read(id);
                const hash = fingerprint(action);
                if (Object.hasOwn(state.requests, requestId)) {
                    if (state.requests[requestId].hash !== hash)
                        fail('REQUEST_CONFLICT', 'Request ID reused for different action');
                    return state;
                }
                if (expectedRevision !== state.revision)
                    fail('REVISION_CONFLICT', 'Revision has changed');
                const nextAction = structuredClone(action);
                const policy = owned().projectPolicy;
                if (action.type === 'revise') nextAction.contract = inheritProject(project, action.contract, policy, state.contract.project);
                else if (!['cancel', 'block'].includes(action.type)) assertProjectAligned(project, policy, state.contract.project);
                transition(project, state, nextAction);
                state.revision++;
                state.updatedAt = new Date().toISOString();
                Object.defineProperty(state.requests, requestId, {
                    value: { hash, revision: state.revision }, enumerable: true, configurable: true, writable: true
                });
                write(path.join(location(id), 'state.json'), state);
                return state;
            });
        },
        context(id, packetId, options) {
            const state = read(id);
            assertProjectAligned(project, owned().projectPolicy, state.contract.project);
            return buildContext(project, state, packetId, options);
        },
        saveRun(id, runId, record) {
            read(id);
            need(typeof runId === 'string' && uuid.test(runId), 'Invalid run ID');
            need(record && typeof record === 'object' && !Array.isArray(record), 'Run record required');
            jsonValue(record);
            return locked(root, () => {
                const file = path.join(location(id), 'artifacts', `run-${runId}.json`);
                write(file, record);
                return { runId, path: file };
            });
        },
        listRuns(id) {
            read(id);
            const dir = safe(path.join(location(id), 'artifacts'));
            return fs.readdirSync(dir).filter(n => /^run-[a-f0-9-]{36}\.json$/.test(n)).map(n => json(path.join(dir, n))).sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
        },
    };
    return Object.fromEntries(Object.entries(api).map(([name, operation]) => [name, (...args) => {
            try {
                return operation(...args);
            }
            catch (error) {
                if (!error.code)
                    error.code = error instanceof TypeError ? 'INVALID_ARGUMENT' : 'IO_ERROR';
                throw error;
            }
        }]));
}
