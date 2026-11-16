import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {inspectSourceComponents} from '../src/shopyy/browser.js';
import {jsonFile,writeJson} from '../src/shopyy/artifacts.js';

test('explicit logical topology ignores decorative wrappers but detects actual component order changes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'shopyy-topology-'));let body='<h1>Title</h1><p id="detail">Detail</p>';
 const server=createServer((_req,res)=>res.writeHead(200,{'Content-Type':'text/html'}).end(body));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const projectFile=join(root,'project.json'),sourceUrl=`http://127.0.0.1:${(server.address() as any).port}`;
 try{
  await writeJson(projectFile,{sourceUrl});
  await writeJson(join(root,'selectors.json'),{sourcePath:'/',topology:'component-tree',components:{heading:'h1',detail:'#detail'}});
  const read=async()=>{const report=await inspectSourceComponents(projectFile,'selectors.json');assert.equal(report.passed,true);return Promise.all(report.rows.map(async row=>(await jsonFile(join(root,'verification/recon-current',row.evidence.path))).components));};
  const initial=await read();
  body='<div><h1>Title</h1></div><div><p id="detail">Detail</p></div>';
  const wrapped=await read();
  for(let n=0;n<3;n++){
   assert.equal(initial[n].heading.parent,'document');assert.equal(wrapped[n].heading.parent,'document');
   assert.equal(initial[n].heading.order,wrapped[n].heading.order);
   assert.equal(initial[n].detail.order,wrapped[n].detail.order);
   assert.notEqual(initial[n].heading.physicalParent,wrapped[n].heading.physicalParent);
  }
  body='<div><p id="detail">Detail</p></div><div><h1>Title</h1></div>';
  const reordered=await read();for(const components of reordered){assert.equal(components.heading.order,1);assert.equal(components.detail.order,0);}
 }finally{await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
