import test from 'node:test';
import assert from 'node:assert/strict';
import {admittedSourceReadQuery,sourceReadQueryPolicy} from '../src/shopyy/source-read-queries.js';
import {digest} from '../src/shopyy/artifacts.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {inspectSourceComponents} from '../src/shopyy/browser.js';
import {jsonFile,writeJson} from '../src/shopyy/artifacts.js';
test('display-query exception is confined to the reviewed function, frame, body and fetch transport',()=>{
 const rule={id:'display-prices',method:'POST',origin:'https://source.invalid',path:'/_serverFn/'+'a'.repeat(64),payloadSha256:digest('{"data":{}}'),sourcePaths:['/shop?category=Kits'],rationale:'Isolated display query fixture',reviewedSourceModule:{sha256:'b'.repeat(64)}};
 const project={sourceUrl:'https://source.invalid/',workflow:{sourceReadQueries:[rule]}};
 const request={method:'POST',url:rule.origin+rule.path,frameUrl:rule.origin+'/shop?category=Kits',payload:'{"data":{}}',navigation:false,resourceType:'fetch'};
 assert.equal(admittedSourceReadQuery(project,request)?.id,rule.id);
 for(const override of [{payload:'{"data":{"cart":"must-not-admit"}}'},{frameUrl:rule.origin+'/cart'},{url:'https://other.invalid'+rule.path},{url:request.url+'?method=write'},{method:'DELETE'},{navigation:true},{resourceType:'document'}])assert.equal(admittedSourceReadQuery(project,{...request,...override}),null);
 assert.equal(sourceReadQueryPolicy(project,'/shop'),null);
 assert.ok(sourceReadQueryPolicy(project,'/shop?category=Kits'));
 assert.notEqual(sourceReadQueryPolicy(project,'/shop?category=Kits'),sourceReadQueryPolicy({...project,workflow:{sourceReadQueries:[{...rule,payloadSha256:'c'.repeat(64)}]}},'/shop?category=Kits'));
});

test('real capture admits only a reviewed display POST, records its policy, and still blocks an order POST',async()=>{
 const root=await mkdtemp(join(tmpdir(),'shopyy-display-query-'));
 const path='/_serverFn/'+'d'.repeat(64);let prices=0,orders=0;
 const server=createServer((req,res)=>{
  if(req.method==='POST'){if(req.url===path){prices++;res.writeHead(200,{'Content-Type':'application/json'}).end('{"price":"12.34"}');}else{orders++;res.writeHead(500).end();}return;}
  res.writeHead(200,{'Content-Type':'text/html'}).end(`<h1>Loading price</h1><button id="order">Order mutation fixture</button><script>fetch('${path}',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"data":{}}'}).then(r=>r.json()).then(d=>document.querySelector('h1').textContent='Display price '+d.price);document.querySelector('button').onclick=()=>fetch('/orders',{method:'POST',body:'must-not-admit'}).catch(()=>{})</script>`);
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${(server.address() as any).port}`;
 try{
  const project={sourceUrl:origin,workflow:{sourceReadQueries:[{id:'price-fixture',method:'POST',origin,path,payloadSha256:digest('{"data":{}}'),sourcePaths:['/shop?category=Kits'],rationale:'Reviewed isolated display fixture',reviewedSourceModule:{sha256:'e'.repeat(64)}}]}};
  await writeJson(join(root,'project.json'),project);
  await writeJson(join(root,'selectors.json'),{sourcePath:'/shop?category=Kits',inspectionId:'display-query',components:{heading:'h1'},postReady:'h1:text-is("Display price 12.34")',actions:[{op:'click',selector:'#order',effect:'read-only'}]});
  const report=await inspectSourceComponents(join(root,'project.json'),'selectors.json');
  assert.equal(report.passed,true,JSON.stringify(report));assert.equal(prices,3);assert.equal(orders,0);
  for(const row of report.rows){const cap=await jsonFile(join(root,'verification/recon-current/inspections/display-query',row.evidence.path));assert.equal(cap.admittedQueries.length,1);assert.equal(cap.blockedRequests[0].path,'/orders');assert.equal(cap.captureEnvironment.sourceReadQueryPolicySha256,sourceReadQueryPolicy(project,'/shop?category=Kits'));}
 }finally{await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
