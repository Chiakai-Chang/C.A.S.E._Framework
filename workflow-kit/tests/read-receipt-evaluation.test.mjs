import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {specs,grade,decision,oldReadResult,holdoutOracle,digest} from '../evaluation/read-receipt-spec.mjs';
import {runBatch,audit,retain,probeRoundtrip,freeze,runFrozen,verifyFrozen} from '../evaluation/read-receipt-comparison.mjs';
import {compare} from '../evaluation/planning-comparison.mjs';
import {configuration} from '../evaluation/read-receipt-comparison.mjs';

test('planning comparison rejects changed baseline code before importing it',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'case-planning-integrity-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const entry=path.join(dir,'baseline.mjs'),manifestPath=path.join(dir,'manifest.json'),output=path.join(dir,'evidence.json');
  fs.writeFileSync(entry,'export const unchanged=true;');
  const manifest={format:'case-read-receipt/1',configuration,specs:{},specSha256:digest('{}'),codeHashes:{[entry]:digest(fs.readFileSync(entry))},
    experiment:{kind:'planning-handoff/1',baselineEntry:entry}};
  fs.writeFileSync(manifestPath,JSON.stringify(manifest));
  fs.writeFileSync(entry,'throw new Error("Changed baseline executed");');
  await assert.rejects(compare({manifestPath,output}),/Frozen code changed/);
  assert.equal(fs.existsSync(output),false);
});

const result=(passed=true)=>({artifactPassed:passed,workflowCompleted:passed,traceComplete:true,constraints:{integrity:'verified'}});
test('fixed decision covers all four outcomes and evidence insufficiency',()=>{
  for(const [a,b,kind,holdout] of [[true,true,'both-pass',false],[true,false,'old-only',false],[false,true,'new-only',true],[false,false,'both-fail',false]])
    assert.deepEqual({...decision(result(a),result(b)),reason:undefined},{kind,holdout,reason:undefined});
  assert.equal(decision({...result(false),traceComplete:false},result()).kind,'inconclusive');
  assert.equal(decision(result(false),{...result(),constraints:{read:'unknown'}}).holdout,false);
  assert.equal(decision(result(false),{...result(),constraints:{read:'violated'}}).kind,'both-fail');
});
test('batch is finite, failed semantic probe continues, holdout runs only new-only',async()=>{
  for(const [a,b] of [[true,true],[true,false],[false,true],[false,false]]){
    const calls=[];const evidence=await runBatch({id:'test'},async id=>{calls.push(id);return {id,...result(id==='A'?a:id==='B'?b:false)};});
    assert.deepEqual(calls,['probe','A','B',...(!a&&b?['holdout']:[])]);
    assert.equal(evidence.status,'completed');
  }
});
test('batch stops on safety or missing critical evidence without replacement attempts',async()=>{
  const calls=[];
  const r=await runBatch({id:'test'},async id=>{calls.push(id);return {id,...result(),safetyStop:true};});
  assert.deepEqual(calls,['probe']);assert.equal(r.status,'stopped');
  const next=[];
  await runBatch({id:'test'},async id=>{next.push(id);return {id,...result(),traceComplete:id!=='A'};});
  assert.deepEqual(next,['probe','A']);
});
test('old-format treatment preserves body and details while restoring pagination notice',()=>{
  const make=(body,truncated,nextStartLine)=>({content:[{type:'text',text:'CASE_READ '+JSON.stringify({nextStartLine})+'\n'+body}],details:{startLine:1,truncated,nextStartLine}});
  for(const body of ['', '甲\n乙\n','literal CASE_READ {not metadata}']){
    const r=make(body,false,null);assert.equal(oldReadResult(r).content[0].text,body);assert.equal(oldReadResult(r).details,r.details);
  }
  assert.equal(oldReadResult(make('a\nb',true,3)).content[0].text,'a\nb\n[More material: continue at line 3]');
  assert.throws(()=>oldReadResult({content:[{type:'text',text:'legacy'}]}),{code:'RECEIPT_PROTOCOL'});
});
test('holdout oracle is distinct, source-grounded and not installed as model input',t=>{
  const spec=specs().holdout;
  assert.deepEqual(spec.expected,holdoutOracle);
  assert.deepEqual(Object.keys(spec.sources).sort(),['ARCHITECTURE.md','context.mjs','contracts.mjs']);
  assert.match(spec.sources['contracts.mjs'],/Number\.isSafeInteger\(input\.budget\.maxAttempts\)/);
  assert.match(spec.sources['contracts.mjs'],/Dependency cycle/);
  assert.match(spec.sources['context.mjs'],/maxChars = 100000/);
  assert.match(spec.sources['context.mjs'],/requiredMaterials:/);
  assert.match(spec.sources['context.mjs'],/materialIndex:/);
  assert.match(spec.sources['context.mjs'],/No worker history is included/);
  assert.match(spec.sources['ARCHITECTURE.md'],/不保證自動去敏/);
  assert.match(spec.sources['ARCHITECTURE.md'],/\.case-agent\/cases\/<UUID>\/state.json/);
  const project=fs.mkdtempSync(path.join(os.tmpdir(),'case-receipt-grade-'));t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
  for(const [f,text] of Object.entries({...spec.sources,'requirements.md':spec.goal}))fs.writeFileSync(path.join(project,f),text);
  assert.equal(grade(project,spec).artifactPassed,false);
  fs.writeFileSync(path.join(project,spec.output),JSON.stringify(spec.expected));assert.equal(grade(project,spec).artifactPassed,true);
  const extra=structuredClone(spec.expected);extra.context.includesWorkerHistory=true;
  fs.writeFileSync(path.join(project,spec.output),JSON.stringify(extra));assert.equal(grade(project,spec).artifactPassed,false);
  fs.writeFileSync(path.join(project,spec.output),JSON.stringify({...spec.expected,extra:true}));assert.equal(grade(project,spec).artifactPassed,false);
  fs.appendFileSync(path.join(project,'requirements.md'),'changed');assert.equal(grade(project,spec).sourcesPreserved,false);
  fs.writeFileSync(path.join(project,'extra.txt'),'');assert.deepEqual(grade(project,spec).extraPaths,['extra.txt']);
});
test('trace audit does not let correct final JSON hide forbidden writes or missing trace',()=>{
  const spec=specs().holdout;
  const base={grade:{artifactPassed:true,sourcesPreserved:true,extraPaths:[]},sessions:[{trace:{traceVersion:1,traceComplete:true,policyComplete:true}}],toolAudit:[{kind:'start',toolName:'case_read',path:'contracts.mjs'}]};
  assert.equal(audit(base,spec).traceComplete,true);
  assert.equal(audit({...base,sessions:[{}]},spec).constraints.evidence,'unknown');
  assert.equal(audit({...base,toolAudit:[{kind:'start',toolName:'case_write',path:'requirements.md'}]},spec).constraints.toolPaths,'violated');
  assert.equal(audit({...base,toolAudit:[{kind:'start',toolName:'case_read',path:'../outside'}]},spec).constraints.toolPaths,'violated');
  assert.equal(audit({...base,toolAudit:[{kind:'start',toolName:'case_write',path:'requirements.md'},{kind:'start',toolName:'case_read',path:null}]},spec).constraints.toolPaths,'violated');
});
test('diagnostic retention is bounded and loss limits evidence, not known violations',()=>{
  const record={toolAudit:[]};
  assert.equal(retain(record,'toolAudit',{text:'x'.repeat(300000)}),false);
  assert.equal(record.diagnostics.complete,false);assert.equal(record.diagnostics.dropped,1);
  for(let i=0;i<40;i++)retain(record,'toolAudit',{text:'y'.repeat(200000)});
  assert.ok(record.diagnostics.bytes<=2*1024*1024);
  assert.ok(record.toolAudit.length<40);
});
test('probe requires successful read/write/read-back order, not only correct output',()=>{
  const pair=(id,toolName,path,isError=false)=>[{kind:'start',toolCallId:id,toolName,path},{kind:'end',toolCallId:id,toolName,isError}];
  const read=pair('r','case_read','sample.json'),write=pair('w','case_write','copied.json'),check=pair('c','case_read','copied.json');
  assert.equal(probeRoundtrip({toolAudit:[...read,...write,...check]}),true);
  assert.equal(probeRoundtrip({toolAudit:[...write,...read,...check]}),false);
  assert.equal(probeRoundtrip({toolAudit:[...read,...write]}),false);
  assert.equal(probeRoundtrip({toolAudit:[...read,...pair('w','case_write','copied.json',true),...check]}),false);
});
test('freeze snapshots all topics without generation and run consumes the batch once',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'case-receipt-freeze-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=fileURLToPath(import.meta.url),sdk={SettingsManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){} getAgentsFiles(){return {agentsFiles:[]};}getSystemPrompt(){return undefined;}},createAgentSession(){throw new Error('No generation permitted');}};
  const manifestPath=path.join(dir,'manifest.json'),output=path.join(dir,'results.json');
  const manifest=await freeze({sdkPath:file,output:manifestPath,sdk,inspectServer:async()=>({modelId:'test',buildInfo:'test'}),inventory:()=>({[file]:digest(fs.readFileSync(file))})});
  t.after(()=>fs.rmSync(manifest.batchRoot,{recursive:true,force:true}));
  verifyFrozen(manifest);
  assert.deepEqual(fs.readdirSync(manifest.slots.holdout.project).sort(),['ARCHITECTURE.md','context.mjs','contracts.mjs','requirements.md']);
  assert.equal(fs.existsSync(path.join(manifest.slots.holdout.project,'oracle.json')),false);
  const called=[];
  const r=await runFrozen({manifestPath,output,sdk,execute:async({id})=>{called.push(id);return {id,...result(true)};}});
  assert.deepEqual(called,['probe','A','B']);assert.equal(r.decision.kind,'both-pass');
  await assert.rejects(runFrozen({manifestPath,output:path.join(dir,'duplicate.json'),sdk,execute:()=>{throw new Error('Must not rerun');}}),{code:'EEXIST'});
  manifest.specs.holdout.expected.context.defaultMaxChars=1;
  assert.throws(()=>verifyFrozen(manifest),/changed manifest/);
});
