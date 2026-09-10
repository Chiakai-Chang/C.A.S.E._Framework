import test from 'node:test';
import assert from 'node:assert/strict';
import {replayFirstVerdict} from '../evaluation/review-dispute-replay.mjs';

test('historical denial replaces only the first integrator and remains labelled synthetic',async()=>{
  const verdict={results:[{criterionId:'a',passed:false,evidence:'historical claim'}],summary:'old denial'};
  const calls=[],starts=[],saved=[];
  const run=replayFirstVerdict(async r=>{calls.push(r.role);return {text:'live '+r.role};},verdict,r=>saved.push(r));
  verdict.summary='mutated after setup';
  const invoke=role=>run({role,onStart:async id=>starts.push(id),validateResult:async reply=>assert.equal(reply.summary,'old denial')});
  assert.equal((await invoke('reviewer')).text,'live reviewer');
  const replay=await invoke('integrator');
  assert.equal(JSON.parse(replay.text).summary,'old denial');
  assert.equal(replay.synthetic,true);
  assert.equal(replay.usage,undefined);
  assert.equal(starts.length,1);
  assert.equal(saved.length,1);
  assert.equal((await invoke('planner')).text,'live planner');
  assert.equal((await invoke('integrator')).text,'live integrator');
  assert.deepEqual(calls,['reviewer','planner','integrator']);
});

test('replay rejects a passing verdict rather than manufacturing a dispute',()=>{
  assert.throws(()=>replayFirstVerdict(async()=>{}, {results:[{criterionId:'a',passed:true}],summary:'pass'},()=>{}));
});

test('failed replay validation does not fall through to a paid model call',async()=>{
  let calls=0;
  const run=replayFirstVerdict(async()=>{calls++;}, {results:[{criterionId:'a',passed:false,evidence:'claim'}],summary:'deny'},()=>{});
  await assert.rejects(run({role:'integrator',onStart:async()=>{},validateResult:async()=>{throw Error('invalid');}}),/invalid/);
  assert.equal(calls,0);
});
