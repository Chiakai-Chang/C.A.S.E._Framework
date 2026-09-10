#!/usr/bin/env node
// Optional offline SDK diagnostic. Builds messages in memory; never calls a model.
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const [sdkEntry,...extra]=process.argv.slice(2);
assert.ok(sdkEntry&&extra.length===0,'Usage: node compaction-budget-probe.mjs PATH/TO/pi-coding-agent/dist/index.js');
const entry=path.resolve(sdkEntry);
assert.ok(path.basename(entry)==='index.js'&&path.basename(path.dirname(entry))==='dist','Pass an explicit SDK dist/index.js entry');
const moduleUrl=new URL('./core/compaction/compaction.js',pathToFileURL(entry));
const {prepareCompaction,estimateTokens,estimateContextTokens,shouldCompact,DEFAULT_COMPACTION_SETTINGS}=await import(moduleUrl.href);
const began=performance.now(),entries=[];
const add=message=>entries.push({type:'message',id:`e${entries.length}`,parentId:entries.length?`e${entries.length-1}`:null,timestamp:'2026-09-10T00:00:00.000Z',message});
const assistant={role:'assistant',api:'openai-completions',provider:'local',model:'synthetic',timestamp:0};
add({role:'user',content:'讀取來源並完成任務',timestamp:0});
for(let i=0;i<12;i++){
  add({...assistant,content:[{type:'toolCall',id:`r${i}`,name:'case_read',arguments:{path:'source.md',startLine:i*100+1}}],stopReason:'toolUse'});
  add({role:'toolResult',toolCallId:`r${i}`,toolName:'case_read',content:[{type:'text',text:'中文來源資料'.repeat(667)}],isError:false,timestamp:0});
}
add({...assistant,content:[{type:'text',text:'繼續核對來源'}],stopReason:'stop',usage:{input:28000,output:10,cacheRead:0,cacheWrite:0,totalTokens:28010,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}});
const messages=entries.map(e=>e.message),usage=estimateContextTokens(messages);
assert.equal(DEFAULT_COMPACTION_SETTINGS.reserveTokens,16384,'SDK defaults changed; reassess this diagnostic');
assert.equal(DEFAULT_COMPACTION_SETTINGS.keepRecentTokens,20000,'SDK defaults changed; reassess this diagnostic');
assert.equal(shouldCompact(usage.tokens,32768,DEFAULT_COMPACTION_SETTINGS),true);
assert.equal(prepareCompaction(entries,DEFAULT_COMPACTION_SETTINGS),undefined);
const smaller=prepareCompaction(entries,{...DEFAULT_COMPACTION_SETTINGS,keepRecentTokens:8192});
assert.ok(smaller&&smaller.turnPrefixMessages.length>0,'Expected a nonempty prefix under the smaller retention budget');
console.log(JSON.stringify({
  synthetic:true,kind:'offline-compaction-budget-probe/1',sdkModule:moduleUrl.href,
  limitations:['Synthetic fixture, not a replay of the original complete session history.','No model request, summarization quality test or file mutation performed.','Assistant usage is supplied synthetic data, not measured tokenization of these messages.'],
  input:{entries:entries.length,toolResults:12,charactersPerToolResult:4002,assistantUsage:{input:28000,output:10,totalTokens:28010},contextWindow:32768},
  estimatedByChars:messages.reduce((n,m)=>n+estimateTokens(m),0),usageContext:usage,
  defaultSettings:DEFAULT_COMPACTION_SETTINGS,shouldCompact:true,
  results:[{keepRecentTokens:20000,prepared:false},{keepRecentTokens:8192,prepared:true,firstKeptEntryId:smaller.firstKeptEntryId,tokensBefore:smaller.tokensBefore,messagesToSummarize:smaller.messagesToSummarize.length,turnPrefixMessages:smaller.turnPrefixMessages.length,isSplitTurn:smaller.isSplitTurn}],
  elapsedMs:performance.now()-began,
},null,2));
