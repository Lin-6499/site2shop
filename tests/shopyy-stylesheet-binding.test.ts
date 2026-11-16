import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {digest,saveArtifact,writeJson} from '../src/shopyy/artifacts.js';
import {presentationCss} from '../src/shopyy/presentation.js';
import {verifyLoadedStylesheetProof,verifyPairedStylesheetProof} from '../src/shopyy/stylesheet-binding.js';

test('identity stylesheet bindings consume actual bytes and rendered links while retaining full observed fields and dynamic CSS',async()=>{
 const root=await mkdtemp(join(tmpdir(),'stylesheet-binding-'));try{
  const evidence=join(root,'evidence');await mkdir(evidence);await mkdir(join(root,'assets/styles'),{recursive:true});
  const raw='#panel{display:none}#panel[open]{display:block;width:600px}',sheet=await saveArtifact(evidence,raw,'css'),url='https://source.test/main.css';
  await writeFile(join(root,'assets/styles/main.css'),raw);await writeJson(join(root,'map.json'),{[url]:{relativePath:'styles/main.css',sha256:sheet.sha256,contentType:'text/css'}});
  const map={path:'map.json',sha256:digest(await import('node:fs/promises').then(fs=>fs.readFile(join(root,'map.json'))))};
  const project={siteId:'test',assetsDirectory:'assets',familiesFile:'families.json',workflow:{mediaAssetMapFile:'map.json'},shopyy:{templateProfile:'liquid-default-v1',assetDirectoryLayout:'tree'}};
  await writeJson(join(root,'families.json'),{pages:[{sourcePath:'/page',family:'page'}],families:{page:{nativeFile:'templates/page.liquid'}}});
  const plan:any={sourceUrl:'https://source.test/',viewports:{desktop:{width:1440,height:1000}},routes:{page:{sourcePath:'/page',components:{panel:{target:'#panel'}},states:{initial:{components:['panel']},opened:{components:['panel']}}}}};
  const captures:any[]=[],bindings:any[]=[],checks:any[]=[],caps:any[]=[];
  for(const state of ['initial','opened']){
   const components={panel:{width:state==='initial'?0:600,height:100,fontSize:'16px',lineHeight:'24px',paddingTop:'0px',paddingRight:'0px',paddingBottom:'0px',paddingLeft:'0px',gap:'normal',gridTemplateColumns:'none',display:state==='initial'?'none':'block',flexDirection:'row',overflowX:'visible',overflowY:'visible'}};
   const cap:any={side:'source',route:'page',viewport:'desktop',state,planSha256:'plan',capturedAt:'2026-11-06T00:00:00Z',finalUrl:'https://source.test/page',components,captureEnvironment:{fullPageGeometry:{before:{innerWidth:1440,clientWidth:1440,scrollHeight:1000,innerHeight:1000},contentVisibilityPainting:{kind:'auto-visible-paint-projection',count:0,geometryUnchanged:true,restored:true}}}};
   cap.stylesheetProof=await saveArtifact(evidence,{schemaVersion:1,kind:'loaded-stylesheet-proof',...Object.fromEntries(['side','route','viewport','state','planSha256','capturedAt','finalUrl'].map(k=>[k,cap[k]])),stylesheets:[{url,index:0,media:'',disabled:false,contentType:'text/css',sha256:sheet.sha256,body:sheet}],inlineStyles:[]});
   const ref=await saveArtifact(evidence,cap);caps.push(cap);captures.push({route:'page',viewport:'desktop',state,sourceCapture:ref});checks.push({id:'state:'+state,before:{source:ref}});
   bindings.push({mode:'verified-source-stylesheet',route:'page',viewport:'desktop',state,component:'panel',sourceCapture:ref,stylesheetProof:cap.stylesheetProof,stylesheetAssetMap:map,selector:'#panel',range:{min:1000,max:2000},styles:Object.fromEntries(Object.entries(components.panel).map(([field,observed])=>[field,{field,observed,transform:typeof observed==='number'?'px':'identity'}]))});
  }
  await writeJson(join(evidence,'source.json'),{sessions:[{route:'page',viewport:'desktop',checks}]});
  const contract={schemaVersion:2,planSha256:'plan',captures,bindings},families={preview:new Map([['pages/0.html','<link rel="stylesheet" href="/assets/test/styles/main.css"><div id=panel></div>']]),native:new Map([['templates/page.liquid','<div id=panel></div>'],['layout/theme.liquid',`<link rel="stylesheet" href="{{ 'test/styles/main.css' | public_asset_abs_dir_url }}">`]]),routes:{}};
  const context={projectRoot:root,project,families},run=(c:any=contract)=>presentationCss(c,plan,evidence,undefined,context);
  const css=await run();assert.match(css,/verified-source-stylesheet/);assert.doesNotMatch(css,/width:|display:|@media/);
  const computed=structuredClone(contract);for(const b of computed.bindings)delete (b as any).mode;await assert.rejects(run(computed),/Conflicting state presentation/);
  for(const b of computed.bindings)b.styles={fontSize:b.styles.fontSize};assert.match(await run(computed),/font-size:16px/);
  await assert.rejects(presentationCss(contract,plan,evidence),/consumer context/);
  const partial=structuredClone(contract);delete partial.bindings[0].styles.height;await assert.rejects(run(partial),/all actual presentation fields/);
  const invented=structuredClone(contract);invented.bindings[0].styles.width.observed=700;await assert.rejects(run(invented),/Invented/);
  await assert.rejects(verifyLoadedStylesheetProof(evidence,{...caps[0],stylesheetProof:undefined}),/proof required/);
  families.preview.set('pages/0.html','<div id=panel></div>');await assert.rejects(run(),/does not consume/);families.preview.set('pages/0.html','<link rel="stylesheet" href="/assets/test/styles/main.css">');
  await writeFile(join(root,'assets/styles/main.css'),raw+'/*changed*/');await assert.rejects(run(),/bytes changed/);await writeFile(join(root,'assets/styles/main.css'),raw);
  const target:any={...caps[0],side:'target',finalUrl:'https://target.test/page'};
  target.stylesheetProof=await saveArtifact(evidence,{schemaVersion:1,kind:'loaded-stylesheet-proof',...Object.fromEntries(['side','route','viewport','state','planSha256','capturedAt','finalUrl'].map(k=>[k,target[k]])),stylesheets:[{url:'https://cdn.target.test/styles/main.css',index:0,media:'',disabled:false,contentType:'text/css',sha256:sheet.sha256,body:sheet}],inlineStyles:[]});
  await verifyPairedStylesheetProof(root,project,plan,caps[0],target,evidence);
  const body=await saveArtifact(evidence,'#panel{width:1px}','css');target.stylesheetProof=await saveArtifact(evidence,{schemaVersion:1,kind:'loaded-stylesheet-proof',...Object.fromEntries(['side','route','viewport','state','planSha256','capturedAt','finalUrl'].map(k=>[k,target[k]])),stylesheets:[{url:'https://cdn.target.test/styles/main.css',index:0,media:'',disabled:false,contentType:'text/css',sha256:body.sha256,body}],inlineStyles:[]});
  await assert.rejects(verifyPairedStylesheetProof(root,project,plan,caps[0],target,evidence),/did not actually load/);
 }finally{await rm(root,{recursive:true,force:true});}
});
