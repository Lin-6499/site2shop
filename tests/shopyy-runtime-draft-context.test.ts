import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
test('verified SHOPYY draft context follows only owned routes and leaves platform/external boundaries unchanged',async()=>{
 const runtime=await readFile(resolve('../voidresearch-shopyy/common/scripts/home-runtime.js'),'utf8'),browser=await chromium.launch({headless:true});
 const html=`<!doctype html><body data-vr-mode="native" data-vr-block-mode="true"><div id="vr-block-navigation" data-vr-storefront><a id="owned" href="/pages/about?tab=research#details">About</a><a id="account" href="/account/login?next=tracking">Account</a><a id="checkout" href="/checkout">Checkout</a><a id="cart" href="/cart">Cart</a><a id="external" href="https://example.com/reference">External</a><a id="download" href="/pages/report" download>Download</a><a id="fragment" href="#section">Section</a></div><a id="platform" href="/pages/native">Native link</a><script>${runtime}</script></body>`;
 try{for(const [url,active]of [['https://pepsss.zenshop.cn/?theme_id=504457&preview=1&is_theme_edit=1',true],['https://pepsss.zenshop.cn/?theme_id=504458&preview=1&is_theme_edit=1',false],['https://pepsss.zenshop.cn/?theme_id=504457&preview=1',false],['https://another-store.invalid/?theme_id=504457&preview=1&is_theme_edit=1',false],['https://pepsss.zenshop.cn/?theme_id=504457&theme_id=504458&preview=1&is_theme_edit=1',false]] as const){
  const context=await browser.newContext();try{await context.route('**/*',route=>route.fulfill({status:200,contentType:'text/html;charset=utf-8',body:html}));const page=await context.newPage();await page.goto(url);const href=await page.locator('#owned').getAttribute('href');
   if(active){const next=new URL(href!);assert.equal(next.origin,'https://pepsss.zenshop.cn');assert.equal(next.pathname,'/pages/about');assert.equal(next.searchParams.get('tab'),'research');assert.equal(next.hash,'#details');for(const[key,value]of Object.entries({theme_id:'504457',preview:'1',is_theme_edit:'1'}))assert.equal(next.searchParams.get(key),value);}else assert.equal(href,'/pages/about?tab=research#details');
   for(const [id,expected]of Object.entries({account:'/account/login?next=tracking',checkout:'/checkout',cart:'/cart',external:'https://example.com/reference',download:'/pages/report',fragment:'#section',platform:'/pages/native'}))assert.equal(await page.locator('#'+id).getAttribute('href'),expected);
   if(active){await page.locator('#vr-block-navigation').evaluate(n=>n.insertAdjacentHTML('beforeend','<a id="later" href="/products/later?variant=2">Later result</a>'));await page.locator('#later').click();await page.waitForURL(u=>u.pathname==='/products/later');const next=new URL(page.url());assert.equal(next.searchParams.get('variant'),'2');assert.equal(next.searchParams.get('is_theme_edit'),'1');assert.equal(next.searchParams.get('theme_id'),'504457');assert.equal(next.searchParams.get('preview'),'1');}
  }finally{await context.close();}
 }}finally{await browser.close();}
});
