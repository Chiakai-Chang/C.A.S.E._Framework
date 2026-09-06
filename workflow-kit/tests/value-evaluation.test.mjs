import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const mod=await import('../evaluation/value-fixtures.mjs').catch(()=>null);
const comparison=await import('../evaluation/value-comparison.mjs').catch(()=>null);
test('value comparison retains directory-shaped output failures and still returns evidence',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'case-value-directory-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const record=await comparison.evaluateArm({spec:mod.fixture('resume'),mode:'single',project:dir,
    createRunner:async()=>async r=>{await r.onStart('directory-output');fs.mkdirSync(path.join(dir,'normalized.json'));return {sessionId:'directory-output',text:'{"summary":"done"}'};}});
  assert.equal(record.status,'failed');assert.equal(record.checkpoint.upstreamPassed,false);
  assert.equal(record.checkpoint.sha256,null);assert.ok(record.artifactErrors['normalized.json']);
});
test('value comparison preserves runner initialization failures as an attempted arm',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'case-value-init-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let updates=0;
  const record=await comparison.evaluateArm({spec:mod.fixture('simple'),mode:'single',project:dir,
    createRunner:async()=>{throw new Error('SDK unavailable');},onUpdate:()=>updates++});
  assert.equal(record.status,'failed');assert.match(record.error.message,/SDK unavailable/);
  assert.equal(record.sessions.length,0);assert.equal(record.sdkTotalTokens,null);assert.ok(updates>0);
});
test('value comparison records wrong successful replies as failed artifacts',async t=>{
  assert.ok(comparison?.evaluateArm,'Comparison arm must exist');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'case-value-arm-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const record=await comparison.evaluateArm({spec:mod.fixture('simple'),mode:'single',project:dir,
    createRunner:async()=>async request=>{await request.onStart('wrong-artifact');return {sessionId:'wrong-artifact',text:'{"summary":"done"}'};}});
  assert.equal(record.workflowCompleted,true);
  assert.equal(record.artifactPassed,false);
  assert.equal(record.passed,false);
});
test('resume comparison really generates upstream then uses fresh sessions without rewriting it',async t=>{
  assert.ok(comparison?.evaluateArm,'Comparison arm must exist');
  for(const mode of ['single','case']){
    const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-value-resume-')));
    t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    const spec=mod.fixture('resume');let n=0,firstHash;
    const record=await comparison.evaluateArm({spec,mode,project:dir,createRunner:async()=>async request=>{
      const id=`${mode}-${++n}`;await request.onStart(id);
      let result;
      if(request.role==='worker'){
        if(request.writeScope.includes('normalized.json')){
          assert.equal(fs.existsSync(path.join(dir,'normalized.json')),false);
          fs.writeFileSync(path.join(dir,'normalized.json'),JSON.stringify(spec.expected['normalized.json']));
          firstHash=fs.readFileSync(path.join(dir,'normalized.json'),'utf8');
        }else{
          assert.equal(fs.readFileSync(path.join(dir,'normalized.json'),'utf8'),firstHash);
          fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(spec.expected['report.json']));
        }
        result={summary:'Actual fixture file written by simulated model tool step'};
      }else if(request.role==='reviewer')result={passed:true,findings:[],evidence:'fixture inspection'};
      else result={results:[{criterionId:'normalization',passed:true,evidence:'fixture inspection'},{criterionId:'report',passed:true,evidence:'fixture inspection'}],summary:'checked'};
      return {sessionId:id,text:JSON.stringify(result)};
    }});
    assert.equal(record.passed,true);assert.equal(record.checkpoint.upstreamPassed,true);
    assert.equal(record.checkpoint.upstreamUnchanged,true);
    assert.equal(new Set(record.sessions.map(s=>s.sessionId)).size,record.sessions.length);
    if(mode==='case')assert.equal(record.runs.length,2);
    else assert.equal(record.sessions.length,2);
  }
});
test('value evaluator checks exact artifacts and rejects changed sources and extra fields',t=>{
  assert.ok(mod?.fixture,'Evaluation fixtures must exist');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'case-value-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const spec=mod.fixture('simple');
  for(const [f,v] of Object.entries(spec.sources))fs.writeFileSync(path.join(dir,f),v);
  assert.equal(mod.grade(dir,spec).artifactPassed,false);
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({ids:['a','b'],count:2}));
  assert.equal(mod.grade(dir,spec).artifactPassed,true);
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({ids:['a','b'],count:2,extra:true}));
  assert.equal(mod.grade(dir,spec).artifactPassed,false);
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({ids:['a','b'],count:2}));
  fs.appendFileSync(path.join(dir,'input.json'),' ');
  assert.equal(mod.grade(dir,spec).sourcesUnchanged,false);
});
test('multi-source oracle distinguishes pending refunds, cancellation and current prices',()=>{
  assert.ok(mod?.fixture,'Evaluation fixtures must exist');
  assert.deepEqual(mod.fixture('multi-source').expected,{
    'normalized.json':{lines:[
      {orderId:'a',netQuantity:1,currency:'USD',netAmount:12,netTwd:384},
      {orderId:'b',netQuantity:3,currency:'EUR',netAmount:21,netTwd:735},
      {orderId:'d',netQuantity:1,currency:'USD',netAmount:12,netTwd:384},
      {orderId:'e',netQuantity:0,currency:'EUR',netAmount:0,netTwd:0}]},
    'report.json':{netTwd:1503,byCurrency:{USD:24,EUR:21},excludedOrderIds:['c'],policyVersion:'2026-09'}
  });
  assert.throws(()=>mod.fixture('unknown'));
});
