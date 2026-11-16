import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {inspectSourceComponents} from '../src/shopyy/browser.js';
import {jsonFile,writeJson} from '../src/shopyy/artifacts.js';

test('planning capture freezes delayed infinite motion into a declared frame and rejects mutation actions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'shopyy-pixels-'));
 const body='<style>@keyframes drift{from{transform:translateX(0)}to{transform:translateX(180px)}}h1{animation:drift 2s infinite;will-change:transform}p{animation:drift 2s 1s infinite}</style><h1>Visible heading</h1><p>Delayed item</p>';
 const server=createServer((_req,res)=>res.writeHead(200,{'Content-Type':'text/html'}).end(body));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const project=join(root,'project.json'),config={sourcePath:'/',inspectionId:'pixel-check',captureStructure:true,infiniteAnimations:'frame-zero',rasterizeInfiniteFrameZero:true,components:{heading:'h1',detail:'p'}};
 try{
  await writeJson(project,{sourceUrl:`http://127.0.0.1:${(server.address() as any).port}`});
  await writeJson(join(root,'selectors.json'),config);
  const report=await inspectSourceComponents(project,'selectors.json');assert.equal(report.passed,true,JSON.stringify(report));assert.equal(report.rows.length,3);
  for(const row of report.rows){
   const cap=await jsonFile(join(root,'verification/recon-current/inspections/pixel-check',row.evidence.path));
   assert.equal(cap.components.heading.visible,true);assert.equal(cap.components.heading.x,8);
   assert.equal(cap.components.detail.x,8);assert.equal(cap.captureEnvironment.frameZeroRasterized,true);
   assert.equal(cap.captureEnvironment.animations.length,2);
   assert.equal(cap.captureEnvironment.initialFrameNormalizedBeforeActions,true);
   const dom=await jsonFile(join(root,row.structure.path));
   assert.ok(!dom.structure.includes('style="'),'Capture-only projected inline styles must not leak into composer inputs');
  }
  await writeJson(join(root,'selectors.json'),{...config,actions:[{op:'click',selector:'h1',effect:'local-fixture'}]});
  const rejected=await inspectSourceComponents(project,'selectors.json');assert.equal(rejected.passed,false);
  assert.ok(rejected.rows.every(row=>row.error.includes('authorized platform adapter')));
 }finally{await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});

test('planning capture rejects a transient postcondition lost while destination images decode',async()=>{
 const root=await mkdtemp(join(tmpdir(),'shopyy-transient-'));
 // Keep the postcondition through the 1500ms identity check, then lose it during real image decoding.
 const server=createServer((req,res)=>{
  if(req.url==='/late.svg'){setTimeout(()=>res.writeHead(200,{'Content-Type':'image/svg+xml'}).end('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>'),4000);return;}
  res.writeHead(200,{'Content-Type':'text/html'}).end('<h1>Transient state fixture</h1><button type="button" id="open">Open</button><div id="result"></div><script>document.querySelector("button").onclick=()=>{const n=document.querySelector("#result");n.dataset.ready="true";n.innerHTML="Ready<img src=/late.svg>";setTimeout(()=>{n.removeAttribute("data-ready");n.firstChild.textContent="Reset"},3000)}</script>');
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  const project=join(root,'project.json');
  await writeJson(project,{sourceUrl:`http://127.0.0.1:${(server.address() as any).port}`});
  await writeJson(join(root,'selectors.json'),{sourcePath:'/',inspectionId:'transient',preloadImages:true,components:{heading:'h1'},actions:[{op:'click',selector:'#open',effect:'read-only'}],postReady:'#result[data-ready]'});
  const report=await inspectSourceComponents(project,'selectors.json');
  assert.equal(report.passed,false);assert.equal(report.rows.length,3);
  assert.ok(report.rows.every(row=>!row.passed&&row.error.includes('postcondition disappeared while preparing destination images')),JSON.stringify(report));
 }finally{await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
