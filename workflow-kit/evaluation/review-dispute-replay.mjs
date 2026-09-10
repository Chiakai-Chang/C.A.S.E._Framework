// Evaluation only: replay a preserved denial once; never part of the product runner.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export function replayFirstVerdict(next, verdict, record) {
  assert.ok(Array.isArray(verdict?.results) && verdict.results.some(r=>r.passed===false),'historical failed verdict required');
  const text=JSON.stringify(verdict);
  let issued=false;
  return async request=>{
    if(request.role!=='integrator'||issued)return next(request);
    issued=true;
    const result={sessionId:`synthetic-historical-verdict-${randomUUID()}`,text,synthetic:true,resultTransport:'historical-verdict-replay'};
    await request.onStart(result.sessionId);
    await request.validateResult?.(JSON.parse(text));
    await record(result);
    return result;
  };
}
