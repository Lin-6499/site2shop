import {readFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {digest,writeJson,saveArtifact} from '../src/shopyy/artifacts.js';
const root=resolve('../voidresearch-shopyy'),version='r6-membership-native-bddb76eb66f4',dir=join(root,'staging/local-inner-candidates',version),mb=await readFile(join(dir,'manifest.json')),m=JSON.parse(mb.toString());
const parts=[];for(const p of m.parts){const html=await readFile(join(dir,p.file),'utf8');if(digest(html)!==p.sha256)throw Error('Part changed');parts.push({...p,html});}
const map=JSON.parse(await readFile(join(dir,'inputs/verified-asset-map.json'),'utf8')),assetManifest=JSON.parse(await readFile(join(root,'common/assets/images/source-current/manifest.json'),'utf8')),images=new Map();
for(const[token,url]of Object.entries(map)){const file=token.slice('images/source-current/'.length),asset=assetManifest.assets.find((a:any)=>a.file===file);if(asset)images.set(url,{type:asset.contentType,bytes:await readFile(join(root,'common/assets/images/source-current',file))});}
const nativeRules=JSON.parse(await readFile(join(root,'verification/incremental-draft-504457/pipeline/membership-native-checkbox-style-evidence.json'),'utf8'));
const host='vr-membership-route-host',rows:any[]=[],browser=await chromium.launch();
try{for(const[viewport,size]of Object.entries({desktop:{width:1440,height:1000},tablet:{width:768,height:1024},mobile:{width:375,height:812}})){
 const context=await browser.newContext({viewport:size});
 try{for(const state of ['active','deep-clone','deep-clone-detached-reinserted','duplicate-payload','changed-payload','removed-payload','replaced-host','native-content','wrong-skin','duplicate-param','contact-route','coa-route','policies-route']){
  const page=await context.newPage(),errors:string[]=[],nonGet:string[]=[];page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>{if(r.method()!=='GET')nonGet.push(r.url());});
  const html='<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}.block_html.container_wrapper{max-width:1100px;margin:31px;padding:19px}</style><style>'+nativeRules.rules.map((r:any)=>r.cssText).join('')+'</style></head><body><header id="card-header">Native header</header><div class="control-all-header-static">Native spacer</div><main id="MainContent"><div id="block-section-13251243" data-section-type="page_detail" data-section-id="13251243"><div class="page_detail_default container_wrapper"><h1 class="title">Membership</h1><div class="mo-editor-reset"><p>\u200b</p></div></div></div><div id="other-native">Other content</div>'+parts.map((p,i)=>'<section data-section-type="block_html" id="part-'+i+'"><div class="block_html container_wrapper">'+p.html+'</div></section>').join('')+'</main><footer id="card-footer">Native footer</footer><div id="body_domain_prompt">Platform notice</div></body></html>';
  await page.route('**/*',r=>{const image=images.get(r.request().url());return r.fulfill(image?{status:200,contentType:image.type,body:image.bytes}:{status:200,contentType:'text/html; charset=utf-8',body:html});});
  const path=state==='contact-route'?'/pages/Contact-Us':state==='coa-route'?'/pages/coa':state==='policies-route'?'/pages/policies':'/pages/membership';
  await page.goto('https://pepsss.zenshop.cn'+path+'?theme_id='+(state==='wrong-skin'?'1':'504457')+'&preview=1&is_theme_edit=1'+(state==='duplicate-param'?'&is_theme_edit=1':''));
  const startsActive=!['wrong-skin','duplicate-param','contact-route','coa-route','policies-route'].includes(state);
  if(startsActive)await page.locator('#'+host+'[data-ready="true"]').waitFor({timeout:20000});
  let controls:any[]=[],screenshots:any[]=[];
  if(state==='active'){
   const checkbox=page.locator('#vr-block-membership input[type=checkbox]').first();await checkbox.scrollIntoViewIfNeeded();
   for(const controlState of ['unchecked','checked','keyboard-focused']){
    if(controlState==='checked'){await checkbox.check();await checkbox.blur();}
    if(controlState==='keyboard-focused'){await checkbox.uncheck();await page.keyboard.press('Tab');await checkbox.focus();}
    const metrics=await checkbox.evaluate(n=>{const s=getComputedStyle(n),b=n.getBoundingClientRect();return{width:b.width,height:b.height,appearance:s.appearance,outline:s.outline,checked:(n as HTMLInputElement).checked,focused:document.activeElement===n,visible:b.width>0&&b.height>0&&s.display!=='none'};});
    const box=await checkbox.boundingBox();screenshots.push({state:controlState,image:await saveArtifact(root,await page.screenshot({clip:{x:box!.x-4,y:box!.y-4,width:24,height:24}}),'png')});controls.push({state:controlState,...metrics});
   }
   await page.evaluate(()=>scrollTo(0,0));screenshots.push({state:'initial',image:await saveArtifact(root,await page.screenshot(),'png')});
  }else if(startsActive){await page.evaluate(({state,host,id})=>{
   const h=document.getElementById(host)!,p=document.getElementById(id) as HTMLTemplateElement,main=document.getElementById('MainContent')!;
   if(state==='deep-clone'||state==='deep-clone-detached-reinserted'){const clone=h.cloneNode(true);if(state==='deep-clone-detached-reinserted'){h.remove();main.append(clone,h);}else main.append(clone);}
   if(state==='duplicate-payload')main.append(p.cloneNode(true));if(state==='changed-payload')p.content.append('Changed');if(state==='removed-payload')p.remove();if(state==='replaced-host')h.replaceWith(h.cloneNode(true));if(state==='native-content')document.querySelector('.mo-editor-reset')!.append('Changed owner');
  },{state,host,id:parts[0].id});}
  await page.waitForTimeout(40);
  const actual=await page.evaluate(host=>({ready:document.querySelectorAll('#'+host+'[data-ready="true"]').length,hosts:[...document.querySelectorAll('#'+host)].map(n=>({display:getComputedStyle(n).display,height:n.getBoundingClientRect().height})),nativeVisible:['card-header','block-section-13251243','card-footer'].every(id=>getComputedStyle(document.getElementById(id)!).display!=='none'),notice:getComputedStyle(document.getElementById('body_domain_prompt')!).display!=='none',other:getComputedStyle(document.getElementById('other-native')!).display!=='none'}),host);
  const active=state==='active',passed=actual.ready===(active?1:0)&&actual.nativeVisible===!active&&actual.notice&&actual.other&&(active||actual.hosts.every(h=>h.display==='none'&&h.height===0))&&!errors.length&&!nonGet.length&&(!active||controls.every(c=>c.visible&&c.width===16&&c.height===16&&c.appearance==='auto')&&controls[1].checked&&controls[2].focused);
  rows.push({viewport,state,passed,actual,controls,screenshots,errors,nonGet});console.log(JSON.stringify({viewport,state,passed}));await page.close();
 }}finally{await context.close();}
}}finally{await browser.close();}
const report='verification/public-content-native-local/'+version+'/deep-clone-checkbox-report.json';await mkdir(join(root,'verification/public-content-native-local',version),{recursive:true});await writeJson(join(root,report),{version,manifestSha256:digest(mb),kind:'local-native-rules-full-composition-deep-clone-and-checkbox-regression',rows,passed:rows.every(r=>r.passed),realNativeVerified:false,publicationAllowed:false});console.log(JSON.stringify({report,passed:rows.every(r=>r.passed),cases:rows.length}));if(rows.some(r=>!r.passed))process.exitCode=1;
