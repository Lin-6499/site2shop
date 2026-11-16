import {chromium, type Page} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const {DraftEditor}=createRequire(import.meta.url)('./lib/shopyy-draft-editor.cjs');
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const root=resolve('../voidresearch-shopyy');
const state=process.argv[2];
if(!state)throw Error('Provide user-authorized authentication state path; its content is never logged or copied');
const versions=process.argv.slice(3);
const target={origin:'https://pepsss.zenshop.cn',skinId:'504457',role:'draft'};
const directory=join(root,'verification/incremental-draft-504457');
const previousRaw=await readFile(join(directory,'home-current-server-readback.json'),'utf8');
const previousCompositionReport={file:'home-server-readback-history/'+hash(previousRaw)+'.json',sha256:hash(previousRaw)};
await mkdir(join(directory,'home-server-readback-history'),{recursive:true});
await writeFile(join(directory,previousCompositionReport.file),previousRaw,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
const pending=[];
for(const version of versions){
  if(!/^[a-zA-Z0-9-]+$/.test(version))throw Error('Invalid fixed package version');
  const packageDirectory=join(root,'staging/handoff-packages',version);
  const raw=await readFile(join(packageDirectory,'manifest.json'),'utf8'),manifest=JSON.parse(raw);
  const review=JSON.parse(await readFile(join(root,'verification/parallel-qa',version+'.review.json'),'utf8'));
  if((!review.provisionalDraftTrialAllowed&&!review.provisionalDraftReplacementAllowed)||review.manifestSha256!==hash(raw)||review.componentSha256!==manifest.component?.sha256)throw Error('Independent fixed-version review missing or stale');
  pending.push({version,manifest,packageDirectory});
}
const previous=JSON.parse(previousRaw);
if(previous.target?.origin!==target.origin||previous.target?.skinId!==target.skinId||previous.target?.role!=='draft'||previous.published!==false||!previous.blocks.every((b:any)=>b.exact))throw Error('Existing composition report is not an exact draft');
const expectedVersions=[...new Set<string>([...previous.blocks.map((b:any)=>b.version),...versions])];
const expected=new Map<string,any>();
for(const version of expectedVersions){
  const manifest=JSON.parse(await readFile(join(root,'staging/handoff-packages',version,'manifest.json'),'utf8'));
  for(const component of manifest.component?[manifest.component]:manifest.blocks||[]){
    const saved=previous.blocks.find((b:any)=>b.id===component.scope.slice(1)&&b.version===version);
    if(saved&&saved.sha256!==component.sha256)throw Error('Previous saved composition differs from its immutable package');
    expected.set(component.scope.slice(1),{version,...component});
  }
}
const browser=await chromium.launch({channel:'chrome',headless:false});
const context=await browser.newContext({storageState:resolve(state),viewport:{width:1800,height:2200},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
context.setDefaultTimeout(7000);
const page=await context.newPage();
const editor=new DraftEditor(page,target,{lockFile:join(directory,'pipeline/page-locks.current.json')});
const frame=()=>page.frameLocator('#iframe');
async function ready(count:number, strict=true){
  await page.locator('span[title="自定义"]').nth(count-1).waitFor({timeout:15000});
  await frame().locator('#vr-block-navigation[data-initialized="true"]').waitFor({timeout:15000});
  await frame().locator('body').evaluate(()=>document.readyState);
  const f=page.frames().find(f=>f.url().includes('theme_id=504457')&&f.url().includes('is_theme_edit=1'));
  if(!f)throw Error('Exact target preview frame missing');
  if(strict)await f.waitForFunction(n=>document.querySelectorAll('[id^="vr-block-"]').length===n,count,{timeout:15000});
  else await frame().locator('#vr-block-draft-shell').waitFor({state:'attached',timeout:15000});
}
async function order(){return frame().locator('[id^="vr-block-"]').evaluateAll(es=>es.map(e=>e.id));}
async function moveBefore(id:string,before:string,count:number){
  await editor.assertWritable();
  await page.waitForTimeout(1200);
  const ids=await order(),a=ids.indexOf(id),b=ids.indexOf(before);
  if(a<0||b<0||a<b)throw Error('Unexpected reorder precondition');
  const from=page.locator('span[title="自定义"]').nth(a).locator('..').locator('.drag');
  const to=page.locator('span[title="自定义"]').nth(b).locator('..');
  await from.scrollIntoViewIfNeeded();await to.scrollIntoViewIfNeeded();
  const s=await from.boundingBox(),t=await to.boundingBox();if(!s||!t)throw Error('Missing visible drag geometry');
  const save=page.waitForResponse(r=>new URL(r.url()).origin===target.origin&&new URL(r.url()).pathname==='/api/themes/504457/sections/batchsave'&&r.request().method()==='POST',{timeout:10000});
  await page.mouse.move(s.x+20,s.y+22);await page.mouse.down();await page.waitForTimeout(350);
  await page.mouse.move(s.x+25,s.y+15,{steps:5});await page.mouse.move(t.x+20,t.y+22,{steps:40});
  await page.waitForTimeout(650);await page.mouse.up();if((await save).status()!==200)throw Error('Order save failed');
  await page.reload({waitUntil:'domcontentloaded',timeout:25000});await ready(count);
}
try{
  await mkdir(directory,{recursive:true});
  await page.goto(target.origin+'/admin/card?theme_id='+target.skinId,{waitUntil:'domcontentloaded',timeout:25000});
  await page.locator('span[title="自定义"]').first().waitFor({state:'visible',timeout:15000});
  await ready(await page.locator('span[title="自定义"]').count(),false);
  await editor.assertIdentity();
  // Loading the group itself selects its native header; let that initial UI selection settle.
  editor.lastClick=Date.now();
  const initialCount=await page.locator('span[title="自定义"]').count();
  const lastCode=await editor.select(initialCount-1);
  const hasBlankTail=lastCode.length===136&&lastCode.includes('Heading')&&lastCode.includes('Body content');
  if(!hasBlankTail&&!/id="vr-block-[^"]+"/.test(lastCode))throw Error('Unknown existing tail content');
  const initialFrame=page.frames().find(f=>f.url().includes('theme_id=504457')&&f.url().includes('is_theme_edit=1'));
  if(!initialFrame)throw Error('Preview unavailable before package installation');
  await initialFrame.waitForFunction(n=>document.querySelectorAll('[id^="vr-block-"]').length===n,initialCount-(hasBlankTail?1:0),{timeout:15000});
  for(const item of pending){
    const existing=await order();
    const existingIndex=existing.indexOf(item.manifest.component.scope.slice(1));
    if(existingIndex>=0){
      const code=await editor.select(existingIndex,item.manifest.component.scope.slice(1));
      if(hash(code)===item.manifest.component.sha256){console.log(JSON.stringify({version:item.version,action:'already-exact; verify below'}));continue;}
      const prior=JSON.parse(await readFile(join(directory,'home-current-server-readback.json'),'utf8'));
      if(prior.target?.origin!==target.origin||prior.target?.skinId!==target.skinId||prior.published!==false)throw Error('Prior readback target mismatch');
      const known=prior.blocks.find((b:any)=>b.id===item.manifest.component.scope.slice(1));
      if(!known?.exact||known.sha256!==hash(code))throw Error('Existing component drift prevents replacement');
      const saved=await editor.install(item.packageDirectory,directory,{reuseIndex:existingIndex,expectedPreviousSha:known.sha256});
      console.log(JSON.stringify({event:'replaced-and-independent-readback',...saved}));
      await ready(existing.length);continue;
    }
    const review=JSON.parse(await readFile(join(root,'verification/parallel-qa',item.version+'.review.json'),'utf8'));
    if(!review.provisionalDraftTrialAllowed)throw Error('This package is approved only for replacement');
    const count=await page.locator('span[title="自定义"]').count();
    let reuseIndex:number|undefined;
    if(count===existing.length+1){
      const blank=await editor.select(count-1);
      if(blank.length!==136||!blank.includes('Heading')||!blank.includes('Body content'))throw Error('Unowned nonempty block prevents safe resume');
      reuseIndex=count-1;
    }else if(count!==existing.length)throw Error('Unexpected custom block/root topology');
    const started=performance.now();const saved=await editor.install(item.packageDirectory,directory,{reuseIndex});
    console.log(JSON.stringify({event:'installed-and-independent-readback',...saved,elapsedMs:performance.now()-started}));
    await ready(await page.locator('span[title="自定义"]').count());
  }
  const desired=['vr-block-navigation','vr-block-hero','vr-block-trust-strip','vr-block-picks','vr-block-bt','vr-block-dispatch','vr-block-lot-lookup','vr-block-quality','vr-block-news','vr-block-ft','vr-block-draft-shell','vr-block-native-cart-bridge'].filter(id=>expected.has(id));
  for(let i=0;i<desired.length;i++){
    const ids=await order();if(ids[i]!==desired[i]){await moveBefore(desired[i],ids[i],desired.length);console.log(JSON.stringify({event:'order-saved',id:desired[i],order:await order()}));}
  }
  const finalOrder=await order();if(JSON.stringify(finalOrder)!==JSON.stringify(desired))throw Error('Native DOM order does not match assembly plan');
  const readerPage=await context.newPage();
  await readerPage.goto(page.url(),{waitUntil:'domcontentloaded',timeout:25000});
  await readerPage.locator('span[title="自定义"]').nth(desired.length-1).waitFor({timeout:15000});
  const reader=new DraftEditor(readerPage,target),blocks=[];
  for(let i=0;i<desired.length;i++){
    const component=expected.get(desired[i]),code=await reader.select(i,desired[i]);
    if(hash(code)!==component.sha256)throw Error('Final saved component hash differs: '+desired[i]);
    const file='saved-current-'+desired[i]+'.html';await writeFile(join(directory,file),code);
    blocks.push({id:desired[i],version:component.version,sha256:hash(code),characters:code.length,readback:file,exact:true});
  }
  await readerPage.close();
  const compositionId=hash(JSON.stringify({target,order:finalOrder,blocks:blocks.map(({id,version,sha256})=>({id,version,sha256}))}));
  const report={kind:'provisional-native-home-assembly-independent-server-readback',compositionId,previousCompositionReport,capturedAt:new Date().toISOString(),target,order:finalOrder,blocks,published:false,publicationAllowed:false,fullSiteAcceptance:false,onlineVisualAcceptance:'pending',interactionAcceptance:'pending'};
  await writeFile(join(directory,'home-current-server-readback.json'),JSON.stringify(report,null,2));
  await page.setViewportSize({width:1800,height:1000});
  await page.screenshot({path:join(directory,'home-current-editor.png'),fullPage:false});
  console.log(JSON.stringify({event:'assembly-server-readback-verified',blocks:blocks.length,order:finalOrder,published:false}));
}catch(error){
  console.log(JSON.stringify({event:'draft-operation-stopped',error:error instanceof Error?error.message.slice(0,300):'Error',published:false}));
  await page.screenshot({path:join(directory,'draft-operation-stopped.png'),fullPage:false}).catch(()=>{});process.exitCode=1;
}finally{await context.close();await browser.close();}
