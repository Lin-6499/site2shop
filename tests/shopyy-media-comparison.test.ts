import {chromium} from 'playwright';import {videoFixture} from './shopyy-video-fixture.js';import {videoAlternateFixture} from './shopyy-video-alternate-fixture.js';import {mediaAssetKinds,verifyMediaObservationPolicy,verifiedOnlineMediaReadback,mediaNavigationBindings,merchantMediaDelivery} from '../src/shopyy/media-comparison.js';
import assert from 'node:assert/strict';import test from 'node:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {loadVerifiedMediaAssets} from '../src/shopyy/media-comparison.js';import {compareCaptures} from '../src/shopyy/gates.js';import {digest,writeJson,saveArtifact,jsonFile} from '../src/shopyy/artifacts.js';

async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'shopyy-media-comparison-'));const assetRoot=join(root,'inputs/assets'),output=join(root,'build');
 const bytes=[Buffer.from('synthetic image bytes A'),Buffer.from('synthetic image bytes B')],sourceUrls=['https://source.invalid/cdn/a.png?public=1','https://cdn.invalid/different/b.webp'];
 await mkdir(join(assetRoot,'images'),{recursive:true});await mkdir(join(output,'theme/assets/fixture/images'),{recursive:true});
 const map:any={};
 for(let i=0;i<2;i++){const name=['a.png','b.webp'][i];await writeFile(join(assetRoot,'images',name),bytes[i]);await writeFile(join(output,'theme/assets/fixture/images',name),bytes[i]);map[sourceUrls[i]]={relativePath:'images/'+name,sha256:digest(bytes[i]),contentType:i?'image/webp':'image/png'};}
 await writeJson(join(root,'inputs/asset-map.json'),map);
 const project:any={siteId:'fixture',assetsDirectory:'inputs/assets',outputDirectory:'build',shopyy:{assetDirectoryLayout:'tree'},workflow:{localOrigin:'http://127.0.0.1:4190',mediaAssetMapFile:'inputs/asset-map.json'}};
 const plan:any={routes:{home:{states:{initial:{components:['gallery']}},components:{gallery:{rules:[{field:'images',compare:'media'}]}}}}};
 const source:any={side:'source',finalUrl:'https://source.invalid/',controls:[],components:{gallery:{images:sourceUrls.map((src,i)=>({src,alt:'Observed '+i,loaded:true}))}}};
 const target:any={side:'target',finalUrl:project.workflow.localOrigin+'/',controls:[],components:{gallery:{images:['a.png','b.webp'].map((name,i)=>({src:project.workflow.localOrigin+'/assets/fixture/images/'+name,alt:'Observed '+i,loaded:true}))}}};
 return{root,assetRoot,output,project,plan,source,target,bytes,close:()=>rm(root,{recursive:true,force:true})};
}

test('explicit media rule compares verified bytes across exact mapped source/preflight URLs and preserves raw observations',async()=>{
 const f=await fixture();try{
  const assets=await loadVerifiedMediaAssets(f.root,f.project,'preflight'),raw=JSON.stringify([f.source,f.target]);
  assert.deepEqual(compareCaptures(f.plan,'home','initial',f.source,f.target,undefined,'preflight',assets),[]);
  assert.equal(JSON.stringify([f.source,f.target]),raw);
  f.plan.routes.home.components.gallery.rules[0].compare='equal';assert.ok(compareCaptures(f.plan,'home','initial',f.source,f.target,undefined,'preflight',assets).length,'default equal must continue comparing actual src');
 }finally{await f.close();}
});

test('media comparison rejects absent map, online readback gaps, missing/reordered media and changed alt/loaded/unknown URI',async()=>{
 const f=await fixture();try{
  const assets=await loadVerifiedMediaAssets(f.root,f.project,'preflight');
  assert.match(compareCaptures(f.plan,'home','initial',f.source,f.target).join(';'),/content-verified asset map/);
  await assert.rejects(loadVerifiedMediaAssets(f.root,{...f.project,workflow:{localOrigin:f.project.workflow.localOrigin}},'preflight'),/mediaAssetMapFile/);
  await assert.rejects(loadVerifiedMediaAssets(f.root,f.project,'online'),/target readback/);
  assert.match(compareCaptures(f.plan,'home','initial',f.source,f.target,undefined,'online',assets).join(';'),/target readback/);
  for(const mutation of [(images:any[])=>images.pop(),(images:any[])=>images.reverse(),(images:any[])=>{images[0].alt='Wrong';},(images:any[])=>{images[0].loaded=false;},(images:any[])=>{images[0].src='https://unverified.invalid/a.png';}]){
   const target=structuredClone(f.target);mutation(target.components.gallery.images);assert.ok(compareCaptures(f.plan,'home','initial',f.source,target,undefined,'preflight',assets).length);
  }
 }finally{await f.close();}
});

test('same-name wrong input or served output bytes cannot obtain a verified media identity',async()=>{
 const f=await fixture();try{
  await writeFile(join(f.output,'theme/assets/fixture/images/a.png'),f.bytes[1]);await assert.rejects(loadVerifiedMediaAssets(f.root,f.project,'preflight'),/target content hash differs/);
  await writeFile(join(f.output,'theme/assets/fixture/images/a.png'),f.bytes[0]);await writeFile(join(f.assetRoot,'images/a.png'),f.bytes[1]);await assert.rejects(loadVerifiedMediaAssets(f.root,f.project,'preflight'),/input content hash differs/);
 }finally{await f.close();}
});


test('opt-in video uses decoded real MP4 bytes and rejects wrong clip, content replacement and missing policy',async()=>{
 const f=await fixture(),browser=await chromium.launch({channel:'chrome'});try{
  const clips=[videoFixture,videoAlternateFixture];assert.notEqual(digest(clips[0]),digest(clips[1]));
  const context=await browser.newContext();await context.route('https://media.invalid/*.mp4',r=>r.fulfill({contentType:'video/mp4',body:clips[r.request().url().endsWith('b.mp4')?1:0]}));
  const page=await context.newPage();await page.setContent('<video preload="auto" src="https://media.invalid/a.mp4"></video><video preload="auto" src="https://media.invalid/b.mp4"></video>');
  await page.waitForFunction(()=>[...document.querySelectorAll('video')].every(v=>v.readyState>=2));
  const first=await page.locator('video').nth(0).screenshot(),second=await page.locator('video').nth(1).screenshot();assert.notDeepEqual(first,second,'two valid MP4s decode to different actual frames');
  const urls=['https://source.invalid/a.mp4','https://source.invalid/b.mp4'],map:any={};await mkdir(join(f.assetRoot,'videos'));await mkdir(join(f.output,'theme/assets/fixture/videos'));
  for(let i=0;i<2;i++){const relativePath='videos/'+(i?'b':'a')+'.mp4';await writeFile(join(f.assetRoot,relativePath),clips[i]);await writeFile(join(f.output,'theme/assets/fixture',relativePath),clips[i]);map[urls[i]]={relativePath,sha256:digest(clips[i]),contentType:'video/mp4'};}
  await writeJson(join(f.root,'inputs/asset-map.json'),map);
  const descriptor=(src:string)=>({src,kind:'video',alt:'',loaded:true});f.source.components.gallery.images=urls.map(descriptor);f.target.components.gallery.images=['a','b'].map(n=>descriptor(f.project.workflow.localOrigin+'/assets/fixture/videos/'+n+'.mp4'));
  const defaults=await loadVerifiedMediaAssets(f.root,f.project,'preflight');assert.equal(defaults.source.size,0);assert.ok(compareCaptures(f.plan,'home','initial',f.source,f.target,undefined,'preflight',defaults).length);
  f.project.workflow.mediaAssetKinds=['image','video'];const assets=await loadVerifiedMediaAssets(f.root,f.project,'preflight');assert.deepEqual(compareCaptures(f.plan,'home','initial',f.source,f.target,undefined,'preflight',assets),[]);
  const coldSource=structuredClone(f.source),coldTarget=structuredClone(f.target);coldSource.components.gallery.images=[{kind:'video',src:'',loaded:false,alt:''}];coldTarget.components.gallery.images=[{kind:'video',src:'',loaded:false,alt:''}];assert.deepEqual(compareCaptures(f.plan,'home','initial',coldSource,coldTarget,undefined,'preflight',assets),[]);coldTarget.components.gallery.images[0].loaded=true;assert.ok(compareCaptures(f.plan,'home','initial',coldSource,coldTarget,undefined,'preflight',assets).length);
  const wrong=structuredClone(f.target);wrong.components.gallery.images[0].src=wrong.components.gallery.images[1].src;assert.ok(compareCaptures(f.plan,'home','initial',f.source,wrong,undefined,'preflight',assets).length);
  const missing=structuredClone(f.target);missing.components.gallery.images.pop();assert.ok(compareCaptures(f.plan,'home','initial',f.source,missing,undefined,'preflight',assets).length);
  await writeFile(join(f.output,'theme/assets/fixture/videos/a.mp4'),clips[1]);await assert.rejects(loadVerifiedMediaAssets(f.root,f.project,'preflight'),/target content hash differs/);
  assert.deepEqual(mediaAssetKinds({}),['image']);assert.throws(()=>mediaAssetKinds({workflow:{mediaAssetKinds:['audio']}}));assert.throws(()=>verifyMediaObservationPolicy(f.project,{}),/missing or changed/);verifyMediaObservationPolicy(f.project,{mediaAssetKinds:['image','video']});assert.throws(()=>verifyMediaObservationPolicy({}, {mediaAssetKinds:['image','video']}));
 }finally{await browser.close();await f.close();}
});


test('online media accepts only exact store/upload/GET raw bytes and composer binds actual resource URLs',async()=>{
 const f=await fixture();try{
  f.project.workflow.mediaAssetStoreId='240667';f.project.workflow.mediaAssetReadbackFile='inputs/media-readback.json';const rows:any[]=[];
  for(let i=0;i<2;i++){const relativePath='images/'+['a.png','b.webp'][i],url='https://merchant.invalid/uploads/'+i,sha256=digest(f.bytes[i]),uploadEvidence=await saveArtifact(f.root,{storeId:'240667',relativePath,sourceSha256:sha256,params:{url}}),bytes=await saveArtifact(f.root,f.bytes[i],'bin'),readback=await saveArtifact(f.root,{url,status:200,contentType:i?'image/webp':'image/png',sha256,bytes});rows.push({storeId:'240667',relativePath,sourceSha256:sha256,uploadEvidence,readback});}
  const baseline={schemaVersion:1,storeId:'240667',entries:rows},file=join(f.root,'inputs/media-readback.json');await writeJson(file,baseline);
  const assets=await loadVerifiedMediaAssets(f.root,f.project,'online'),target=structuredClone(f.target);target.components.gallery.images.forEach((image:any,i:number)=>image.src='https://merchant.invalid/uploads/'+i);assert.deepEqual(compareCaptures(f.plan,'home','initial',f.source,target,undefined,'online',assets),[]);
  const inventory:any={routes:{'/a.png':{disposition:'mapped-media',media:{sourceUrl:f.source.components.gallery.images[0].src,sha256:digest(f.bytes[0])}}}},bindings=await mediaNavigationBindings(f.root,f.project,inventory);assert.deepEqual(bindings.links.get('/a.png'),{preflight:'/assets/fixture/images/a.png',online:'https://merchant.invalid/uploads/0',relative:'images/a.png'});assert.ok(bindings.inputFiles.includes(rows[0].readback.path));assert.ok((await verifiedOnlineMediaReadback(f.root,f.project)).inputFiles.includes((await jsonFile(join(f.root,rows[0].readback.path))).bytes.path));
  for(const kind of ['store','duplicate','upload-url','readback-url','status','mime','bytes','missing','source-origin']){
   const manifest=structuredClone(baseline);if(kind==='store')manifest.storeId='240668';if(kind==='duplicate')manifest.entries.push(manifest.entries[0]);if(kind==='missing')manifest.entries.pop();
   if(['readback-url','status','mime','bytes'].includes(kind)){const data=await jsonFile(join(f.root,manifest.entries[0].readback.path));if(kind==='readback-url')data.url='https://wrong.invalid/a';if(kind==='status')data.status=403;if(kind==='mime')data.contentType='text/html';if(kind==='bytes')data.bytes=await saveArtifact(f.root,f.bytes[1],'bin');manifest.entries[0].readback=await saveArtifact(f.root,data);}
   if(kind==='upload-url'||kind==='source-origin'){const data=await jsonFile(join(f.root,manifest.entries[0].uploadEvidence.path));data.params.url=kind==='source-origin'?f.source.components.gallery.images[0].src:'https://wrong.invalid/a';manifest.entries[0].uploadEvidence=await saveArtifact(f.root,data);if(kind==='source-origin'){const read=await jsonFile(join(f.root,manifest.entries[0].readback.path));read.url=data.params.url;manifest.entries[0].readback=await saveArtifact(f.root,read);}}
   await writeJson(file,manifest);await assert.rejects(loadVerifiedMediaAssets(f.root,f.project,'online'),Error,kind);
  }
  await writeJson(file,baseline);const bytesRef=(await jsonFile(join(f.root,rows[0].readback.path))).bytes;await writeFile(join(f.root,bytesRef.path),'tampered');await assert.rejects(loadVerifiedMediaAssets(f.root,f.project,'online'),/Changed evidence/);
 }finally{await f.close();}
});


test('standard skin assets require actual expected draft deployment and GET bytes, never old active-skin evidence',async()=>{
 const f=await fixture();try{Object.assign(f.project.workflow,{mediaAssetReadbackFile:'inputs/skin-readback.json',mediaAssetStoreId:'240667',mediaAssetSkinId:'620001'});const receipt=await saveArtifact(f.root,{kind:'synthetic-independent-skin-readback'}),deployment={role:'draft',store:'240667',skinId:'620001',buildId:'a'.repeat(64),readback:receipt},deploymentEvidence=await saveArtifact(f.root,deployment),entries=[];
  for(let i=0;i<2;i++){const sourceSha256=digest(f.bytes[i]),bytes=await saveArtifact(f.root,f.bytes[i],'bin'),readback=await saveArtifact(f.root,{url:'https://native-skin.invalid/actual/'+i,status:200,contentType:i?'image/webp':'image/png',sha256:sourceSha256,bytes});entries.push({delivery:'skin-asset',storeId:'240667',relativePath:'images/'+['a.png','b.webp'][i],sourceSha256,deploymentEvidence,readback});}const manifest={schemaVersion:1,storeId:'240667',entries},file=join(f.root,'inputs/skin-readback.json');await writeJson(file,manifest);const assets=await loadVerifiedMediaAssets(f.root,f.project,'online');assert.equal(assets.target.size,2);f.project.shopyy.templateProfile='liquid-default-v1';f.project.workflow.merchantMediaFiles=['images/a.png'];await assert.rejects(merchantMediaDelivery(f.root,f.project),/Merchant upload content differs/);delete f.project.workflow.merchantMediaFiles;const proof=await verifiedOnlineMediaReadback(f.root,f.project);assert.ok(proof.inputFiles.includes(receipt.path));
  for(const changed of [{...deployment,skinId:'506820'},{...deployment,store:'240668'},{...deployment,role:'active'}]){const bad=structuredClone(manifest);bad.entries[0].deploymentEvidence=await saveArtifact(f.root,changed);await writeJson(file,bad);await assert.rejects(loadVerifiedMediaAssets(f.root,f.project,'online'),/actual expected draft/);}await writeJson(file,manifest);delete f.project.workflow.mediaAssetSkinId;await assert.rejects(loadVerifiedMediaAssets(f.root,f.project,'online'),/actual expected draft/);
 }finally{await f.close();}
});
