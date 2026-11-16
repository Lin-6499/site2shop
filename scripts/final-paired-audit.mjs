import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import sharp from 'sharp';

const project = path.resolve(process.argv[2]);
const runId = new Date().toISOString().replace(/[:.]/g,'-');
const dir = path.join(project,'final-acceptance',runId);
await fs.mkdir(dir,{recursive:true});
const read = async name => JSON.parse(await fs.readFile(path.join(project,name),'utf8'));
const build = await read('theme-build.json');
const deploy = await read('deployment.json');
const plan = await read('capture-plan.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = {schemaVersion:1,kind:'final-paired-audit',runId,createdAt:new Date().toISOString(),themeBuild:build.id,themeId:String(deploy.themeId),scope:['s2s-harold-hat','s2s-harold-wine-glass'],market:{country:'US',currency:'USD',locale:'en-US'},sessions:[],findings:[],passed:false,published:false};
const save = async (name,bytes) => {await fs.writeFile(path.join(dir,name),bytes);return {path:path.relative(project,path.join(dir,name)).replaceAll('\\','/'),sha256:hash(bytes)};};
const browser = await chromium.launch({headless:true});

async function open(rid,viewport,side){
 const context = await browser.newContext({viewport:plan.viewports[viewport],locale:'en-US',deviceScaleFactor:1,colorScheme:'light'});
 const page = await context.newPage();
 page.setDefaultTimeout(12000);
 const original = new URL(plan.routes[rid][side].canonical);
 original.searchParams.set('country','US'); original.searchParams.set('currency','USD');
 if(side==='target') original.searchParams.set('preview_theme_id',String(deploy.themeId));
 const expected = original.toString();
 let response;
 for(let attempt=0;attempt<2;attempt++){
  try{response=await page.goto(expected,{waitUntil:'domcontentloaded',timeout:45000});break;}
  catch(e){if(attempt)throw e;}
 }
 const password = page.locator('form[action*="/password"] input[name="password"]').first();
 if(await password.count()){
  if(!process.env.SITE2SHOP_STOREFRONT_PASSWORD)throw new Error('Missing storefront credential');
  await password.fill(process.env.SITE2SHOP_STOREFRONT_PASSWORD);
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:30000}).catch(()=>null),password.locator('xpath=ancestor::form[1]').evaluate(n=>n.requestSubmit())]);
  response=await page.goto(expected,{waitUntil:'domcontentloaded',timeout:45000});
 }
 await page.waitForLoadState('networkidle',{timeout:8000}).catch(()=>{});
 await page.waitForTimeout(2500);
 const identity=await page.evaluate(()=>({url:location.href,canonical:document.querySelector('link[rel="canonical"]')?.href,country:window.Shopify?.country,currency:window.Shopify?.currency,themeId:String(window.Shopify?.theme?.id||''),build:document.querySelector('meta[name="site2shop-build-id"]')?.content,viewport:{width:innerWidth,height:innerHeight},title:document.title}));
 if(response?.status()!==200||new URL(identity.url).pathname!==original.pathname||!identity.canonical||new URL(identity.canonical).pathname!==original.pathname||/password|challenge|access denied/i.test(identity.title))throw new Error('Invalid rendered page '+JSON.stringify(identity));
 if(identity.country!=='US'||identity.currency?.active!=='USD')throw new Error('Market normalization failed '+JSON.stringify(identity));
 if(side==='target'&&(identity.themeId!==String(deploy.themeId)||identity.build!==build.id))throw new Error('Wrong target build/theme '+JSON.stringify(identity));
 return {context,page,identity,side};
}

async function snapshot(env,rid,viewport,state,full=false){
 const {page,side}=env;
 const observation = await page.evaluate(()=>{
  const root=document.querySelector('#product-content-area');
  const metric=el=>{if(!el)return {presence:'absent'};const b=el.getBoundingClientRect(),s=getComputedStyle(el);return {presence:b.width&&b.height&&s.visibility!=='hidden'&&s.display!=='none'?'visible':'hidden',box:{x:b.x,y:b.y,width:b.width,height:b.height},computed:{display:s.display,position:s.position,fontSize:s.fontSize,lineHeight:s.lineHeight,fontFamily:s.fontFamily,padding:s.padding,margin:s.margin,overflowX:s.overflowX},text:el.textContent.trim().replace(/\s+/g,' ').slice(0,300)};};
  const price=root?.querySelector('.product-price-final,[data-s2s-price]');
  const sharing=root?.querySelector('.product-social-sharing');
  const payment=root?.querySelector('[aria-label*="payment" i],.payment-icons,.payment-badges,.s2s-harold-payments');
  const paymentSvgs=[...(root?.querySelectorAll('svg[aria-labelledby^="pi-"]')||[])];
  const selected=root?.querySelector('select[name="option-state"]')?.value;
  const quantity=root?.querySelector('input[name="quantity"]');
  const submit=[...(root?.querySelectorAll('button[type="submit"]')||[])].find(n=>n.getBoundingClientRect().height>0);
  return {price:metric(price),selectedState:selected,productDetails:metric(root),quantity:metric(quantity),submit:metric(submit),sharing:metric(sharing),shareLinks:[...(sharing?.querySelectorAll('a')||[])].map(n=>({text:n.textContent.trim().replace(/\s+/g,' '),href:n.href})),payment:metric(payment),paymentIcons:paymentSvgs.map(n=>n.getAttribute('aria-labelledby')),delivery:metric(root?.querySelector('.edt')),headings:[...document.querySelectorAll('main h2,#MainContent h2')].map(n=>n.textContent.trim().replace(/\s+/g,' ')),horizontalOverflow:document.documentElement.scrollWidth>innerWidth,images:[...document.querySelectorAll('main img,#MainContent img')].filter(n=>n.getBoundingClientRect().height>0&&n.complete&&!n.naturalWidth).map(n=>n.currentSrc),scrollY,linksToSource:[...(root?.querySelectorAll('a[href]')||[])].map(n=>n.href).filter(v=>/^https:\/\/haroldhome\.co/.test(v))};
 });
 const prefix=`${rid}-${viewport}-${side}-${state}`;
 const artifacts={screenshot:await save(`${prefix}.png`,await page.screenshot({animations:'disabled',scale:'css'})),dom:await save(`${prefix}.html`,await page.content())};
 if(full)artifacts.fullScreenshot=await save(`${prefix}-full.png`,await page.screenshot({fullPage:true,animations:'disabled',scale:'css'}));
 const evidence={capturedAt:new Date().toISOString(),routeId:rid,viewport,state,side,identity:env.identity,observation,artifacts};
 evidence.ref=await save(`${prefix}.json`,JSON.stringify(evidence,null,2));return evidence;
}

async function audit(rid,viewport){
 const session={routeId:rid,viewport,checks:[],errors:[]};report.sessions.push(session);
 const envs=[];
 try{
  envs.push(...await Promise.all(['source','target'].map(side=>open(rid,viewport,side))));
  for(const state of ['initial','scrolled']){
   if(state==='scrolled')for(const env of envs)await env.page.evaluate(()=>{const n=document.querySelector('#product-content-area');window.scrollTo(0,Math.max(0,n.getBoundingClientRect().top+scrollY-180));});
   const pair=await Promise.all(envs.map(env=>snapshot(env,rid,viewport,state,state==='initial')));
   session.checks.push({state,source:pair[0],target:pair[1]});
  }
  const action={name:'state-option-change-and-return',input:['Alaska','Alabama'],sides:[]};
  for(const env of envs){
   const states=[];
   for(const value of action.input){await env.page.locator('select[name="option-state"]').selectOption(value);await env.page.waitForTimeout(400);states.push(await snapshot(env,rid,viewport,`state-${value.toLowerCase()}`));}
   action.sides.push({side:env.side,states});
  }
  session.actions=[action];
  const source=session.checks[0].source.observation,target=session.checks[0].target.observation;
  if(source.price.text!==target.price.text)report.findings.push({id:'PRICE-'+rid+'-'+viewport,status:'open',routeId:rid,viewport,expected:source.price.text,actual:target.price.text});
  for(const key of ['sharing','delivery'])if(source[key].presence==='visible'&&target[key].presence!=='visible')report.findings.push({id:key.toUpperCase()+'-'+rid+'-'+viewport,status:'open',routeId:rid,viewport,component:key,expected:'visible',actual:target[key].presence});
  if(source.paymentIcons.length&&!target.paymentIcons.length)report.findings.push({id:'PAYMENT-'+rid+'-'+viewport,status:'open',routeId:rid,viewport,component:'payment-icons',expected:source.paymentIcons,actual:target.paymentIcons});
  if(target.horizontalOverflow)report.findings.push({id:'OVERFLOW-'+rid+'-'+viewport,status:'open',routeId:rid,viewport});
  if(target.images.length)report.findings.push({id:'BROKEN-IMAGES-'+rid+'-'+viewport,status:'open',routeId:rid,viewport,images:target.images});
  for(const env of envs){
   const uri=env.side==='source'?envs[0].identity.url:envs[1].identity.url;
   session.errors.push(...(new URL(uri).pathname===new URL(plan.routes[rid][env.side].canonical).pathname?[]:['route-mismatch']));
  }
  console.log(JSON.stringify({routeId:rid,viewport,currency:[...envs.map(n=>n.identity.currency.active)],price:[source.price.text,target.price.text],sharing:[source.sharing.presence,target.sharing.presence],payments:[source.paymentIcons.length,target.paymentIcons.length],delivery:[source.delivery.presence,target.delivery.presence]}));
 }catch(e){session.errors.push(String(e));report.findings.push({id:'CAPTURE-'+rid+'-'+viewport,status:'blocked',routeId:rid,viewport,error:String(e)});console.log('CAPTURE_FAILURE',rid,viewport,String(e));}
 finally{for(const env of envs)await env.context.close();await fs.writeFile(path.join(dir,`${rid}-${viewport}-session.json`),JSON.stringify(session,null,2));}
}
try{
 const jobs=report.scope.flatMap(rid=>Object.keys(plan.viewports).map(viewport=>({rid,viewport})));
 let next=0;
 await Promise.all([0,1].map(async()=>{while(next<jobs.length){const job=jobs[next++];await audit(job.rid,job.viewport);}}));
 report.completedAt=new Date().toISOString();report.passed=report.findings.length===0;
 await fs.writeFile(path.join(dir,'audit.json'),JSON.stringify(report,null,2));
 for(const rid of report.scope){
  const panels=[];
  for(const viewport of Object.keys(plan.viewports)){
   const session=report.sessions.find(s=>s.routeId===rid&&s.viewport===viewport);
   const pair=session?.checks?.find(c=>c.state==='scrolled');if(!pair)continue;
   for(const side of ['source','target']){
    const input=await sharp(await fs.readFile(path.join(project,pair[side].artifacts.screenshot.path))).resize({width:600,height:600,fit:'contain',background:'white'}).png().toBuffer();
    const label=Buffer.from(`<svg width="600" height="30"><rect width="600" height="30" fill="#111"/><text x="10" y="21" fill="white" font-size="16">${rid} ${viewport} ${side} US/USD</text></svg>`);
    panels.push(await sharp({create:{width:600,height:630,channels:3,background:'white'}}).composite([{input,top:30,left:0},{input:label,top:0,left:0}]).png().toBuffer());
   }
  }
  if(panels.length)await sharp({create:{width:1200,height:630*Math.ceil(panels.length/2),channels:3,background:'white'}}).composite(panels.map((input,i)=>({input,left:i%2*600,top:Math.floor(i/2)*630}))).png().toFile(path.join(dir,`${rid}-comparison.png`));
 }
 console.log('FINAL_AUDIT',dir,'passed='+report.passed,'findings='+report.findings.length);
}finally{await browser.close();}
