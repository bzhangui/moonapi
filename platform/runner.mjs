import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const artifact=path.join(root,'_build/js/release/build/cmd/bridge/bridge.js');
export async function loadCore(){if(!fs.existsSync(artifact))throw new Error('Build first: npm run build');await import(pathToFileURL(artifact));return globalThis.__moonapi_core;}
export class Engine {
  constructor(source,options={}) {
    if(typeof source!=='string'||Buffer.byteLength(source)>524288)throw new Error('OpenAPI file exceeds 512 KiB');
    this.source=source;this.options={timeout:1500,totalTimeout:60000,limit:64,seed:42,allowWrite:false,allowRemote:false,shrinkWrite:false,shrinkBudget:32,...options};
    for(const key of ['allowWrite','allowRemote','shrinkWrite'])if(typeof this.options[key]!=='boolean')throw new Error(key+' must be boolean');
    if(this.options.bearerToken!==undefined&&(typeof this.options.bearerToken!=='string'||Buffer.byteLength(this.options.bearerToken)>4096||/[\x00-\x1f\x7f]/.test(this.options.bearerToken)))throw new Error('Invalid bearer token encoding');
    for(const [key,min,max] of [['timeout',10,30000],['totalTimeout',100,600000],['limit',1,256],['seed',0,1000000],['shrinkBudget',0,128]])if(!Number.isInteger(this.options[key])||this.options[key]<min||this.options[key]>max)throw new Error('Invalid '+key+' budget');
  }
  command(action,args={}) {const response=JSON.parse(globalThis.__moonapi_core(JSON.stringify({action,source:this.source,...args})));if(!response.ok)throw new Error(response.error);return response.value;}
  plan(){return this.command('plan',{seed:this.options.seed,limit:this.options.limit}).cases;}
  base(base){const u=new URL(base);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.hash||u.search)throw new Error('Invalid base URL');if(!this.options.allowRemote&&!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw new Error('Remote targets require --allow-remote and authorization');return u;}
  permitted(test){return ['GET','HEAD','OPTIONS'].includes(test.verb)||this.options.allowWrite;}
  async observe(base,test,deadline) {
    if(!this.permitted(test))throw new Error('Write methods require --allow-write');
    let route=test.path;const u=this.base(base);const query=[];
    for(const p of test.parameters){if(p.in==='path')route=route.replaceAll('{'+p.name+'}',encodeURIComponent(String(p.value)));else query.push(p);}
    if(route.includes('{')||route.includes('}')||route.includes('\\')||route.startsWith('//'))throw new Error('Unbound or unsafe path template');
    const target=new URL(u.href.replace(/\/$/,'')+route);if(target.origin!==u.origin)throw new Error('Target origin changed');
    for(const p of query)target.searchParams.append(p.name,String(p.value));
    if(target.href.length>8192)throw new Error('URL byte budget exceeded');
    const payload=test.has_body?JSON.stringify(test.body):undefined;
    if(payload&&Buffer.byteLength(payload)>262144)throw new Error('Request payload exceeds 256 KiB');
    const headers={'accept':'application/json',...(payload?{'content-type':'application/json'}:{})};
    if(this.options.bearerToken)headers.authorization='Bearer '+this.options.bearerToken;
    const remaining=Math.min(this.options.timeout,deadline-Date.now());if(remaining<=0)throw new Error('Total execution deadline reached');
    let observation;
    try{
      const response=await fetch(target,{method:test.verb,headers,body:payload,redirect:'error',signal:AbortSignal.timeout(remaining)});
      let size=0;const chunks=[];
      for await(const chunk of response.body||[]){size+=chunk.length;if(size>262144)throw new Error('Response budget');chunks.push(chunk);}
      const bytes=Buffer.concat(chunks),raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);let body=null,jsonValid=false;
      if(raw){try{body=JSON.parse(raw);jsonValid=true;}catch{}}
      observation={status:response.status,body,raw,json_valid:jsonValid,response_bytes:size};
    }catch{observation={status:0,body:null,json_valid:false,response_bytes:0};}
    const finding=this.command('validate',{case:test,...observation}).finding;
    return {...observation,finding};
  }
  async shrink(base,test,initial,deadline){
    let best=test,observation=initial,attempts=0;
    if(!['GET','HEAD','OPTIONS'].includes(test.verb)&&!this.options.shrinkWrite)return {case:best,observation,attempts,reason:'write_shrinking_not_authorized'};
    if(initial.status===0||['access_or_rate_limit'].some(code=>initial.finding.issues.some(i=>i.code===code)))return {case:best,observation,attempts,reason:'transport_or_access_failure'};
    let improved=true;
    while(improved&&attempts<this.options.shrinkBudget&&Date.now()<deadline){improved=false;for(const candidate of this.command('shrink',{case:best}).candidates){if(attempts>=this.options.shrinkBudget||Date.now()>=deadline)break;attempts++;const next=await this.observe(base,candidate,deadline);if(!next.finding.passed&&next.finding.fingerprint===initial.finding.fingerprint){best=candidate;observation=next;improved=true;break;}}}
    return {case:best,observation,attempts,reason:'same_fingerprint_and_validity_preserved'};
  }
  async run(base,{scenario=null,saveRepro=false}={}) {
    this.base(base);const deadline=Date.now()+this.options.totalTimeout;const results=[],repros=[];let skipped=0,bindings={};
    const record=async test=>{
      const seen=await this.observe(base,test,deadline);const minimum=seen.finding.passed?{case:test,observation:seen,attempts:0,reason:'passed'}:await this.shrink(base,test,seen,deadline);
      results.push({case_id:test.id,operation_id:test.operation_id,verb:test.verb,negative:test.negative,status:seen.status,passed:seen.finding.passed,issues:seen.finding.issues,fingerprint:seen.finding.fingerprint,original_body_bytes:Buffer.byteLength(JSON.stringify(test.body)),minimized_body_bytes:Buffer.byteLength(JSON.stringify(minimum.case.body)),shrink_attempts:minimum.attempts,shrink_reason:minimum.reason});
      if(saveRepro&&!seen.finding.passed)repros.push({case:minimum.case,fingerprint:seen.finding.fingerprint});
      return seen;
    };
    if(scenario){if(!Array.isArray(scenario.steps)||!scenario.steps.length||scenario.steps.length>64)throw new Error('Scenario requires 1..64 steps');
      // Preflight all operation permissions before the first mutation.
      const verbs=new Map(this.command('plan',{limit:1}).operations.map(op=>[op.id,op.verb]));
      for(const step of scenario.steps){if(!verbs.has(step.operationId))throw new Error('Unknown scenario operation');if(!['GET','HEAD','OPTIONS'].includes(verbs.get(step.operationId))&&!this.options.allowWrite)throw new Error('Scenario requires --allow-write');}
      for(const step of scenario.steps){const test=this.command('scenario',{step,bindings}).case;const seen=await record(test);if(!seen.finding.passed)break;bindings=this.command('capture',{step,body:seen.body,bindings}).bindings;}
    }else{for(const test of this.plan()){if(!this.permitted(test)){skipped++;continue;}await record(test);}}
    const report={format:1,tool:'MoonAPI',version:'0.1.0',seed:this.options.seed,controlled_simulation:false,real_user_pilot:false,executed:results.length,skipped,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,complete:skipped===0&&(!scenario||results.length===scenario.steps.length),results};
    if(saveRepro)report.reproductions=repros;
    return report;
  }
}
export function saveReport(report){const dir=path.join(root,'.local/reports');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'report-'+randomUUID()+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});return file;}
