import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,basename,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const {DraftEditor}=createRequire(import.meta.url)('./lib/shopyy-draft-editor.cjs');
const state=process.argv[2];if(!state)throw Error('Authorized authentication state path required');
const root=resolve('../voidresearch-shopyy'),hash=(x:string)=>createHash('sha256').update(x).digest('hex');
const plan=JSON.parse(await readFile(join(root,'verification/contact-route-native-trial-plan.json'),'utf8'));
const raw=await readFile(join(root,plan.candidateManifest.file),'utf8'),manifest=JSON.parse(raw);
const qa=JSON.parse(await readFile(join(root,'verification/parallel-qa',plan.version+'.review.json'),'utf8'));
if((qa.provisionalDraftTrialAllowed!==true&&qa.provisionalNativeTrialAllowed!==true)||qa.manifestSha256!==hash(raw)||hash(raw)!==plan.candidateManifest.sha256||manifest.publicationAllowed!==false||plan.publicationAllowed!==false)throw Error('Exact independent native trial review required');
if(plan.target.origin!=='https://pepsss.zenshop.cn'||plan.target.skinId!=='504457'||plan.target.role!=='draft'||plan.group!=='自定义页面'||plan.target.pathname!=='/pages/Contact-Us')throw Error('Trial identity mismatch');
const before=JSON.parse(await readFile(join(root,'verification/incremental-draft-504457/content-group-before/report.json'),'utf8'));
if(before.blocks.length!==1||before.blocks[0].root!=='s2s-content-probe'||before.blocks[0].sha256!=='0a2ae54384ff9dad9664efec2f066fbcdd802f79f3d610326ac67e5fc9d730ef')throw Error('Original isolated probe identity mismatch');
const target={...plan.target,pageGroup:plan.group},dir=join(root,'verification/incremental-draft-504457',plan.version),pkg=dirname(join(root,plan.candidateManifest.file));await mkdir(dir,{recursive:true});
if(plan.parts.length!==4||new Set(plan.parts.map((p:any)=>p.file)).size!==4||new Set(plan.parts.map((p:any)=>p.scope)).size!==4||manifest.parts.length!==4)throw Error('Ambiguous part set');
for(const [index,part] of plan.parts.entries()){
 const source=await readFile(join(root,part.file),'utf8'),canonical=manifest.parts.find((p:any)=>p.file===basename(part.file));
 if(part.installOrder!==index+1||resolve(root,part.file)!==join(pkg,basename(part.file))||!canonical||canonical.sha256!==part.sha256||canonical.characters!==part.characters||hash(source)!==part.sha256||source.length!==part.characters||basename(part.file)!==manifest.installationOrder[index]||!source.includes(`id="${part.scope.slice(1)}"`))throw Error('Part/order drift');
}
const browser=await chromium.launch({channel:'chrome',headless:false}),context=await browser.newContext({storageState:resolve(state),viewport:{width:1800,height:1600},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
context.setDefaultTimeout(7000);const page=await context.newPage(),editor=new DraftEditor(page,target,{lockFile:join(root,'verification/incremental-draft-504457/pipeline/page-locks.current.json')});
try{
 await page.goto(target.origin+'/admin/card?theme_id=504457',{waitUntil:'domcontentloaded',timeout:25000});await editor.ensureGroup();await page.locator('span[title="自定义"]').first().waitFor({timeout:15000});
 const results=[];
 for(const [index,part] of plan.parts.entries()){
  const count=await page.locator('span[title="自定义"]').count();if(count>4||count<index)throw Error('Unknown shared-group topology');
  const options:any={};
  if(index<count){
   const original=await editor.select(index);options.reuseIndex=index;
   if(hash(original)===part.sha256){console.log(JSON.stringify({part:part.id,action:'already-exact'}));continue;}
   if(index===0&&hash(original)===before.blocks[0].sha256){options.expectedPreviousSha=before.blocks[0].sha256;options.expectedPreviousRoot='s2s-content-probe';}
   else if(original.length!==136||!original.includes('Heading')||!original.includes('Body content'))throw Error('Unknown existing content prevents safe trial');
  }
  const result=await editor.installPart(pkg,dir,basename(part.file),options);results.push(result);console.log(JSON.stringify({event:'contact-part-saved-exact',part:part.id,index,sha256:result.sha256,published:false}));
 }
 const readerPage=await context.newPage();await readerPage.goto(page.url(),{waitUntil:'domcontentloaded',timeout:25000});const reader=new DraftEditor(readerPage,target);await reader.ensureGroup();await readerPage.locator('span[title="自定义"]').nth(3).waitFor({timeout:15000});
 const readbacks=[];
 for(const [index,part] of plan.parts.entries()){const code=await reader.select(index,part.scope.slice(1));if(hash(code)!==part.sha256)throw Error('Final independent part readback mismatch');const file='saved-current-'+part.id+'.html';await writeFile(join(dir,file),code);readbacks.push({index,id:part.id,sha256:hash(code),characters:code.length,file,exact:true});}
 await readerPage.close();
 const report={kind:'provisional-native-contact-four-part-independent-server-readback',target,version:plan.version,manifestSha256:hash(raw),compositionId:hash(JSON.stringify(readbacks)),parts:readbacks,bodyAndInteractionAcceptance:'pending',targetReady:false,fullSiteAcceptance:false,published:false,publicationAllowed:false};
 await writeFile(join(dir,'server-readback.json'),JSON.stringify(report,null,2));await page.screenshot({path:join(dir,'editor-saved.png')});console.log(JSON.stringify({event:'contact-all-four-parts-exact',version:plan.version,published:false}));
}catch(error){await page.screenshot({path:join(dir,'stopped.png')}).catch(()=>{});console.log(JSON.stringify({event:'contact-trial-stopped',error:error instanceof Error?error.message.slice(0,250):'Error',published:false}));process.exitCode=1;}
finally{await context.close();await browser.close();}
