import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {join,sep,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {stageTargetErrors,targetPathFor,mappedTargetPath,readTargetIdentity,validateTargetIdentityProof} from '../src/shopyy/target-context.js';
import {presentationCss} from '../src/shopyy/presentation.js';
import {renderFamilies} from '../src/shopyy/families.js';
import {saveArtifact,writeJson} from '../src/shopyy/artifacts.js';

async function isolated(work:(root:string)=>Promise<void>){const parent=await realpath(tmpdir()),root=await mkdtemp(join(parent,'shopyy-formal-independent-'));try{await work(root);}finally{const actual=await realpath(root);assert.ok(actual.startsWith(parent+sep)&&basename(actual).startsWith('shopyy-formal-independent-'));await rm(actual,{recursive:true,force:true});}}

test('stage targets reject backslash-origin confusion and preserve independently configured stage queries exactly',()=>{
 for(const path of ['/\\foreign.invalid/page','/\\\\foreign.invalid/page','/\t/foreign.invalid/page','/\n/foreign.invalid/page']){
  assert.notEqual(new URL(path,'https://owned.invalid').origin,'https://owned.invalid','counterexample must actually resolve outside the intended origin');
  assert.ok(stageTargetErrors({online:path}).length>0,'must reject URL-origin-confusing stage path '+JSON.stringify(path));
 }
 const state={paths:{target:'/base?stale=1'},targetPaths:{preflight:'/local?mode=fixture&theme_id=0',online:'/pages/Contact-Us?theme_id=504457&preview=1&is_theme_edit=1'}};
 assert.equal(targetPathFor(state,'online'),state.targetPaths.online);assert.equal(targetPathFor(state,'preflight'),state.targetPaths.preflight);assert.equal(mappedTargetPath({targetPath:'/base?old=1',targetPaths:state.targetPaths},'online'),state.targetPaths.online);
});

test('two different page bodies may not silently overwrite the same preflight destination',async()=>isolated(async root=>{
 await writeFile(join(root,'a.htm'),'<link href="styles/page-contracts.css"><main>First page</main>');await writeFile(join(root,'b.htm'),'<link href="styles/page-contracts.css"><main>Second distinct page</main>');
 const inventory=await saveArtifact(root,{routes:{'/a':{disposition:'mapped',targetPath:'/pages/a',targetPaths:{preflight:'/same?mode=fixture',online:'/pages/A'},family:'a'},'/b':{disposition:'mapped',targetPath:'/pages/b',targetPaths:{preflight:'/same?mode=fixture',online:'/pages/B'},family:'b'}}});
 await writeJson(join(root,'families.json'),{schemaVersion:2,partials:{},families:{a:{templateFile:'a.htm',nativeFile:'pages/a.htm'},b:{templateFile:'b.htm',nativeFile:'pages/b.htm'}},pages:[{sourcePath:'/a',targetPath:'/pages/a',family:'a'},{sourcePath:'/b',targetPath:'/pages/b',family:'b'}]});
 await assert.rejects(renderFamilies(root,{familiesFile:'families.json',siteId:'independent',shopyy:{}},{inventory} as any),/conflict|duplicate|collision|ambiguous/i);
}));

test('DOM identity independently rejects encoded duplicate context keys, conflicting markers and forged proof metadata',async()=>{
 const browser=await chromium.launch({headless:true}),build='1'.repeat(64),other='2'.repeat(64),base='https://owned.invalid/pages/Contact-Us?theme_id=504457&preview=1&is_theme_edit=1',project={workflow:{onlineOrigin:'https://owned.invalid',onlineBuildIdentity:{mode:'dom-marker',selector:'[data-owned-marker]',attribute:'data-build-id',context:{origin:'https://owned.invalid',skinId:'504457'}}}};
 try{for(const extra of ['&preview=1','&preview=0','&is_theme_edit=1','&theme%5Fid=504457']){const context=await browser.newContext();try{await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:`<span data-owned-marker data-build-id="${build}"></span>`}));const page=await context.newPage();await page.goto(base+extra);await assert.rejects(readTargetIdentity(page,project,'online',null,build),/draft context/);}finally{await context.close();}}
 const context=await browser.newContext();try{await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:`<span data-owned-marker data-build-id="${build}"></span>`}));const page=await context.newPage();await page.goto(base);const valid=await readTargetIdentity(page,project,'online',null,build);assert.ok(valid.proof);validateTargetIdentityProof(project,'online',base,build,build,valid.proof);
 for(const change of [{markerCount:0},{markerValue:other},{headerBuildId:other},{attribute:'data-other'},{selector:'#wrong'},{buildId:other}])assert.throws(()=>validateTargetIdentityProof(project,'online',base,build,build,{...valid.proof!,...change}));
 await page.locator('body').evaluate((body,other)=>body.insertAdjacentHTML('beforeend',`<span data-owned-marker data-build-id="${other}"></span>`),other);await assert.rejects(readTargetIdentity(page,project,'online',null,build),/duplicate/);await assert.rejects(readTargetIdentity(page,project,'preflight',null,build),/HTTP build/);
 }finally{await context.close();}
 }finally{await browser.close();}
});

test('CSS state bindings reject an inclusive media-range boundary collision without rejecting a genuinely disjoint pair',async()=>isolated(async root=>{
 const create=async(mobileMax:number)=>{const plan:any={viewports:{mobile:{width:375,height:812},desktop:{width:1440,height:1000}},routes:{page:{components:{panel:{target:'#panel'}},states:{initial:{viewports:['mobile'],components:['panel']},expanded:{viewports:['desktop'],components:['panel']}}}}},captures:any[]=[],bindings:any[]=[],sessions:any[]=[];
 for(const [viewport,state,height,range]of [['mobile','initial',100,{min:0,max:mobileMax}],['desktop','expanded',300,{min:768,max:2000}]] as const){const ref=await saveArtifact(root,{side:'source',route:'page',viewport,state,planSha256:'independent-plan',components:{panel:{height}}});captures.push({route:'page',viewport,state,sourceCapture:ref});bindings.push({route:'page',viewport,state,component:'panel',sourceCapture:ref,selector:'#panel',range,styles:{height:{field:'height',observed:height,transform:'px'}}});sessions.push({route:'page',viewport,checks:[{id:'state:'+state,before:{source:ref}}]});}
 await writeJson(join(root,'source.json'),{sessions});return{plan,contract:{schemaVersion:2,planSha256:'independent-plan',captures,bindings}};};
 const overlap=await create(768);await assert.rejects(presentationCss(overlap.contract,overlap.plan,root),/Conflicting state presentation/);const separate=await create(767);assert.match(await presentationCss(separate.contract,separate.plan,root),/height:300px/);
}));
