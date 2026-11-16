import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {withShopyyDevelopmentServer} from '../scripts/lib/shopyy-development-server.js';

test('owned product and policy controllers retain combined selection semantics, history and no source submissions on three devices',async()=>{
 await withShopyyDevelopmentServer(resolve('../voidresearch-shopyy/shopyy.project.json'),async({origin})=>{
  const browser=await chromium.launch({headless:true});let external=0,mutations=0;
  try{
   for(const viewport of [{width:1440,height:1000},{width:768,height:1024},{width:375,height:812}]){
    const context=await browser.newContext({viewport});
    await context.route('**/*',route=>{
     if(new URL(route.request().url()).origin!==origin){external++;return route.abort();}
     if(route.request().method()!=='GET'){mutations++;return route.abort();}
     return route.continue();
    });
    try{
     const page=await context.newPage();await page.goto(origin+'/products/bpc-157');
     const hero=page.locator('[data-vr-storefront] > section:first-of-type');
     await page.getByRole('button',{name:'Dismiss shipping notice',exact:true}).press('Enter');
     const price=hero.locator('div.mt-4.flex.flex-wrap.items-baseline');
     assert.match(await price.innerText(),/\$39\.99/);
     await hero.getByRole('button',{name:/2 VIALS/}).click();
     assert.match(await price.innerText(),/\$37\.99/);
     assert.match(await hero.innerText(),/759 Coins/);
     await page.getByRole('button',{name:'Increase quantity',exact:true}).click();
     assert.match(await price.innerText(),/\$35\.99/);assert.match(await hero.innerText(),/759 Coins/);
     await page.getByRole('button',{name:'Decrease quantity',exact:true}).click();
     assert.match(await price.innerText(),/\$37\.99/);
     await hero.getByRole('button',{name:/^1 VIAL\s*standard/}).click();
     assert.match(await price.innerText(),/\$39\.99/);assert.match(await hero.innerText(),/399 Coins/);
     await page.getByRole('button',{name:'Decrease quantity',exact:true}).click();
     assert.equal(await hero.locator('div:has(> button[aria-label="Increase quantity"]) > span').innerText(),'1');
     await page.goto(origin+'/pages/policies?tab=research');
     await page.locator('#policy-tab-shipping').click();
     assert.equal(new URL(page.url()).search,'?tab=shipping');
     assert.match(await page.locator('#policy-panel').innerText(),/Order Processing/);
     await page.locator('#policy-tab-international').click();
     assert.equal(await page.locator('#policy-tab-international').getAttribute('aria-selected'),'true');
     assert.equal(await page.locator('[role=tab][aria-selected=true]').count(),1);
     await page.goBack();
     assert.equal(await page.locator('#policy-tab-shipping').getAttribute('aria-selected'),'true');
     assert.match(await page.locator('#policy-panel').innerText(),/Order Processing/);
     await page.goForward();
     assert.equal(await page.locator('#policy-tab-international').getAttribute('aria-selected'),'true');
     await page.reload();
     assert.equal(await page.locator('#policy-tab-international').getAttribute('aria-selected'),'true');
    }finally{await context.close();}
   }
   assert.equal(external,0,'Local rendering must not send requests to source or providers');
   assert.equal(mutations,0,'Read-only controller tests must not submit forms or commerce');
  }finally{await browser.close();}
 });
});
