import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

test('navigation runtime waits for later page-model and exact state templates in server block order',async()=>{
 const runtime=await readFile(resolve('../voidresearch-shopyy/common/scripts/home-runtime.js'),'utf8'),browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage();
  await page.setContent(`<!doctype html><body data-vr-mode="native" data-vr-block-mode="true"><div data-vr-storefront id="navigation-root"></div><script>${runtime}</script><section id="faq-0"><button>Observed question</button></section><script type="application/json" data-vr-public-page-model>{"disclosures":{"initialOpen":-1,"items":[{"index":0,"selector":"#faq-0"}]}}</script><template data-vr-disclosure-template="0-open"><section id="faq-0" data-vr-disclosure-index="0"><button>Observed question</button><p>Observed answer</p></section></template><template data-vr-disclosure-template="0-closed"><section id="faq-0" data-vr-disclosure-index="0"><button>Observed question</button></section></template></body>`);
  await page.getByRole('button',{name:'Observed question',exact:true}).click();
  assert.equal(await page.locator('#faq-0 p').count(),1,'A controller must read models appearing after its inline navigation script');
  assert.equal(await page.locator('#faq-0 p').textContent(),'Observed answer');
  await page.getByRole('button',{name:'Observed question',exact:true}).click();assert.equal(await page.locator('#faq-0 p').count(),0);
 }finally{await browser.close();}
});

test('declared COA template initialization materializes one shared grid and preserves filtering/reset across later chunks',async()=>{
 const runtime=await readFile(resolve('../voidresearch-shopyy/common/scripts/home-runtime.js'),'utf8'),browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage();const model={coa:{initializeFromTemplates:true,querySelector:'#coa-query',resultsSelector:'#coa-reports > .grid',gridClass:'grid gap-6',cards:[{title:'Alpha',search:'alpha',template:'alpha'},{title:'Beta',search:'beta',template:'beta'}]}};
  await page.setContent(`<!doctype html><body data-vr-mode="native" data-vr-block-mode="true"><div data-vr-storefront id="navigation-root"></div><script>${runtime}</script><section id="coa-reports"><input id="coa-query"><div class="grid gap-6"></div></section><div hidden><template data-vr-coa-template="alpha"><article>Alpha</article></template></div><div hidden><template data-vr-coa-template="beta"><article>Beta</article></template></div><script type="application/json" data-vr-public-page-model>${JSON.stringify(model)}</script></body>`);
  // The observed model uses the grid selector after each replacement; a stable class
  // is required rather than a disposable placeholder-only ID.
  await page.waitForFunction(()=>document.querySelectorAll('article').length===2);
  assert.deepEqual(await page.locator('article').allTextContents(),['Alpha','Beta']);
  await page.locator('#coa-query').fill('Beta');assert.deepEqual(await page.locator('article').allTextContents(),['Beta']);
  await page.locator('#coa-query').fill('');assert.deepEqual(await page.locator('article').allTextContents(),['Alpha','Beta']);
 }finally{await browser.close();}
});

