import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const bytes = value => Buffer.byteLength(JSON.stringify(value));
const hash = value => createHash('sha256').update(value).digest('hex');
const identity = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 128 ? value : 'unknown';
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : 'unknown';
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : 'unknown';
const boolean = value => typeof value === 'boolean' ? value : 'unknown';
const toolNames = new Set(['case_read','case_list','case_write','case_check','case_result','case_discover','case_discovery_read']);
const errorCodes = new Set(['CANCELLED','UNSAFE_TOOL_PATH','LINE_TOO_LONG','READ_OUTPUT_TOO_LARGE','READ_RECEIPT_TOO_LARGE','INVALID_ARGUMENT','INVALID_RESULT','INVALID_REPLY','RESULT_BUSY','RESULT_ALREADY_RECORDED','DISCOVERY_BLOCKED','CHECK_NOT_APPROVED','CHECK_FAILED','INVALID_CHECK_CONFIG','ENOENT','EACCES','EPERM','EISDIR','ENOSPC','REVISION_CONFLICT','MISSING_INPUT','STALE_INPUT','MISSING_DELIVERABLE']);
const within = (directory, file) => {
  const relative=path.relative(directory,file);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
function approvedPath(value) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value)>2048 || path.isAbsolute(value) || /[:\0\\]/.test(value) || value.split('/').some(p=>p==='..'||p==='')) return 'unknown';
  return value;
}

/** Metadata only. Existing session observations have a separate, unchanged retention policy. */
export function createSessionTrace({runId,sessionId,role,project,agentDir,approvedCheckIds=[],now=()=>performance.now()}) {
  const started=now(), events=[], pending=new Map();
  let sequence=0, request=0, usedBytes=0, missingStarts=0, duplicateStarts=0, untrackedTools=false, degraded=false, finished;
  let pendingRequests=0, pendingCompactions=0, missingRequestStarts=0, missingCompactionStarts=0;
  let systemPromptSha256='unknown', loadedPolicySha256='unknown', policyComplete=false;
  const overflow={droppedEvents:0,oversizedEvents:0};
  const ids={runId:identity(runId),sessionId:identity(sessionId),role:['worker','planner','reviewer','integrator'].includes(role)?role:'unknown'};
  const eventBase = kind => ({seq:++sequence,atMs:Math.max(0,Math.round(now()-started)),kind,requestId:request?`request-${request}`:'unknown',providerRequestId:'unknown'});
  function add(kind, fields={}) {
    const event={...eventBase(kind),...fields};
    const size=bytes(event);
    // Reserve space for the terminal summary, envelope and pending-tool samples.
    if (size>4096 || events.length>=127 || usedBytes+size>240*1024) {
      overflow.droppedEvents++; if(size>4096)overflow.oversizedEvents++;
      degraded=true;return;
    }
    events.push(event);usedBytes+=size;
  }
  function metadata(name, event, call) {
    const details=event.result?.details;
    if(event.isError === true) return {errorCode:call?.errorCode??(errorCodes.has(details?.code)?details.code:'unknown')};
    if(event.isError !== false)return {status:'unknown'};
    if(name==='case_read')return {
      path:approvedPath(details?.path),sourceSha256:digest(details?.sourceSha256),resultSha256:digest(details?.resultSha256),
      range:details?.range===null?null:details?.range && Number.isSafeInteger(details.range.startLine) && details.range.startLine>0 && Number.isSafeInteger(details.range.endLine) && details.range.endLine>=details.range.startLine?{startLine:details.range.startLine,endLine:details.range.endLine}:'unknown',
      lines:integer(details?.lines),eof:boolean(details?.eof),wholeFile:boolean(details?.wholeFile),empty:boolean(details?.empty),outOfRange:boolean(details?.outOfRange),
      nextStartLine:details?.nextStartLine===null?null:integer(details?.nextStartLine),receiptVersion:details?.receiptVersion===1?1:'unknown',
    };
    if(name==='case_write')return {path:approvedPath(details?.path),bytes:integer(details?.bytes),sourceSha256:digest(details?.sourceSha256)};
    if(name==='case_check')return {id:approvedCheckIds.includes(details?.id)?identity(details.id):'unknown',exitCode:Number.isSafeInteger(details?.exitCode)?details.exitCode:'unknown'};
    if(name==='case_discover')return {id:identity(details?.id),status:['pending','accepted','duplicate','dismissed','deferred','needs_input'].includes(details?.status)?details.status:'unknown'};
    if(name==='case_result')return {recorded:boolean(details?.recorded),replayed:details?.replayed===true,kind:call?.resultKind??'unknown'};
    if(name==='case_discovery_read')return {id:identity(details?.id),start:integer(details?.start),nextStart:integer(details?.nextStart),complete:boolean(details?.complete),revision:integer(details?.revision)};
    return {};
  }
  function observe(event) {
    if(finished)return;
    try {
      if(event?.type==='turn_start'){request++;pendingRequests++;add('request_start');return;}
      if(event?.type==='turn_end'){
        if(pendingRequests)pendingRequests--;else {missingRequestStarts++;degraded=true;}
        add('request_end');return;
      }
      if(event?.type==='compaction_start'||event?.type==='compaction_end'){
        if(event.type==='compaction_start')pendingCompactions++;
        else if(pendingCompactions)pendingCompactions--;
        else {missingCompactionStarts++;degraded=true;}
        add(event.type,{reason:['manual','threshold','overflow'].includes(event.reason)?event.reason:'unknown',aborted:event.type==='compaction_end'?boolean(event.aborted):'unknown',compressedRange:'unknown',retainedContent:'unknown'});return;
      }
      if(event?.type==='message_end' && event.message?.role==='assistant'){
        add('model_response',{stopReason:['stop','length','toolUse','error','aborted'].includes(event.message.stopReason)?event.message.stopReason:'unknown',thinkingPresent:Array.isArray(event.message.content)?event.message.content.some(c=>c?.type==='thinking'):'unknown'});return;
      }
      if(!['tool_execution_start','tool_execution_end'].includes(event?.type))return;
      const toolName=toolNames.has(event.toolName)?event.toolName:'unknown',toolCallId=identity(event.toolCallId);
      const key=toolCallId==='unknown'?null:toolCallId;
      if(event.type==='tool_execution_start'){
        const call={toolCallId,toolName,requestId:request?`request-${request}`:'unknown'};
        if(toolName==='case_result'){
          const value=event.args?.result;
          call.resultKind=value && typeof value==='object'?['summary','blocked','changeRequest','packets','decisions','passed','results'].find(k=>Object.hasOwn(value,k))??'unknown':'unknown';
        }
        if(key && pending.has(key)){duplicateStarts++;degraded=true;}
        else if(key && pending.size<128)pending.set(key,call);
        else {untrackedTools=true;degraded=true;}
        add('tool_start',{...call,...(toolName==='case_read'?{requestedRange:{startLine:integer(event.args?.startLine??1),maxLines:integer(event.args?.maxLines??200)}}:{})});
      }else{
        const call=key?pending.get(key):undefined;
        const matched=call?.toolName===toolName;
        if(!matched){missingStarts++;degraded=true;}
        if(matched)pending.delete(key);
        add('tool_end',{toolName,toolCallId,requestId:call?.requestId??'unknown',pairing:matched?'matched':'missing_start',isError:boolean(event.isError),metadata:metadata(toolName,event,matched?call:undefined)});
      }
    }catch {degraded=true;overflow.droppedEvents++;}
  }
  function recordToolError(toolCallId,toolName,error) {
    // Capture only a known code at the tool boundary: pi may reduce thrown errors to text.
    try {
      const call=pending.get(identity(toolCallId));
      if(call?.toolName===toolName && errorCodes.has(error?.code))call.errorCode=error.code;
    }catch {degraded=true;}
  }
  function recordPolicy(loader, session) {
    try {if(typeof session?.systemPrompt==='string')systemPromptSha256=hash(session.systemPrompt);}catch{/* Optional SDK evidence is unavailable. */}
    try {
      const files=loader.getAgentsFiles?.()?.agentsFiles;
      if(!Array.isArray(files))return;
      const hashes=[];
      policyComplete=true;
      for(const file of files){
        if(typeof file?.path!=='string'||typeof file?.content!=='string'){policyComplete=false;continue;}
        const absolute=path.resolve(file.path);
        const scope=within(path.resolve(agentDir),absolute)?'agent-config':within(path.resolve(project),absolute)?'project':within(path.dirname(absolute),path.resolve(project))?'ancestor':'other';
        const sourceSha256=hash(file.content);
        hashes.push({scope,sourceSha256});add('policy',{scope,sourceSha256});
      }
      loadedPolicySha256=hash(JSON.stringify(hashes));
    }catch{policyComplete=false;}
  }
  function finish(reason='unknown') {
    if(finished)return structuredClone(finished);
    const incomplete={pendingTools:pending.size,pendingRequests,pendingCompactions,missingRequestStarts,missingCompactionStarts,missingStarts,duplicateStarts,untrackedTools,tools:[...pending.values()].slice(0,8).map(({toolCallId,toolName,requestId})=>({toolCallId,toolName,requestId,status:'incomplete'}))};
    const traceComplete=!degraded && pending.size===0 && pendingRequests===0 && pendingCompactions===0;
    events.push({...eventBase('trace_summary'),traceComplete,droppedEvents:overflow.droppedEvents,pendingTools:pending.size});
    finished={traceVersion:1,...ids,traceComplete,events,overflow,incomplete,
      endReason:['completed','cancelled','failed','turn_limit'].includes(reason)?reason:'unknown',systemPromptSha256,loadedPolicySha256,policyComplete,
      durability:'session-return-only',contextRetention:'unknown'};
    return structuredClone(finished);
  }
  return {observe,recordPolicy,recordToolError,finish};
}
