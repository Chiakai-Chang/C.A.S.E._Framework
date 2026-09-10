import fs from 'node:fs';
import {createHash} from 'node:crypto';

const byteLimit=1024*1024;
const outputLimit=24000;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};

// The caller resolves permissions and protected paths before calling this helper.
export function searchMaterial({file,relative,query,startLine=1,maxMatches=20}) {
  if(typeof query!=='string'||query.length===0||query.length>256||/[\r\n]/.test(query)||
     !Number.isSafeInteger(startLine)||startLine<1||
     !Number.isSafeInteger(maxMatches)||maxMatches<1||maxMatches>20||
     typeof file!=='string'||!file||typeof relative!=='string'||!relative)
    fail('INVALID_ARGUMENT','Supply a nonempty single-line literal query of at most 256 UTF-16 units, a positive startLine, and maxMatches from 1 to 20.');
  if(!fs.lstatSync(file).isFile())fail('UNSAFE_TOOL_PATH','Expected a regular file of at most 1 MiB.');
  const fd=fs.openSync(file,'r');
  let bytes;
  try {
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.size>byteLimit)fail('UNSAFE_TOOL_PATH','Expected a regular file of at most 1 MiB.');
    // Bound actual reading too, in case the file grows after its size was checked.
    const buffer=Buffer.alloc(byteLimit+1);
    let length=0;
    while(length<buffer.length){
      const count=fs.readSync(fd,buffer,length,buffer.length-length,null);
      if(count===0)break;
      length+=count;
    }
    if(length>byteLimit)fail('UNSAFE_TOOL_PATH','Expected a regular file of at most 1 MiB.');
    bytes=buffer.subarray(0,length);
  } finally {fs.closeSync(fd);}
  const lines=bytes.toString('utf8').split(/\r?\n/);
  const base={receiptVersion:1,path:relative,sourceSha256:createHash('sha256').update(bytes).digest('hex'),
    query,startLine,lines:lines.length,scope:'single-file-from-startLine'};
  const page=(matches,nextStartLine=null)=>({...base,matches,noMatches:matches.length===0,
    truncated:nextStartLine!==null,nextStartLine});
  const size=matches=>Math.max(JSON.stringify(page(matches)).length,JSON.stringify(page(matches,lines.length)).length);
  if(size([])>outputLimit)
    fail('SEARCH_RECEIPT_TOO_LARGE','Search receipt exceeds 24000 UTF-16 units; no partial result was returned.');
  const matches=[];
  for(let index=startLine-1;index<lines.length;index++){
    if(!lines[index].includes(query))continue;
    const match={line:index+1,text:lines[index]};
    if(matches.length===maxMatches)return page(matches,index+1);
    if(size([match])>outputLimit)
      fail('LINE_TOO_LONG','A matched line cannot fit in the 24000 UTF-16 search receipt. No line was silently shortened; use the existing discovery process for necessary material preparation.');
    if(size([...matches,match])>outputLimit)return page(matches,index+1);
    matches.push(match);
  }
  return page(matches);
}
