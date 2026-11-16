import {chromium,type Page} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const state=process.argv[2];if(!state)throw Error('Authorized state path required');
const root=resolve('../voidresearch-shopyy'),recipeRaw=await readFile(join(root,'verification/native-shell-state-recipes.json'),'utf8'),recipes=JSON.parse(recipeRaw),buildRaw=await readFile(join(root,'verification/incremental-draft-504457/home-current-server-readback.json'),'utf8'),build=JSON.parse(buildRaw);
const hash=(s:Buffer|string)=>createHash('sha256').update(s).digest('hex'),out=join(root,'verification/incremental-draft-504457/native-shell-r5-states-r2');await mkdir(out,{recursive:true});
if(build.blocks[0].version!==recipes.frozenNavigation||build.target.skinId!=='504457'||build.published!==false)throw Error('Recipe composition mismatch');
function locator(page:Page,s:any){const base=s.within?page.locator(s.within):page;return s.role?base.getByRole(s.role,{name:s.name,exact:s.exact!==false}):page.locator(s.selector);}
async function check(page:Page,c:any){
 let l=page.locator(c.selector);if(c.textExact)l=l.filter({hasText:new RegExp('^'+c.textExact.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')});
 const checks=[];
 if(c.count!==undefined)checks.push({assert:'count',actual:await l.count(),expected:c.count});
 if(c.visible!==undefined)checks.push({assert:'visible',actual:await l.isVisible(),expected:c.visible});
 if(c.attribute)checks.push({assert:c.attribute,actual:await l.getAttribute(c.attribute),expected:c.equals});
 if(c.textIncludes)checks.push({assert:'textIncludes',actual:(await l.innerText()).includes(c.textIncludes),expected:true});
 if(c.placeholder)checks.push({assert:'placeholder',actual:await l.getAttribute('placeholder'),expected:c.placeholder});
 if(c.focused)checks.push({assert:'focused',actual:await l.evaluate(e=>document.activeElement===e),expected:true});
 if(c.boundingRectHeight!==undefined)checks.push({assert:'height',actual:await l.evaluate(e=>e.getBoundingClientRect().height),expected:c.boundingRectHeight});
 for(const [key,value] of Object.entries(c.inlineStyle||{}))checks.push({assert:'inline-'+key,actual:await l.evaluate((e,k)=>(e as HTMLElement).style.getPropertyValue(k),key),expected:value});
 for(const [key,value] of Object.entries(c.computedStyle||{})){
  await page.waitForFunction(({selector,key,value})=>{const e=document.querySelector(selector);return e&&getComputedStyle(e).getPropertyValue(key)===value;},{selector:c.selector,key,value},{timeout:3000});
  checks.push({assert:'computed-'+key,actual:await l.evaluate((e,k)=>getComputedStyle(e).getPropertyValue(k),key),expected:value});
 }
 return checks.map(v=>({...v,passed:v.actual===v.expected}));
}
const browser=await chromium.launch({channel:'chrome',headless:false}),rows:any[]=[];
try{for(const [device,viewport] of Object.entries(recipes.viewports) as any){
 const context=await browser.newContext({storageState:resolve(state),viewport,locale:'en-US',timezoneId:'America/New_York'});context.setDefaultTimeout(7000);
 try{for(const recipe of recipes.recipes.filter((r:any)=>r.devices.includes(device))){
  const page=await context.newPage(),row:any={device,recipe:recipe.id,steps:[],sourcePairedAcceptance:false};
  try{
   await page.goto(recipes.target.origin+'/?theme_id=504457&preview=1&is_theme_edit=1&device='+(device==='mobile'?'phone':'computer'),{waitUntil:'domcontentloaded',timeout:25000});await page.locator('#vr-block-navigation[data-initialized="true"]').waitFor({timeout:15000});
   if(await page.evaluate(()=>document.body.dataset.vrMode==='fixture'))throw Error('Native fixture mode is forbidden');
   await page.evaluate(()=>{(window as any).__vrObserved=[];document.addEventListener('vr:unbound-capability',(e:Event)=>{const d=(e as CustomEvent).detail;(window as any).__vrObserved.push({capability:d?.capability||null});});});
   for(const [i,s] of recipe.steps.entries()){
    const record:any={index:i,action:s.action};
    if(s.action==='observe-capability'){record.value=await page.evaluate(prop=>typeof (window as any).VoidShopyyBridge?.[prop.includes('openCart')?'openCart':'search'],s.property);row.bridgePresent=record.value==='function';}
    else if(s.action==='press')await page.keyboard.press(s.key);
    else if(s.action==='fill')await locator(page,s).fill(s.value);
    else if(s.action==='click')await locator(page,s).click();
    else if(s.action==='hover')await locator(page,s).hover();
    else if(s.action==='assert')record.checks=[{assert:'visible',actual:await locator(page,s).isVisible(),expected:s.visible,passed:await locator(page,s).isVisible()===s.visible}];
    else throw Error('Unsupported observed recipe action');
    await page.waitForTimeout(120);
    for(const c of s.assert||[])record.checks=[...(record.checks||[]),...await check(page,c)];
    const file=device+'-'+recipe.id+'-'+i+'.png';await page.screenshot({path:join(out,file)});record.screenshot={file,sha256:hash(await readFile(join(out,file)))};row.steps.push(record);
   }
   row.unboundEvents=await page.evaluate(()=>(window as any).__vrObserved);
   if(recipe.ifBridgeAbsent&&!row.bridgePresent){row.backendStatus='unbound';const expected=recipe.ifBridgeAbsent.detailCapability;row.unboundObserved=row.unboundEvents.some((e:any)=>e.capability===expected);if(!row.unboundObserved)throw Error('Expected native unbound event absent');for(const c of recipe.ifBridgeAbsent.assert||[])row.steps.push({boundaryChecks:await check(page,c)});}
   else if(recipe.ifBridgePresent)row.backendStatus='separate-native-data-acceptance-pending';
   row.passed=row.steps.every((s:any)=>[...(s.checks||[]),...(s.boundaryChecks||[])].every((c:any)=>c.passed));
  }catch(e){row.passed=false;row.error=e instanceof Error?e.message.slice(0,220):'Error';}
  finally{rows.push(row);console.log(JSON.stringify({device,recipe:recipe.id,passed:row.passed,backendStatus:row.backendStatus,error:row.error}));await page.close();}
 }}finally{await context.close();}
}}finally{await browser.close();}
await writeFile(join(out,'report.json'),JSON.stringify({kind:'actual-native-shell-presentation-and-unbound-boundary-observations',compositionReportSha256:hash(buildRaw),recipesSha256:hash(recipeRaw),target:build.target,rows,passed:rows.every(r=>r.passed),catalogAccepted:false,cartFlowAccepted:false,sourcePairedAcceptance:false,wholeSiteAccepted:false,published:false},null,2));if(rows.some(r=>!r.passed))process.exitCode=1;
