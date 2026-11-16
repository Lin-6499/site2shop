import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {normalizeCaptureContext,settleDocumentScroll} from '../src/shopyy/browser.js';

test('capture context logs real delayed dismissal and preserves a fresh visible branch without storage mutation',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const html='<main style="height:3000px"><h1>Page</h1></main><div id="notice" hidden><button id="dismiss" type="button">Dismiss</button></div><script>setTimeout(()=>notice.hidden=false,30);dismiss.onclick=()=>notice.hidden=true</script>';
  await page.setContent(html);
  const policy={id:'ordinary-page',rationale:'Independent notice branches retained',preservedBranch:'notice-visible-dismissed-fresh-context',dismissals:[{selector:'#dismiss',op:'press',value:'Enter',waitMs:1000}]};
  const log=await normalizeCaptureContext(page,policy);
  assert.equal(log[0].status,'performed');assert.equal(await page.locator('#notice').isVisible(),false);
  assert.equal(await page.locator('#notice').count(),1,'Dismissal used the real control, not DOM removal');
  const absent=await normalizeCaptureContext(page,{...policy,dismissals:[{...policy.dismissals[0],waitMs:10}]});
  assert.equal(absent[0].status,'not-shown');
  const fresh=await browser.newPage();await fresh.setContent(html);await fresh.locator('#notice').waitFor({state:'visible'});
  assert.equal(await fresh.locator('#notice').isVisible(),true,'Fresh context keeps the independent visible/reset branch');
  await page.evaluate(()=>scrollTo({top:800,behavior:'smooth'}));await settleDocumentScroll(page);await page.evaluate(()=>scrollTo(0,0));await settleDocumentScroll(page,0);
  await assert.rejects(()=>normalizeCaptureContext(page,{...policy,preservedBranch:null}),/preserved independent branch/);
  await page.setContent('<div id="fake">Dismiss</div>');
  await assert.rejects(()=>normalizeCaptureContext(page,{...policy,dismissals:[{selector:'#fake',op:'click',waitMs:10}]}),/one actual button/);
  await page.setContent('<div id="fake" hidden>Dismiss</div>');
  await assert.rejects(()=>normalizeCaptureContext(page,{...policy,dismissals:[{selector:'#fake',op:'click',waitMs:1}]}),/one actual button/,'A hidden non-button must not become an optional absent context');
  await page.setContent('<button class="ambiguous">A</button><button class="ambiguous">B</button>');
  await assert.rejects(()=>normalizeCaptureContext(page,{...policy,dismissals:[{selector:'.ambiguous',op:'click',waitMs:10}]}),/strict mode violation/);
 }finally{await browser.close();}
});
