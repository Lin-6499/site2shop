'use strict';
// Root supplies already authenticated pages. This module never owns browser lifecycle.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { DraftEditor } = require('./shopyy-draft-editor.cjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = message => { throw Error(message); };
const IDS = ['vr-coa-payload-navigation', ...Array.from({length:5},(_,i)=>`vr-coa-payload-templates-${i+1}`), 'vr-coa-payload-directory','vr-coa-payload-footer','vr-coa-route-host'];
const inside = (root,file) => {
  const resolved=path.resolve(root,file), relative=path.relative(root,resolved);
  if(relative.startsWith('..')||path.isAbsolute(relative))fail('Artifact escapes projectRoot');
  return resolved;
};
async function json(file) { return JSON.parse(await fs.readFile(file,'utf8')); }

// Clamp each awaited Playwright operation, rather than racing a mutation that could
// continue after the caller has returned. Leave time for failure evidence/checkpoint.
function bounded(page, deadline) {
  const cache=new WeakMap();
  function wrap(object) {
    if(cache.has(object))return cache.get(object);
    const proxy=new Proxy(object,{get(target,key){
      const member=target[key];if(typeof member!=='function')return member;
      return (...args)=>{
        const remaining=deadline-Date.now()-3500;
        if(remaining<150)fail('Call time budget exhausted before '+String(key));
        if(['locator','getByRole','getByText','first','last','nth','filter'].includes(key))return wrap(member.apply(target,args));
        if(key==='waitForTimeout'){if(args[0]>remaining)fail('Insufficient wait budget');}
        else if(key==='waitForFunction')args[2]={...args[2],timeout:Math.min(args[2]?.timeout||5000,remaining)};
        else if(['goto','waitFor','click','fill','press','inputValue','getAttribute','isVisible','screenshot'].includes(key)){
          const slot=key==='goto'||key==='fill'||key==='press'||key==='getAttribute'?1:0;
          args[slot]={...args[slot],timeout:Math.min(args[slot]?.timeout||5000,remaining)};
        }
        return member.apply(target,args);
      };
    }});cache.set(object,proxy);return proxy;
  }
  return wrap(page);
}
async function lockCheck(s) {
  const locks=await json(s.lockFile); // Missing lock registry is a hard stop here.
  if(locks.target?.origin!==s.target.origin||String(locks.target?.skinId)!==s.target.skinId)fail('Page lock target mismatch');
  if(locks.active&&locks.groups?.includes('自定义页面')){
    const release=await json(locks.releaseFile);
    if(release.batchId!==locks.batchId||release.writerMayResume!==true)fail('Independent read-only page lock active');
  }
}
async function persist(s,event,extra={}) {
  s.checkpoint.updatedAt=new Date().toISOString();
  s.checkpoint.events.push({at:s.checkpoint.updatedAt,event,...extra});
  await fs.writeFile(path.join(s.directory,'checkpoint.json'),JSON.stringify(s.checkpoint,null,2));
}
async function load(options) {
  if(!options?.editorPage||!options.readbackPage||options.editorPage===options.readbackPage)fail('Two distinct existing pages required');
  const root=path.resolve(options.projectRoot), planPath=inside(root,options.planFile), reviewPath=inside(root,options.reviewFile);
  const planBytes=await fs.readFile(planPath),reviewBytes=await fs.readFile(reviewPath);
  const plan=JSON.parse(planBytes),review=JSON.parse(reviewBytes);
  const manifest=await fs.readFile(inside(root,plan.candidateManifest.file));
  if(sha(manifest)!==plan.candidateManifest.sha256||review.manifestSha256!==sha(manifest)||review.provisionalDraftTrialAllowed!==true||review.checksPassed!==true)fail('Exact independent trial review is absent or rejected');
  if(plan.publicationAllowed!==false||plan.editCmsContentAllowed!==false||plan.createAdditionalCmsRecordsAllowed!==false||plan.userAuthorizedCmsRecord!=='6592689')fail('Unsupported authority');
  const target=plan.target;
  if(target.origin!=='https://pepsss.zenshop.cn'||target.skinId!=='504457'||target.role!=='draft'||target.pathname!=='/pages/coa'||target.cmsRecordId!=='6592689'||plan.group!=='自定义页面')fail('Wrong draft/CMS target');
  if(JSON.stringify(target.requiredParams)!==JSON.stringify({theme_id:'504457',preview:'1',is_theme_edit:'1'}))fail('Wrong draft parameters');
  if(plan.parts?.length!==9)fail('Exactly nine parts required');
  const parts=[];
  for(let i=0;i<9;i++){
    const part=plan.parts[i],code=await fs.readFile(inside(root,part.file),'utf8');
    if(part.id!==IDS[i]||part.installOrder!==i+1||part.action!=='append-new-owned-block-only'||sha(code)!==part.sha256||code.length!==part.characters||!code.includes(`id="${part.id}"`)||/site2shop-assets\.invalid|\{\{(?:asset|route)/.test(code))fail('Invalid frozen part '+i);
    parts.push({...part,code});
  }
  // Caller must name the independently accepted current Contact receipt. Never
  // bless arbitrary live editor contents as the original baseline.
  const baselinePath=inside(root,options.existingReadbackFile||fail('existingReadbackFile required'));
  const baselineBytes=await fs.readFile(baselinePath),baseline=JSON.parse(baselineBytes);
  if(baseline.target?.origin!==target.origin||String(baseline.target?.skinId)!==target.skinId||baseline.parts?.length!==4||baseline.parts.some((p,i)=>p.index!==i||p.exact!==true||!/^\w{64}$/.test(p.sha256)))fail('Invalid four-part Contact baseline receipt');
  const binding={planSha256:sha(planBytes),reviewSha256:sha(reviewBytes),manifestSha256:sha(manifest),baselineSha256:sha(baselineBytes)};
  const directory=inside(root,options.checkpointDirectory||`verification/incremental-draft-504457/coa-batch-${binding.manifestSha256.slice(0,12)}`);
  await fs.mkdir(directory,{recursive:true});
  let checkpoint;
  try{checkpoint=await json(path.join(directory,'checkpoint.json'));}catch(e){if(e.code!=='ENOENT')throw e;checkpoint={schemaVersion:1,binding,version:plan.version,completed:0,status:'new',events:[],published:false,targetReady:false};}
  if(JSON.stringify(checkpoint.binding)!==JSON.stringify(binding))fail('Checkpoint belongs to another plan/review/baseline');
  return {...options,root,plan,parts,target,baseline,binding,directory,checkpoint,lockFile:inside(root,options.lockFile||'verification/incremental-draft-504457/pipeline/page-locks.current.json')};
}
function context(s) {
  const deadline=Date.now()+55000,page=bounded(s.editorPage,deadline),readback=bounded(s.readbackPage,deadline);
  return {deadline,page,readback,editor:new DraftEditor(page,{...s.target,pageGroup:'自定义页面'},{lockFile:s.lockFile,writerLease:s.writerLease})};
}
async function raw(s,c,count,attempts=2) {
  let last;
  for(let attempt=0;attempt<attempts;attempt++){
    try{
      await lockCheck(s);
      const url=new URL(s.target.pathname,s.target.origin);
      for(const[k,v]of Object.entries(s.target.requiredParams))url.searchParams.set(k,v);
      const response=await c.readback.goto(url.href,{waitUntil:'domcontentloaded',timeout:18000});
      const final=new URL(s.readbackPage.url());
      if(!response||response.status()!==200||final.origin!==s.target.origin||final.pathname!==s.target.pathname||final.searchParams.size!==3||Object.entries(s.target.requiredParams).some(([k,v])=>final.searchParams.getAll(k).length!==1||final.searchParams.get(k)!==v))fail('Strict native COA GET identity failed');
      const html=await response.text(),rows=[];
      for(let i=0;i<4+count;i++){
        const code=i<4?await fs.readFile(path.join(s.directory,`original-${i}.html`),'utf8'):s.parts[i-4].code;
        const position=html.indexOf(code);
        if(position<0||html.indexOf(code,position+code.length)>=0)fail('Native raw code missing/duplicated at '+i);
        rows.push({index:i,sha256:sha(code),position});
      }
      if(rows.some((r,i)=>i&&r.position<=rows[i-1].position))fail('Native raw part order mismatch');
      const receipt={url:final.href,httpStatus:200,htmlSha256:sha(html),rows};
      await fs.writeFile(path.join(s.directory,`raw-${count}.json`),JSON.stringify(receipt,null,2));
      return receipt;
    }catch(e){last=e;await persist(s,'GET-readback-failed',{attempt:attempt+1,error:e.message});if(Date.now()+21000>c.deadline)break;}
  }
  throw last;
}
async function readEditor(s,c,total,backup=false,expectedCount=total) {
  if(await c.page.locator('span[title="自定义"]').count()!==expectedCount)fail('Unexpected shared-group block count');
  const rows=[];
  for(let i=0;i<total;i++){
    const code=await c.editor.select(i),expected=i<4?s.baseline.parts[i]:s.parts[i-4];
    if(sha(code)!==expected.sha256||code.length!==expected.characters)fail('Unknown/mixed/rewritten editor code at '+i);
    if(i>=4&&await c.page.getByRole('switch').first().getAttribute('aria-checked')!=='true')fail('New part is not full-width at '+i);
    if(backup&&i<4)await fs.writeFile(path.join(s.directory,`original-${i}.html`),code,{flag:'wx'}).catch(async e=>{if(e.code!=='EEXIST'||sha(await fs.readFile(path.join(s.directory,`original-${i}.html`)))!==sha(code))throw e;});
    const editorIdentity=await c.page.locator('span[title="自定义"]').nth(i).evaluate(el=>{
      const rows=[];let node=el;
      for(let depth=0;node&&depth<4;depth++,node=node.parentElement)rows.push({tag:node.tagName,attributes:[...node.attributes].filter(a=>a.name==='id'||a.name.startsWith('data-')).map(a=>[a.name,a.value])});
      return rows;
    });
    rows.push({index:i,sha256:sha(code),characters:code.length,editorIdentity});
  }
  return rows;
}
async function execute(s,name,body) {
  if(s.inFlight)fail('Another batch call is still running; never parallelize editor mutations');
  s.inFlight=true;
  const c=context(s);
  try{await lockCheck(s);await persist(s,name+'-started');return await body(c);}
  catch(e){
    s.checkpoint.status=s.checkpoint.possibleMutation?'unknown-save-state':'stopped';
    const url=s.editorPage.url();
    let screenshot=null;
    if(Date.now()+2000<c.deadline){screenshot=path.join(s.directory,`failure-${Date.now()}.png`);await s.editorPage.screenshot({path:screenshot,timeout:1800}).catch(()=>{screenshot=null;});}
    await persist(s,name+'-failed',{error:e.message,url,screenshot});
    e.checkpointFile=path.join(s.directory,'checkpoint.json');throw e;
  }finally{s.inFlight=false;}
}

/** prepare({ editorPage, readbackPage, projectRoot, planFile, reviewFile,
 * existingReadbackFile, checkpointDirectory?, lockFile? }) -> batch
 * Root invokes all methods; no automatic retries of any editor mutation. */
async function prepare(options) {
  const s=await load(options);
  await execute(s,'prepare',async c=>{
    if(s.checkpoint.status==='unknown-save-state')fail('Unknown save requires nextPart GET reconciliation; do not prepare over it');
    const url=new URL(s.editorPage.url());
    if(url.origin!==s.target.origin||url.pathname!=='/admin/card'||url.searchParams.getAll('theme_id').length!==1||url.searchParams.get('theme_id')!==s.target.skinId)fail('Wrong existing editor');
    await c.page.goto(url.href,{waitUntil:'domcontentloaded',timeout:16000});
    await c.editor.ensureGroup();await c.editor.assertWritable();
    const rows=await readEditor(s,c,4+s.checkpoint.completed,true);
    await raw(s,c,s.checkpoint.completed);
    s.checkpoint.status='prepared';await persist(s,'prepared',{rows});
  });return s;
}
async function nextPart(s) {
  if(!s?.checkpoint||!['prepared','part-verified','unknown-save-state'].includes(s.checkpoint.status))fail('Prepared batch required');
  return execute(s,'nextPart',async c=>{
    if(s.checkpoint.completed===9)return {done:true,checkpointFile:path.join(s.directory,'checkpoint.json')};
    const n=s.checkpoint.completed,part=s.parts[n];
    await c.editor.ensureGroup();await c.editor.assertWritable();
    if(s.checkpoint.status==='unknown-save-state'){
      // Read-only reconciliation only: no fill/create/switch retry after uncertainty.
      if(await c.page.locator('span[title="自定义"]').count()!==5+n)fail('Unknown save cannot be reconciled by count');
      await readEditor(s,c,5+n);await raw(s,c,n+1);
    }else{
      if(await c.page.locator('span[title="自定义"]').count()!==4+n)fail('Unexpected extra/partial COA block');
      // Check old four immediately before mutation. Prior new parts are bound by
      // exact raw bytes too; never infer ownership from marker alone.
      await readEditor(s,c,4,false,4+n);
      await raw(s,c,n,1);
      if(Date.now()+22000>c.deadline)fail('Insufficient bounded mutation budget; no new part written');
      s.checkpoint.possibleMutation=true;await persist(s,'before-create',{partIndex:n,partId:part.id});
      const index=await c.editor.create();
      if(index!==4+n)fail('Created block index mismatch');
      const editorIdentity=await c.page.locator('span[title="自定义"]').nth(index).evaluate(el=>{
        const rows=[];let node=el;
        for(let depth=0;node&&depth<4;depth++,node=node.parentElement)rows.push({tag:node.tagName,attributes:[...node.attributes].filter(a=>a.name==='id'||a.name.startsWith('data-')).map(a=>[a.name,a.value])});
        return rows;
      });
      await persist(s,'created-visible-block',{index,editorIdentity});
      const field=c.page.locator('textarea[placeholder="请输入代码"]');
      const initial=await field.inputValue();
      if(initial.length!==136||!initial.includes('Heading')||!initial.includes('Body content'))fail('New block is not known empty default');
      await c.editor.assertWritable();await persist(s,'before-fill',{index,sha256:part.sha256});
      await field.fill(part.code);await field.press('Tab');await c.page.waitForTimeout(1200);
      await c.editor.assertWritable();
      const full=c.page.getByRole('switch').first();
      if(await full.getAttribute('aria-checked')!=='true')await c.editor.click(full);
      await c.page.waitForTimeout(1500);
      if(await full.getAttribute('aria-checked')!=='true'||sha(await field.inputValue())!==part.sha256)fail('Visible code/full-width verification failed');
      await persist(s,'save-triggered-awaiting-GET',{index});
      await raw(s,c,n+1);
    }
    s.checkpoint.completed=n+1;s.checkpoint.possibleMutation=false;s.checkpoint.status='part-verified';
    await persist(s,'part-verified',{partId:part.id,sha256:part.sha256});
    return {completed:n+1,total:9,done:n+1===9,partId:part.id};
  });
}
async function finish(s) {
  if(s?.checkpoint?.completed!==9||s.checkpoint.status!=='part-verified')fail('All nine parts must be verified first');
  return execute(s,'finish',async c=>{
    await c.page.goto(s.editorPage.url(),{waitUntil:'domcontentloaded',timeout:16000});
    await c.editor.ensureGroup();await c.editor.assertWritable();
    const rows=await readEditor(s,c,13);const native=await raw(s,c,9,1);
    await lockCheck(s);s.checkpoint.status='transport-verified';
    await persist(s,'finished',{rows,native,acceptance:'transport only; native visual/behavior review pending',published:false});
    return {status:s.checkpoint.status,rows,native,published:false,targetReady:false,checkpointFile:path.join(s.directory,'checkpoint.json')};
  });
}
module.exports={prepare,nextPart,finish};
