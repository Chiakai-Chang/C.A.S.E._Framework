import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {freeze,verifyFrozen} from '../evaluation/read-receipt-comparison.mjs';
import {digest} from '../evaluation/read-receipt-spec.mjs';

const sdk={SettingsManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){} getAgentsFiles(){return {agentsFiles:[]};}getSystemPrompt(){return undefined;}}};
async function fixture(t,thinkingLevel){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'case-single-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=fileURLToPath(import.meta.url),manifestPath=path.join(dir,'manifest.json');
  const manifest=await freeze({sdkPath:file,output:manifestPath,thinkingLevel,sdk,inspectServer:async()=>({modelId:'test'}),inventory:()=>({[file]:digest(fs.readFileSync(file))})});
  t.after(()=>fs.rmSync(manifest.batchRoot,{recursive:true,force:true}));
  return {dir,manifestPath,manifest};
}

test('freeze accepts explicit off and rejects changing its frozen settings',async t=>{
  const {manifest}=await fixture(t,'off');
  assert.equal(manifest.configuration.thinkingLevel,'off');
  verifyFrozen(manifest);
  manifest.configuration.thinkingLevel='medium';
  assert.throws(()=>verifyFrozen(manifest),/changed manifest/);
});

test('freeze retains medium default and refuses unsupported thinking before preparation',async t=>{
  const {manifest}=await fixture(t);
  assert.equal(manifest.configuration.thinkingLevel,'medium');
  await assert.rejects(freeze({sdkPath:'unused',output:'unused',thinkingLevel:'high'}),/thinkingLevel/);
});

test('single journey runs only B, saves intermediate evidence and refuses a second claim',async t=>{
  const {dir,manifestPath,manifest}=await fixture(t);
  const entry=await import('../evaluation/single-journey.mjs').catch(()=>({}));
  assert.equal(typeof entry.runSingle,'function','single-journey must expose runSingle');
  const output=path.join(dir,'result.json');
  await entry.runSingle({manifestPath,output,sdk,execute:async({id,onUpdate})=>{
    assert.equal(id,'B');
    assert.equal(fs.existsSync(path.join(manifest.slots.B.project,'adoption-map.json')),false);
    onUpdate({id,status:'running',sessions:[{role:'planner'}]});
    assert.equal(JSON.parse(fs.readFileSync(output)).result.sessions[0].role,'planner');
    return {id,status:'failed',error:{code:'TIMEOUT'},sessions:[{role:'planner'}]};
  }});
  assert.equal(JSON.parse(fs.readFileSync(output)).status,'failed');
  await assert.rejects(entry.runSingle({manifestPath,output:path.join(dir,'again.json'),sdk,execute:()=>assert.fail('must not run twice')}),{code:'EEXIST'});
});

test('single journey preserves partial evidence after an unexpected execution failure',async t=>{
  const {dir,manifestPath}=await fixture(t);
  const entry=await import('../evaluation/single-journey.mjs').catch(()=>({}));
  assert.equal(typeof entry.runSingle,'function','single-journey must expose runSingle');
  const output=path.join(dir,'result.json');
  await assert.rejects(entry.runSingle({manifestPath,output,sdk,execute:async({onUpdate})=>{
    onUpdate({id:'B',status:'running',sessions:[{role:'worker'}]});throw new Error('interrupted test');
  }}),/interrupted test/);
  const result=JSON.parse(fs.readFileSync(output));
  assert.equal(result.status,'interrupted');assert.equal(result.result.sessions[0].role,'worker');
});
