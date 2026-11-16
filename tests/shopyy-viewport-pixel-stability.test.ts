import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {stableViewportScreenshot,viewportPixelDifference,viewportPixelPolicy,verifyViewportPixelProof} from '../src/shopyy/viewport-pixel-stability.js';
import {saveArtifact} from '../src/shopyy/artifacts.js';
const project={workflow:{viewportPixelStability:{maxRgbDelta:1,maxChangedPixelRatio:0.0005}}};
async function frames(changes=1,delta=1,alpha=false){const bytes=Buffer.alloc(100*100*4,120);for(let i=3;i<bytes.length;i+=4)bytes[i]=255;const changed=Buffer.from(bytes);for(let n=0;n<changes;n++)changed[n*4+(alpha?3:0)]-=delta;const png=(input:Buffer)=>sharp(input,{raw:{width:100,height:100,channels:4}}).png().toBuffer();return Promise.all([png(bytes),png(changed)]);}
function pageFor(images:Buffer[]){let count=0;return{evaluate:async()=>[],evaluateHandle:async()=>({evaluate:async()=>{},dispose:async()=>{}}),screenshot:async()=>images[count++%images.length],waitForTimeout:async()=>{}} as any;}

test('explicit viewport policy accepts bounded 1LSB, saves both original frames and offline recomputes proof',async()=>{
 const root=await mkdtemp(join(tmpdir(),'viewport-proof-'));try{
  const [a,b]=await frames(5),result=await stableViewportScreenshot(pageFor([a,b]),root,project);assert.ok(result.proof);assert.deepEqual(result.image,b);assert.deepEqual(result.proof.difference,{width:100,height:100,changedPixels:5,changedPixelRatio:0.0005,maxDelta:1,alphaExact:true});
  const ref=await saveArtifact(root,result.image,'png');await verifyViewportPixelProof(project,root,ref,result.proof);
  for(const [label,mutate]of Object.entries({statistics:(proof:any)=>{proof.difference.changedPixels=0;},policy:(proof:any)=>{proof.policySha256='0'.repeat(64);},image:(proof:any)=>{proof.frames[1]=proof.frames[0];}})){const proof=structuredClone(result.proof);mutate(proof);await assert.rejects(verifyViewportPixelProof(project,root,ref,proof),(error:unknown)=>error instanceof Error,label);}
  await assert.rejects(verifyViewportPixelProof(project,root,ref),/Missing\/changed/);
  await assert.rejects(verifyViewportPixelProof({workflow:{viewportPixelStability:{maxRgbDelta:0,maxChangedPixelRatio:0}}},root,ref,result.proof),/Missing\/changed/);
  await assert.rejects(verifyViewportPixelProof({},root,ref,result.proof),/Unplanned/);
  await writeFile(join(root,result.proof.frames[0].path),b);await assert.rejects(verifyViewportPixelProof(project,root,ref,result.proof),/Changed evidence/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('RGB2, alpha changes and excess changed-pixel ratio fail capture and decoded offline proof',async()=>{
 for(const [changes,delta,alpha]of [[1,2,false],[1,1,true],[6,1,false]] as const){const root=await mkdtemp(join(tmpdir(),'viewport-reject-'));try{
  const images=await frames(changes,delta,alpha);await assert.rejects(stableViewportScreenshot(pageFor(images),root,project),/did not stabilize/);
  const refs=await Promise.all(images.map(image=>saveArtifact(root,image,'png'))),difference=await viewportPixelDifference(images[0],images[1]);
  const valid=await stableViewportScreenshot(pageFor(await frames()),root,project);const proof={...valid.proof!,frames:refs as [any,any],difference};await assert.rejects(verifyViewportPixelProof(project,root,refs[1],proof),/decoded verification/);
 }finally{await rm(root,{recursive:true,force:true});}}
});

test('default keeps exact byte stability and existing captures require no new proof',async()=>{
 const root=await mkdtemp(join(tmpdir(),'viewport-exact-'));try{const [a,b]=await frames();await assert.rejects(stableViewportScreenshot(pageFor([a,b]),root),/did not stabilize/);const exact=await stableViewportScreenshot(pageFor([a,a]),root);assert.equal(exact.proof,undefined);assert.deepEqual(exact.image,a);await verifyViewportPixelProof({},root,await saveArtifact(root,a,'png'));assert.equal(viewportPixelPolicy({}),null);for(const policy of [{maxRgbDelta:2,maxChangedPixelRatio:0.0005},{maxRgbDelta:1,maxChangedPixelRatio:0.001}])assert.throws(()=>viewportPixelPolicy({workflow:{viewportPixelStability:policy}}));}finally{await rm(root,{recursive:true,force:true});}
});

test('installed Chrome156 hides only the focused editable caret once across sampling and restores focus/value/style on success and failure',async()=>{
 const{chromium}=await import('playwright');const browser=await chromium.launch({channel:'chrome',headless:false}),root=await mkdtemp(join(tmpdir(),'caret-sampling-'));try{const page=await browser.newPage({viewport:{width:800,height:600}});await page.setContent('<input id="focused" type="number" style="color:rgb(12,34,56)" value="5"><input id="other"><div id="untouched">Public</div><button id="button">Other focus</button>');await page.locator('#focused').fill('0');const measure=()=>page.evaluate(()=>({focus:document.activeElement!.id,value:(document.querySelector('#focused')as HTMLInputElement).value,html:document.body.innerHTML}));const before=await measure(),screenshot=page.screenshot.bind(page);let calls=0;page.screenshot=async options=>{calls++;assert.equal(options?.caret,'initial');assert.equal(await page.locator('#focused').evaluate(n=>(n as HTMLElement).style.getPropertyValue('caret-color')),'transparent');assert.equal(await page.locator('#other').getAttribute('style'),null);assert.equal(await page.locator('#untouched').getAttribute('style'),null);return screenshot(options);};await stableViewportScreenshot(page,root);assert.ok(calls>=2);assert.deepEqual(await measure(),before);page.screenshot=async()=>{throw Error('fixture screenshot failure');};await assert.rejects(stableViewportScreenshot(page,root),/fixture screenshot failure/);assert.deepEqual(await measure(),before);await page.locator('#button').focus();const withoutCaret=await measure();page.screenshot=async options=>{assert.equal(options?.caret,'initial');assert.equal(await page.locator('#focused').evaluate(n=>(n as HTMLElement).style.getPropertyValue('caret-color')),'');return screenshot(options);};await stableViewportScreenshot(page,root);assert.deepEqual(await measure(),withoutCaret);}finally{await browser.close();await rm(root,{recursive:true,force:true});}
});
