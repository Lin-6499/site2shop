import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';

// Use only the user-provided, manually authenticated automation state.
// No regular Chrome profile, fingerprint overrides, CAPTCHA automation or credential logging.
const statePath=resolve(process.argv[2] || '');
if(!process.argv[2])throw Error('Provide the manually authenticated automation state path');
const checkpointFile=resolve('../voidresearch-shopyy/verification/restart-checkpoint/checkpoint.json');
const checkpoint=JSON.parse(await readFile(checkpointFile,'utf8'));
if(checkpoint.target.role!=='draft'||checkpoint.publicationAllowed!==false)throw Error('Draft-only target required');
const target=new URL(`/admin/card?theme_id=${checkpoint.target.skinId}`,checkpoint.target.origin);
const browser=await chromium.launch({channel:'chrome',headless:process.argv.includes('--headless')});
const context=await browser.newContext({storageState:statePath,viewport:{width:1440,height:900},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
const page=await context.newPage();
const rows:any[]=[];
let outcome='not-verified';
try{
  const t=performance.now();
  await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:30000});
  const navigationMs=performance.now()-t;
  await page.locator('span[title="自定义"]').first().waitFor({state:'visible',timeout:15000});
  if(new URL(page.url()).origin!==target.origin||new URL(page.url()).pathname!==target.pathname||new URL(page.url()).searchParams.get('theme_id')!==checkpoint.target.skinId)throw Error('Target identity mismatch');
  for(let n=0;n<3;n++){
    const r=performance.now();
    const observation=await page.evaluate(()=>({ready:document.readyState,customBlocks:document.querySelectorAll('span[title="自定义"]').length}));
    rows.push({readMs:performance.now()-r,observation});
  }
  const frame=page.frameLocator('#iframe');
  await frame.locator('#vr-block-navigation').waitFor({state:'attached',timeout:15000});
  const composition=await frame.locator('body').evaluate(b=>({url:location.href,roots:[...b.querySelectorAll('[id^="vr-block-"]')].map(e=>e.id),navigationInitialized:b.querySelector('#vr-block-navigation')?.getAttribute('data-initialized')}));
  outcome='authenticated-draft-read-verified';
  const report={kind:'user-provided-automation-session-standard-playwright-check',capturedAt:new Date().toISOString(),target:checkpoint.target,navigationMs,rows,composition,outcome,credentialsLogged:false,fingerprintOverrides:false,regularChromeAttached:false,remoteMutations:false,published:false};
  await writeFile(join(dirname(checkpointFile),'authenticated-playwright-check.json'),JSON.stringify(report,null,2));
  await page.screenshot({path:join(dirname(checkpointFile),'authenticated-playwright-draft.png'),fullPage:false});
  console.log(JSON.stringify(report,null,2));
}catch(error){
  const u=new URL(page.url());
  const report={kind:'authenticated-playwright-check-not-passed',capturedAt:new Date().toISOString(),target:checkpoint.target,finalOrigin:u.origin,finalPath:u.pathname,outcome,error:error instanceof Error?error.name:'Error',credentialsLogged:false,fingerprintOverrides:false,remoteMutations:false,published:false};
  await writeFile(join(dirname(checkpointFile),'authenticated-playwright-check.failed.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));process.exitCode=1;
}finally{await context.close();await browser.close();}
