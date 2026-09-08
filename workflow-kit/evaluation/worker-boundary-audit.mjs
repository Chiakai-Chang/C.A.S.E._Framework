// Offline SDK diagnostic: scripted provider replies are NOT model-quality evidence.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createPiSessionRunner} from '../integrations/pi/sdk-session.mjs';

const [sdkPath,evidencePath,outputPath]=process.argv.slice(2);
assert.ok(sdkPath&&evidencePath&&outputPath,'usage: node worker-boundary-audit.mjs SDK PRIOR_EVIDENCE NEW_OUTPUT');
assert.ok(!fs.existsSync(outputPath),'output must be new');
const hash=value=>createHash('sha256').update(value).digest('hex');
const priorBytes=fs.readFileSync(evidencePath);
const prior=JSON.parse(priorBytes).results.find(r=>r.id==='B');
const worker=prior.sessions.find(s=>s.role==='worker');
const context=JSON.parse(worker.prompt.slice(0,worker.prompt.indexOf('\nPrior review findings:')));
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-worker-boundary-')));
const project=path.join(root,'project'),agentDir=path.join(root,'config');
fs.mkdirSync(project);fs.mkdirSync(agentDir);
for(const m of context.requiredMaterials){
  assert.equal(path.basename(m.path),m.path);
  assert.equal(hash(m.content),m.sha256);
  fs.writeFileSync(path.join(project,m.path),m.content,{flag:'wx'});
}
const calls=[],sent=[];
const outputName=context.packet.deliverables[0].path;
assert.equal(outputName,'adoption-map.json');
const report={kind:'scripted-sdk-boundary-audit/1',modelGenerated:false,priorSha256:hash(priorBytes),
  promptSha256:hash(worker.prompt),project,requests:calls,passed:false};
const scripted=[null,
  {name:'case_result',arguments:{result:{summary:'Plan submitted',packets:[{id:'wrong-role'}]}}},
  {name:'case_result',arguments:{result:{summary:'premature'}}},
  {name:'case_write',arguments:{path:outputName,content:'{"synthetic":true}\n'}},
  {name:'case_result',arguments:{result:{summary:'synthetic wiring check only'}}}];
const server=http.createServer(async(req,res)=>{
  try{
    assert.equal(req.url,'/v1/chat/completions');
    let body='';for await(const chunk of req)body+=chunk;
    const p=JSON.parse(body),n=calls.length;
    const wireTools=p.tools.map(t=>t.function);
    const resultSchema=wireTools.find(t=>t.name==='case_result').parameters.properties.result;
    assert.equal(resultSchema.additionalProperties,false);
    assert.ok(!Object.hasOwn(resultSchema.properties,'packets'));
    assert.ok(wireTools.some(t=>t.name==='case_write'));
    assert.match(p.messages[0].content,/You are the CASE worker/);
    const userText=typeof p.messages[1].content==='string'?p.messages[1].content:p.messages[1].content.map(c=>c.text??'').join('');
    assert.equal(hash(userText),hash(worker.prompt));
    const ids=new Set();
    for(const m of p.messages){
      for(const call of m.tool_calls??[])ids.add(call.id);
      if(m.role==='tool')assert.ok(ids.has(m.tool_call_id),'tool result lacks preceding matching call');
    }
    calls.push({roles:p.messages.map(m=>m.role),maxTokens:p.max_tokens,
      workerResultSchema:resultSchema,tools:wireTools.map(t=>t.name),
      toolMessages:p.messages.filter(m=>m.role==='tool').map(m=>({id:m.tool_call_id,content:m.content}))});
    assert.ok(n<scripted.length,'unexpected additional request');
    const chosen=scripted[n];
    const delta=chosen?{role:'assistant',tool_calls:[{index:0,id:`call_${n}`,type:'function',function:{name:chosen.name,arguments:JSON.stringify(chosen.arguments)}}]}
      :{role:'assistant',reasoning_content:'Synthetic test reasoning, not a model thought.'};
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(d,finish)=>res.write(`data: ${JSON.stringify({id:`synthetic_${n}`,object:'chat.completion.chunk',created:0,model:'boundary-test',choices:[{index:0,delta:d,finish_reason:finish}]})}\n\n`);
    emit(delta,null);emit({},chosen?'tool_calls':'length');res.end('data: [DONE]\n\n');sent.push(n);
  }catch(e){report.serverError=e.message;res.writeHead(500);res.end(e.message);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
  const sdk=await import(pathToFileURL(path.resolve(sdkPath)).href);
  const runtime=await sdk.ModelRuntime.create({authPath:path.join(agentDir,'auth.json'),modelsPath:null,modelsStorePath:path.join(agentDir,'models.json'),allowModelNetwork:false});
  runtime.registerProvider('boundary-test',{baseUrl:`http://127.0.0.1:${server.address().port}/v1`,api:'openai-completions',apiKey:'synthetic',models:[{
    id:'boundary-test',name:'boundary-test',reasoning:true,input:['text'],contextWindow:32768,maxTokens:4096,
    compat:{supportsDeveloperRole:false,supportsReasoningEffort:false,thinkingFormat:'qwen-chat-template',maxTokensField:'max_tokens'},cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]});
  const run=await createPiSessionRunner({project,agentDir,sdk,model:runtime.getModel('boundary-test','boundary-test'),modelRuntime:runtime,thinkingLevel:'medium'});
  const result=await run({role:'worker',prompt:worker.prompt,writeScope:[outputName],onStart(){},
    onDiscovery(){throw new Error('unexpected discovery');},signal:AbortSignal.timeout(30000),
    validateResult(){if(!fs.existsSync(path.join(project,outputName)))throw Object.assign(new Error(`Missing ${outputName}`),{code:'MISSING_ARTIFACT'});}});
  assert.equal(calls.length,5);
  assert.deepEqual(calls[1].roles,['system','user','user']);
  assert.match(calls[2].toolMessages.at(-1).content,/packets|additional/i);
  assert.match(calls[3].toolMessages.at(-1).content,/Missing adoption-map.json/);
  assert.equal(fs.readFileSync(path.join(project,outputName),'utf8'),'{"synthetic":true}\n');
  for(const m of context.requiredMaterials)assert.equal(hash(fs.readFileSync(path.join(project,m.path))),m.sha256);
  assert.equal(result.resultTransport,'case_result');
  report.passed=true;report.replyCorrections=result.replyCorrections;
  report.conclusion='Worker schema and tool-call pairing correct; length-only synthetic response omitted; same-session file repair accepted. No model-quality claim.';
}catch(e){report.error={name:e.name,message:e.message};process.exitCode=1;}
finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(outputPath,JSON.stringify(report,null,2),{flag:'wx'});}
console.log(JSON.stringify({passed:report.passed,requests:calls.length,error:report.error,output:outputPath}));
