import fs from 'node:fs';
import assert from 'node:assert/strict';
import {Engine,loadCore,saveReport} from '../platform/runner.mjs';
import {fixture} from './fixture.mjs';
const source=fs.readFileSync(new URL('./spec.json',import.meta.url),'utf8');
await loadCore();const healthy=await fixture(),buggy=await fixture({bug:true});
try{
  const engine=new Engine(source,{allowWrite:true,shrinkWrite:true,limit:64});
  const normal=await engine.run(healthy.base);assert.equal(normal.failed,0);assert.ok(normal.executed>0);
  const workflow=await engine.run(healthy.base,{scenario:JSON.parse(fs.readFileSync(new URL('./scenario.json',import.meta.url),'utf8'))});assert.equal(workflow.failed,0);assert.equal(workflow.executed,5);
  const broken=await engine.run(buggy.base);const shrunk=broken.results.find(r=>r.operation_id==='echo'&&r.shrink_attempts>0&&r.minimized_body_bytes<r.original_body_bytes);assert.ok(shrunk);assert.ok(broken.failed>0);
  for(const report of [normal,workflow,broken]){report.controlled_simulation=true;console.log(JSON.stringify({report:saveReport(report),executed:report.executed,failed:report.failed,controlled_simulation:true}));}
  console.log('Three controlled scenarios passed: contracts, five-step stateful workflow, bug discovery and shrinking. No real-user pilot claimed.');
}finally{await healthy.close();await buggy.close();}
