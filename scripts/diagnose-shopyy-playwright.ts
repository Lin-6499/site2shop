import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// A new, dedicated browser. Never attach to regular Chrome or import its credentials.
const checkpointFile = resolve(process.argv.slice(2).find(arg=>!arg.startsWith('--')) || '../voidresearch-shopyy/verification/restart-checkpoint/checkpoint.json');
const checkpoint = JSON.parse(await readFile(checkpointFile, 'utf8'));
if (checkpoint.target.role !== 'draft' || checkpoint.publicationAllowed !== false) throw new Error('Draft-only checkpoint required');
const origin = new URL(checkpoint.target.origin);
if (origin.protocol !== 'https:' || origin.username || origin.password || !/^\d+$/.test(checkpoint.target.skinId)) throw new Error('Invalid target identity');
const editorUrl = new URL(`/admin/card?theme_id=${checkpoint.target.skinId}`, origin).href;
const profile = join(homedir(), '.codex', 'browser-profiles', 'site2shop', `shopyy-target-${createHash('sha256').update(origin.origin).digest('hex').slice(0,24)}`);
const open = process.argv.includes('--open');
if (open) {
  await mkdir(profile, {recursive:true});
  const context = await chromium.launchPersistentContext(profile, {headless:false, viewport:{width:1440,height:900}});
  const page = context.pages()[0] || await context.newPage();
  await page.goto(editorUrl, {waitUntil:'domcontentloaded', timeout:60000});
  console.log(JSON.stringify({kind:'manual-target-login',target:checkpoint.target,instruction:'Sign in manually, confirm draft 504457, then close this dedicated browser. Do not publish. Credentials stay outside the project.'}));
  await context.waitForEvent('close', {timeout:0});
  console.log(JSON.stringify({kind:'manual-target-browser-closed',publishedByScript:false}));
} else {
  const browser = await chromium.launch({headless:true});
  const rows: any[] = [];
  try {
    for (const [id,url] of [['empty','about:blank'],['external-control','https://example.com/'],['target-editor',editorUrl]]) {
      const page = await browser.newPage();
      const started = performance.now();
      try {
        await page.goto(url, {waitUntil:'domcontentloaded',timeout:30000});
        const navigationMs = performance.now()-started;
        const reads: number[] = [];
        let observation: any;
        for (let n=0;n<3;n++) {
          const t=performance.now();
          observation=await page.evaluate(()=>({ready:document.readyState,nodes:document.querySelectorAll('*').length,customBlocks:document.querySelectorAll('span[title="自定义"]').length}));
          reads.push(performance.now()-t);
        }
        const finalUrl=new URL(page.url());
        rows.push({id,navigationMs,readMs:reads,observation,finalOrigin:finalUrl.origin,finalPath:finalUrl.pathname,authenticatedTarget:id==='target-editor'&&observation.customBlocks>0});
      } catch(error) { rows.push({id,failed:true,error:error instanceof Error?error.name:'Error'}); }
      await page.close();
    }
  } finally { await browser.close(); }
  const report={kind:'standalone-playwright-read-only-benchmark',capturedAt:new Date().toISOString(),target:checkpoint.target,rows,regularChromeAttached:false,credentialsImported:false,remoteChanges:false,published:false};
  await writeFile(join(dirname(checkpointFile),'playwright-benchmark.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
