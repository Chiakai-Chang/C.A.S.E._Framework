import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const adapter = await import('../integrations/pi/sdk-session.mjs').catch(e => {
    if (e.code === 'ERR_MODULE_NOT_FOUND')
        return {};
    throw e;
});
test('SDK failure and cancellation retain observations and available costs before disposal', async (t) => {
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-sdk-failure-')));
    t.after(() => fs.rmSync(project, { recursive: true, force: true }));
    for (const mode of ['failure', 'cancel', 'unknown']) {
        let disposed = false, listener;
        const controller = new AbortController();
        const sdk = { SettingsManager: { inMemory: v => v }, SessionManager: { inMemory: () => ({}) }, DefaultResourceLoader: class {
                async reload() {
                }
            },
            async createAgentSession() {
                return { session: { sessionId: `sdk-${mode}`, subscribe(fn) {
                            listener = fn;
                            return () => {
                            };
                        }, async prompt() {
                            listener({ type: 'tool_execution_start', toolCallId: 'write-1', toolName: 'case_write', args: { path: 'wrong.json', content: 'private write body' } });
                            listener({ type: 'tool_execution_end', toolCallId: 'write-1', toolName: 'case_write', isError: true, result: { content: [{ type: 'text', text: 'Write is outside packet writeScope' }] } });
                            if (mode === 'cancel')
                                controller.abort();
                            throw new Error('prompt stopped');
                        }, getSessionStats() {
                            assert.equal(disposed, false);
                            if (mode === 'unknown')
                                throw new Error('stats unavailable');
                            return { tokens: { input: 21, output: 5 }, toolCalls: 1, cost: 0.01 };
                        }, getLastAssistantText: () => '', abort: async () => {
                        }, dispose() {
                            disposed = true;
                        } } };
            } };
        const run = await adapter.createPiSessionRunner({ project, agentDir: project, model: { id: 'local', provider: 'local' }, modelRuntime: {}, sdk });
        await assert.rejects(run({ role: 'worker', prompt: 'work', writeScope: ['out'], onStart: () => {
            }, signal: controller.signal }), failure => {
            assert.equal(failure.sessionEvidence.observations[0].toolName, 'case_write');
            assert.deepEqual(failure.sessionEvidence.observations[0].writeRequest, {path:'wrong.json',writeScope:['out']});
            assert.equal(JSON.stringify(failure.sessionEvidence.observations).includes('private write body'),false);
            assert.equal(failure.sessionEvidence.usage === 'unknown' ? 'unknown' : failure.sessionEvidence.usage.input, mode === 'unknown' ? 'unknown' : 21);
            if (mode === 'cancel')
                assert.equal(failure.code, 'CANCELLED');
            return true;
        });
        assert.equal(disposed, true);
    }
});
for(const mode of ['still-prose','turn-limit','cancelled'])test(`reply correction is bounded in the existing session: ${mode}`,async t=>{
    const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-correction-')));
    t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
    let prompts=0,listener;
    const controller=new AbortController();
    const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){}},
      async createAgentSession(){return {session:{sessionId:'one-session',subscribe(fn){listener=fn;return ()=>{};},
        async prompt(){prompts++;listener({type:'turn_start'});if(mode==='cancelled')controller.abort();},
        getLastAssistantText:()=> 'Unstructured reply',getSessionStats:()=>({}),abort:async()=>{},dispose(){}}};}};
    const run=await adapter.createPiSessionRunner({project,agentDir:project,model:{id:'local',provider:'local'},modelRuntime:{},sdk,maxTurns:mode==='turn-limit'?1:3});
    const request={role:'planner',prompt:'plan',onStart(){},signal:controller.signal};
    if(mode==='cancelled')await assert.rejects(run(request),failure=>{
      assert.equal(failure.code,'CANCELLED');assert.deepEqual(failure.sessionEvidence.replyCorrections,[]);return true;
    });
    else {
      const reply=await run(request);
      assert.equal(reply.replyCorrections.length,mode==='still-prose'?1:0);
      assert.equal(reply.resultTransport,'final-text');
    }
    assert.equal(prompts,mode==='still-prose'?2:1);
});

test('SDK session factory requires explicit model and does not fall back to a cloud default', async () => {
    assert.equal(typeof adapter.createPiSessionRunner, 'function', 'SDK adapter is not implemented');
    await assert.rejects(adapter.createPiSessionRunner({ project: '.', agentDir: '.', sdk: {} }), { code: 'MODEL_REQUIRED' });
});
test('SDK adapter produces fresh bounded sessions and captures tool evidence', async (t) => {
    assert.equal(typeof adapter.createPiSessionRunner, 'function', 'SDK adapter is not implemented');
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-sdk-')));
    t.after(() => fs.rmSync(project, { recursive: true, force: true }));
    let next = 0;
    let disposed = 0;
    const inputs = [];
    const sdk = {
        SettingsManager: { inMemory: value => value },
        SessionManager: { inMemory: () => ({ id: `sdk-${++next}` }) },
        DefaultResourceLoader: class {
            constructor(options) {
                this.options = options;
            }
            async reload() {
            }
        },
        async createAgentSession(options) {
            inputs.push(options);
            let listener;
            return { session: {
                    sessionId: options.sessionManager.id,
                    subscribe(fn) {
                        listener = fn;
                        return () => {
                        };
                    },
                    async prompt() {
                        listener({ type: 'tool_execution_end', toolName: 'case_read', result: { content: [{ type: 'text', text: 'observed' }] } });
                    },
                    getLastAssistantText: () => options.tools.includes('case_write') ? '{"summary":"written"}' : '{"passed":true}',
                    getSessionStats: () => ({ tokens: { input: 12, output: 8 }, toolCalls: 1, cost: 0 }),
                    abort: async () => {
                    }, dispose() {
                        disposed++;
                    },
                } };
        },
    };
    const run = await adapter.createPiSessionRunner({ project, agentDir: project, sdk, modelRuntime: {},
        model: { id: 'local', provider: 'local', contextWindow: 8192 }, maxTurns: 5 });
    const starts = [];
    const replies = [];
    for (const role of ['worker', 'reviewer'])
        replies.push(await run({ role, prompt: 'bounded packet', writeScope: ['output.txt'], onStart: id => starts.push(id) }));
    assert.deepEqual(starts, ['sdk-1', 'sdk-2']);
    assert.equal(disposed, 2);
    assert.equal(replies[0].observations[0].toolName, 'case_read');
    assert.equal(replies[1].usage.input, 12);
    assert.equal(replies[0].text, '{"summary":"written"}');
    assert.equal(replies[0].resultTransport, 'final-text');
    assert.equal(inputs[0].resourceLoader.options.noExtensions, true);
    assert.equal(inputs[0].resourceLoader.options.noSkills, true);
    assert.equal(inputs[0].resourceLoader.options.noContextFiles, false);
    assert.deepEqual(inputs[1].tools.sort(), ['case_list', 'case_read', 'case_result']);
});

for (const mode of ['result','repair-prose','correct-invalid','conflict','repeat','late-read','late-write','late-check']) test(`structured result transport: ${mode}`,async t=>{
    const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-sdk-result-')));
    t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
    fs.writeFileSync(path.join(project,'source'),'source evidence');
    const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){}},
      async createAgentSession(options){let listener,prompts=0;return {session:{sessionId:'structured',subscribe(fn){listener=fn;return ()=>{};},
        async prompt(){
          async function invoke(name,args){
            const tool=options.customTools.find(t=>t.name===name);
            assert.ok(tool,`${name} must be an actual custom tool`);
            try{const result=await tool.execute('call',args);listener({type:'tool_execution_end',toolName:name,result,isError:false});return result;}
            catch(e){listener({type:'tool_execution_end',toolName:name,result:{content:[{type:'text',text:e.message}],details:{code:e.code}},isError:true});}
          }
          const read=await invoke('case_read',{path:'source'});assert.match(read.content[0].text,/source evidence/);
          if(mode==='repair-prose' && ++prompts===1)return;
          if(mode==='correct-invalid'){
            await invoke('case_result',{result:{summary:'invalid reply'}});
            const lastError = await invoke('case_read',{path:'source'});
            assert.ok(lastError,'invalid result must not close the session');
            assert.match(lastError.content[0].text,/source evidence/,'invalid result must leave session open');
          }
          await invoke('case_result',{result:{changeRequest:{reason:'need prerequisite'}}});
          if(mode==='conflict')await invoke('case_result',{result:{summary:'contradictory success'}});
          if(mode==='repeat')await invoke('case_result',{result:{changeRequest:{reason:'need prerequisite'}}});
          if(mode==='late-read')await invoke('case_read',{path:'source'});
          if(mode==='late-write')await invoke('case_write',{path:'out',content:'must never write'});
          if(mode==='late-check')await invoke('case_check',{id:'late'});
        },getLastAssistantText:()=> 'I have explained the result in prose.',getSessionStats:()=>({toolCalls:2}),abort:async()=>{},dispose(){}}};}};
    const run=await adapter.createPiSessionRunner({project,agentDir:project,model:{id:'local',provider:'local'},modelRuntime:{},sdk,
      checks:{late:{command:process.execPath,args:['-e',"require('node:fs').writeFileSync('out','must never execute')"],criterionIds:['a']}}});
    if(['result','correct-invalid','repair-prose','repeat'].includes(mode)){
      const reply=await run({role:'worker',prompt:'work',writeScope:['out'],criterionIds:['a'],onStart:()=>{},
        validateResult:result=>{if(!result.changeRequest)throw Object.assign(new Error('Missing change request'),{code:'INVALID_REPLY'});}});
      assert.deepEqual(JSON.parse(reply.text),{changeRequest:{reason:'need prerequisite'}});
      assert.equal(reply.rawFinalText,'I have explained the result in prose.');
      assert.equal(reply.resultTransport,'case_result');
      assert.equal(reply.observations[mode==='repair-prose'?2:1].toolName,'case_result');
      if(mode==='repair-prose'){
        assert.equal(reply.replyCorrections.length,1);
        assert.equal(reply.replyCorrections[0].priorText,'I have explained the result in prose.');
      }
      if(mode==='correct-invalid')assert.equal(reply.observations[1].isError,true);
    }else await assert.rejects(run({role:'worker',prompt:'work',writeScope:['out'],criterionIds:['a'],onStart:()=>{}}),failure=>{
      assert.equal(failure.code,'RESULT_ALREADY_RECORDED');
      assert.equal(failure.sessionEvidence.observations.at(-1).isError,true);
      assert.equal(failure.sessionEvidence.observations.at(-1).result.details.code,'RESULT_ALREADY_RECORDED');
      assert.equal(failure.sessionEvidence.rawFinalText,'I have explained the result in prose.');return true;
    });
    assert.equal(fs.existsSync(path.join(project,'out')),false);
});
for(const role of ['worker','reviewer','planner','integrator'])test(`capability context reflects actual scoped tools and executable check IDs: ${role}`,async t=>{
    const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-sdk-capabilities-')));
    t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
    const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{
      constructor(options){this.options=options;}async reload(){}
    },async createAgentSession(options){
      const section=options.resourceLoader.options.appendSystemPrompt.find(s=>s.startsWith('{'));
      assert.ok(section,'machine-readable capabilities must accompany the actual tool boundary');
      const caps=JSON.parse(section).caseCapabilities;
      assert.equal(caps.role,role);
      assert.deepEqual(caps.availableTools,options.customTools.map(t=>t.name));
      assert.deepEqual(caps.availableTools,options.tools);
      // pi only includes custom tools with promptSnippet in its system tool list.
      for(const tool of options.customTools){
        assert.equal(typeof tool.promptSnippet,'string',`${tool.name} missing system tool-list entry`);
        assert.ok(tool.promptSnippet.trim().length>0);
      }
      if(role==='planner'){
        const schema=options.customTools.find(t=>t.name==='case_result').parameters.properties.result;
        assert.deepEqual(schema.properties?.packets.items.properties.inputs.items.properties.delivery.enum,['inline','indexed']);
        assert.ok(schema.properties?.blocked,'planner must retain external-blocker exit');
      }
      assert.deepEqual(caps.writeScope,role==='worker'?['output']:[]);
      assert.deepEqual(caps.approvedCheckIds,role==='planner'?[]:role==='integrator'?['exact','whole','unrelated']:['exact']);
      assert.deepEqual(caps.packetChecks,{kind:'acceptance-descriptions',executable:false});
      const check=options.customTools.find(t=>t.name==='case_check');
      if(role==='planner')assert.equal(check,undefined);
      else {
        assert.equal((await check.execute('actual',{id:caps.approvedCheckIds[0]})).details.exitCode,0);
        await assert.rejects(check.execute('description',{id:'normalized-lines'}),{code:'CHECK_NOT_APPROVED'});
        if(role!=='integrator')await assert.rejects(check.execute('premature',{id:'whole'}),{code:'CHECK_NOT_APPROVED'});
      }
      const write=options.customTools.find(t=>t.name==='case_write');
      if(role==='worker'){
        await write.execute('write',{path:caps.writeScope[0],content:'written through declared scope'});
        assert.equal(fs.readFileSync(path.join(project,'output'),'utf8'),'written through declared scope');
      }else assert.equal(write,undefined);
      return {session:{sessionId:'capabilities',subscribe:()=>()=>{},prompt:async()=>{},getLastAssistantText:()=>role==='worker'?'{"summary":"written"}':'{"passed":true}',getSessionStats:()=>({}),dispose(){},abort:async()=>{}}};
    }};
    const run=await adapter.createPiSessionRunner({project,agentDir:project,model:{id:'local',provider:'local'},modelRuntime:{},sdk,
      checks:{exact:{command:process.execPath,args:['-e','process.stdout.write("checked")'],criterionIds:['a']},whole:{command:process.execPath,args:['-e','throw Error("not built yet")']},unrelated:{command:process.execPath,args:[],criterionIds:['b']}}});
    await run({role,prompt:'packet check normalized-lines describes acceptance',writeScope:['output'],criterionIds:['a'],onStart:()=>{}});
});
