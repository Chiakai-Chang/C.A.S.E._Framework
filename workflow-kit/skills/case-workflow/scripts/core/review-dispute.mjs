import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fail, text, jsonValue, fingerprint, resolveMaterial} from './io.mjs';
import {fresh} from './state.mjs';
import {assertDiscoveriesResolved} from './discoveries.mjs';

const invalid = message => fail('INVALID_REVIEW_DISPUTE', message);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key=>Object.hasOwn(value,key));

export function validateDisputeShape(dispute) {
    try {jsonValue(dispute);} catch {invalid('Review dispute must be plain JSON');}
    if (!exact(dispute,['reason','criterionIds','citations']) || !text(dispute.reason) || dispute.reason.length>4000) invalid('Review dispute requires reason (at most 4000 characters), criterionIds and citations only');
    if (!Array.isArray(dispute.criterionIds) || !dispute.criterionIds.length || !dispute.criterionIds.every(text) || new Set(dispute.criterionIds).size !== dispute.criterionIds.length) invalid('Unique nonempty criterion IDs required');
    if (!Array.isArray(dispute.citations) || !dispute.citations.length || dispute.citations.length>16) invalid('Require 1 to 16 citations');
    for (const c of dispute.citations) {
        if (!exact(c,['path','sha256','startLine','endLine','quote']) || !text(c.path) || typeof c.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(c.sha256) || !Number.isSafeInteger(c.startLine) || c.startLine<1 || !Number.isSafeInteger(c.endLine) || c.endLine<c.startLine || !text(c.quote) || c.quote.length>4000) invalid('Invalid citation path, hash, line range or quote');
    }
    return {valid:true};
}

export function reviewSnapshot(project, state) {
    if (state.status !== 'active' || !state.packets.length || !state.packets.every(p=>p.status==='verified')) fail('INVALID_TRANSITION','Review dispute requires active case with all packets verified');
    assertDiscoveriesResolved(state);
    state.packets.forEach(p=>fresh(project,p,true));
    const materials = new Map();
    // Outputs replace the original input hash when a packet edits an input in place.
    for (const p of state.packets) for (const i of p.inputs) if (i.sha256) materials.set(i.path,i.sha256);
    for (const p of state.packets) for (const d of p.attempts.at(-1)?.deliverables??[]) materials.set(d.path,d.sha256);
    const listed = [...materials].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([path,sha256])=>({path,sha256}));
    const versionKey=fingerprint({id:state.id,revision:state.revision,contract:state.contract,packets:state.packets.map(p=>({id:p.id,revision:p.revision,contractRevision:p.contractRevision,inputs:p.inputs,attemptId:p.attempts.at(-1)?.id,deliverables:p.attempts.at(-1)?.deliverables})),materials:listed});
    return {versionKey,revision:state.revision,materials:listed};
}

export function validateReviewDispute(project, state, snapshot, dispute) {
    validateDisputeShape(dispute);
    const current=reviewSnapshot(project,state);
    try {jsonValue(snapshot);} catch {fail('STALE_REVIEW_DISPUTE','Invalid saved review snapshot');}
    if (fingerprint(current)!==fingerprint(snapshot)) fail('STALE_REVIEW_DISPUTE','Review materials or case version changed');
    if (!dispute.criterionIds.every(id=>state.contract.acceptance.some(c=>c.id===id))) invalid('Unknown acceptance criterion');
    for (const citation of dispute.citations) {
        if (!current.materials.some(m=>m.path===citation.path && m.sha256===citation.sha256)) invalid('Citation is not a versioned review material');
        const file=resolveMaterial(project,citation.path);
        const stat=fs.lstatSync(file);
        if (!stat.isFile() || stat.size>1024*1024) invalid('Citation requires a regular file of at most 1 MiB');
        const bytes=fs.readFileSync(file);
        if (createHash('sha256').update(bytes).digest('hex')!==citation.sha256) fail('STALE_REVIEW_DISPUTE','Citation source changed while reading');
        const lines=bytes.toString('utf8').split(/\r?\n/);
        if (citation.endLine>lines.length || lines.slice(citation.startLine-1,citation.endLine).join('\n')!==citation.quote) invalid('Citation quote must match all selected lines');
    }
    return {valid:true};
}
