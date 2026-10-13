import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Engine,loadCore,saveReport} from '../platform/runner.mjs';
import {fixture} from '../examples/fixture.mjs';
const source=fs.readFileSync(new URL('../examples/spec.json',import.meta.url),'utf8');
await loadCore();
function spec(schema){return JSON.stringify({openapi:'3.0.3',paths:{'/value':{post:{operationId:'value',requestBody:{content:{'application/json':{schema}}},responses:{200:{}}}}}});}
test('privacy and unknown configuration cannot be enabled by misleading values',async()=>{
  const f=await fixture();try{
    for(const saveRepro of ['false',1,null])await assert.rejects(new Engine(source,{allowWrite:true}).run(f.base,{saveRepro}));
    assert.throws(()=>new Engine(source,{allowWrites:true}));
    await assert.rejects(new Engine(source).run(f.base,{saveRepros:true}));
    assert.equal(f.requests,0);
  }finally{await f.close();}
});
test('remote bearer authentication requires verified HTTPS before network effects',()=>{
  const e=new Engine(source,{allowRemote:true,bearerToken:'controlled-only-not-real'});
  assert.throws(()=>e.base('http://example.invalid'),/HTTPS/);
  const old=process.env.NODE_TLS_REJECT_UNAUTHORIZED;try{process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';assert.throws(()=>e.base('https://example.invalid'),/TLS/);}finally{if(old===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;else process.env.NODE_TLS_REJECT_UNAUTHORIZED=old;}
});
test('one-sided numeric bounds and array minimum generate valid supported cases',()=>{
  for(const schema of [{type:'integer',maximum:-1},{type:'number',maximum:-1000000},{type:'integer',minimum:1000000},{type:'array',minItems:3,items:{type:'boolean'}}]){
    const e=new Engine(spec(schema));const plan=e.plan();assert.ok(plan.length>=3);
    for(const c of plan.filter(c=>!c.negative))assert.equal(e.command('validate',{case:c,status:200,raw:'',json_valid:false}).finding.passed,true);
  }
});
test('edge seeds never produce duplicate case identifiers',()=>{
  for(const seed of [0,1,42]){const cases=new Engine(source,{seed}).plan();assert.equal(new Set(cases.map(c=>c.id)).size,cases.length);}
});
test('total execution deadline returns partial evidence instead of discarding results',async()=>{
  const f=await fixture({slow:true});try{const r=await new Engine(source,{allowWrite:true,totalTimeout:100,timeout:80,limit:24}).run(f.base);assert.equal(r.complete,false);assert.ok(r.executed>0&&r.executed<r.planned);assert.equal(r.stop_reason,'total_deadline');assert.ok(r.failed>0);}finally{await f.close();}
});
test('response-derived undeclared property names cannot leak in default report',async()=>{
  const secret='controlled-only-secret-property';
  const sockets=new Set();const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({[secret]:true}));});server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const description=JSON.stringify({openapi:'3.0.3',paths:{'/value':{get:{operationId:'value',responses:{200:{content:{'application/json':{schema:{type:'object',additionalProperties:false}}}}}}}}});const r=await new Engine(description,{limit:1}).run('http://127.0.0.1:'+server.address().port);assert.equal(r.failed,1);assert.ok(!JSON.stringify(r).includes(secret));}finally{for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));}
});
test('private reports refuse linked directories without writing to the target',()=>{
  const parent=fs.realpathSync(os.tmpdir()),temp=fs.mkdtempSync(path.join(parent,'moonapi-private-test-')),project=path.join(temp,'project'),target=path.join(temp,'target');fs.mkdirSync(project);fs.mkdirSync(target);const link=path.join(project,'.local');
  try{fs.symlinkSync(target,link,process.platform==='win32'?'junction':'dir');assert.throws(()=>saveReport({synthetic:true},{projectRoot:project}),/link/);assert.deepEqual(fs.readdirSync(target),[]);}finally{if(fs.existsSync(link))fs.unlinkSync(link);if(path.dirname(temp)!==parent||!path.basename(temp).startsWith('moonapi-private-test-'))throw new Error('Unsafe cleanup');fs.rmSync(temp,{recursive:true,force:true});}
});
test('scenario shape assertions are preflighted before any write',async()=>{
  const f=await fixture();try{for(const step of [{operationId:'health',status:'200'},{operationId:'health',negative:'false'},{operationId:'health',capture:[]},{operationId:'health',parameters:null},{operationId:'health',assertions:[]}]){await assert.rejects(new Engine(source,{allowWrite:true}).run(f.base,{scenario:{steps:[{operationId:'create',body:{name:'owned-only'}},step]}}));}assert.equal(f.requests,0);}finally{await f.close();}
});
test('HEAD contracts validate status without demanding a response body',async()=>{
  const sockets=new Set();const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end();});server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const e=new Engine(JSON.stringify({openapi:'3.0.3',paths:{'/head':{head:{operationId:'head',responses:{200:{content:{'application/json':{schema:{type:'object'}}}}}}}}}));const r=await e.run('http://127.0.0.1:'+server.address().port);assert.equal(r.failed,0);assert.equal(r.complete,true);}finally{for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));}
});
test('supported scalar and collection bounds remain valid across seeded combinations',()=>{
  for(let i=0;i<24;i++){const schema=i%2?{type:'integer',minimum:-24+i,maximum:i}:{type:'array',minItems:i%5,items:{type:'string',minLength:1,maxLength:3}};const e=new Engine(spec(schema));for(const seed of [0,1,42])assert.ok(e.command('plan',{seed,limit:64}).cases.some(c=>!c.negative));}
});
test('CLI errors do not echo secret-looking unsupported option values',()=>{
  const secret='controlled-only-not-real-value',cli=fileURLToPath(new URL('../bin/moonapi.mjs',import.meta.url)),file=fileURLToPath(new URL('../examples/spec.json',import.meta.url));const result=spawnSync(process.execPath,[cli,'run',file,'--bearer-token='+secret],{encoding:'utf8'});assert.equal(result.status,2);assert.ok(!result.stderr.includes(secret));
});
test('runtime capture errors preserve executed writes and incomplete evidence',async()=>{
  const f=await fixture();try{const r=await new Engine(source,{allowWrite:true}).run(f.base,{scenario:{name:'owned-capture-error',steps:[{operationId:'create',body:{name:'owned-only'},capture:{missing:'/absent'}},{operationId:'health'}]}});assert.equal(r.complete,false);assert.equal(r.stop_reason,'scenario_configuration_error');assert.equal(r.executed,1);assert.equal(f.items.size,1);assert.deepEqual(r.errors,[{step:1,stage:'capture',code:'configuration_error'}]);assert.ok(!JSON.stringify(r).includes('owned-only'));}finally{await f.close();}
});
