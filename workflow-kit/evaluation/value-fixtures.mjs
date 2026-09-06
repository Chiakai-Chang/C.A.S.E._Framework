import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
const encode=value=>JSON.stringify(value,null,2)+'\n';
export function fixture(name){
  if(name==='simple'){
    const input=[{id:' b ',active:true},{id:'a',active:true},{id:'b',active:true},{id:'c',active:false}];
    const goal='讀 input.json，只保留 active 為 true 的項目，id 去除頭尾空白後去重、依字母排序。只寫 result.json，格式恰為 {"ids":[字串],"count":數字}。原始來源不可更動。';
    return {name,goal,sources:{'input.json':encode(input),'requirements.md':goal},scope:['result.json'],
      expected:{'result.json':{ids:[...new Set(input.filter(x=>x.active).map(x=>x.id.trim()))].sort(),count:2}}};
  }
  if(!['multi-source','resume'].includes(name))throw new Error('Unknown scenario');
  const orders=[{id:'a',item:'pen',quantity:2,status:'paid'},{id:'b',item:'bag',quantity:3,status:'paid'},
    {id:'c',item:'pen',quantity:9,status:'cancelled'},{id:'d',item:'pen',quantity:1,status:'paid'},{id:'e',item:'bag',quantity:2,status:'paid'}];
  const prices={pen:{amount:12,currency:'USD'},bag:{amount:7,currency:'EUR'}};
  const returns=[{orderId:'a',quantity:1,status:'approved'},{orderId:'b',quantity:1,status:'pending'},{orderId:'e',quantity:2,status:'approved'}];
  const rates={USD:32,EUR:35};
  const policy='有效規則版本 2026-09。只用 prices-current.json，不使用 prices-archive.json。排除 cancelled 訂單；只扣 approved 退貨，pending 不扣。保留淨數量為零的列。依 orderId 字母排序。不得改任何來源。先整理 normalized.json，再依該檔加總 report.json。';
const goal='依 policy.md 與 orders.json、prices-current.json、returns.json、rates.json，先寫 normalized.json，格式恰為 {"lines":[{"orderId":字串,"netQuantity":數字,"currency":字串,"netAmount":數字,"netTwd":數字}]}。netAmount 是扣有效退貨後數量乘單價；netTwd 再乘匯率。再只依 normalized.json 金額加總 report.json，格式恰為 {"netTwd":數字,"byCurrency":{"USD":數字,"EUR":數字},"excludedOrderIds":[被排除訂單ID],"policyVersion":字串}。byCurrency 分幣別加總原幣 netAmount，不是 netTwd。原始資料不可改；保留零數量訂單列，不新增欄位。';
  const lines=orders.filter(o=>o.status!=='cancelled').map(o=>{
    const netQuantity=o.quantity-returns.filter(r=>r.orderId===o.id&&r.status==='approved').reduce((n,r)=>n+r.quantity,0);
    const {amount,currency}=prices[o.item],netAmount=netQuantity*amount;
    return {orderId:o.id,netQuantity,currency,netAmount,netTwd:netAmount*rates[currency]};
  }).sort((a,b)=>a.orderId.localeCompare(b.orderId));
  const byCurrency={USD:0,EUR:0};for(const l of lines)byCurrency[l.currency]+=l.netAmount;
  return {name,goal,sources:{'orders.json':encode(orders),'prices-current.json':encode(prices),
    'prices-archive.json':encode({pen:{amount:3,currency:'USD'},bag:{amount:99,currency:'EUR'}}),
    'returns.json':encode(returns),'rates.json':encode(rates),'policy.md':policy,'requirements.md':goal},
    scope:['normalized.json','report.json'],expected:{'normalized.json':{lines},'report.json':{
      netTwd:lines.reduce((n,l)=>n+l.netTwd,0),byCurrency,excludedOrderIds:orders.filter(o=>o.status==='cancelled').map(o=>o.id).sort(),policyVersion:'2026-09'}}};
}
export function grade(project,spec,files=spec.scope){
  const checks=files.map(file=>{
    try {const actual=JSON.parse(fs.readFileSync(path.join(project,file),'utf8'));return {file,actual,expected:spec.expected[file],passed:isDeepStrictEqual(actual,spec.expected[file])};}
    catch(e){return {file,passed:false,error:e.message};}
  });
  const sourcesUnchanged=Object.entries(spec.sources).every(([f,v])=>fs.existsSync(path.join(project,f))&&fs.readFileSync(path.join(project,f),'utf8')===v);
  return {checks,sourcesUnchanged,artifactPassed:checks.every(c=>c.passed)&&sourcesUnchanged};
}
