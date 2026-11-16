import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {renderFamilies} from '../src/shopyy/families.js';
import {saveArtifact,writeJson,jsonFile} from '../src/shopyy/artifacts.js';
import type {Plan} from '../src/shopyy/contracts.js';

// Isolated implementation regression using owned source inputs. This is not source fidelity or online acceptance.
test('owned SHOPYY home composer handles three-device menus, search reset/empty/results and cart without native fixture fallbacks',async()=>{
 const site=resolve('../voidresearch-shopyy'),root=await mkdtemp(join(tmpdir(),'shopyy-home-runtime-'));
 const assets=join(site,'common/assets/images/source-current'),assetIndex=await jsonFile(join(assets,'manifest.json'));
 const css=await readFile(join(assets,assetIndex.assets.find((a:any)=>a.kind==='stylesheet').file));
 const runtime=await readFile(join(site,'common/scripts/home-runtime.js'));
 let posts=0;
 const server=createServer();
 let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
 try{
  await cp(join(site,'staging/composers'),join(root,'partials'),{recursive:true});
  await mkdir(join(root,'templates'));await cp(join(site,'common/composers/home.htm'),join(root,'templates/home.htm'));
  const seed=await jsonFile(join(site,'common/content/search-fixture.json'));
  seed.products[0].title+='</script><img data-injected="true">';
  await writeJson(join(root,'data.json'),seed);
  const proposal=await jsonFile(join(site,'contracts/navigation-proposal.v2.json'));
  const routes=Object.fromEntries(proposal.rows.filter((r:any)=>r.targetPath).map((r:any)=>[r.sourcePath,{disposition:'unresolved',targetPath:r.targetPath}]));
  for(const key of ['/account','/account/partner','/track'])routes[key]={disposition:'unresolved',targetPath:'/account'};
  routes['/']={disposition:'mapped',targetPath:'/',family:'home'};
  const inventory=await saveArtifact(root,{schemaVersion:2,complete:false,routes});
  const names=['header','hero','trust-strip','researcher-picks','batch-testing','dispatch','lot-lookup','quality','assurance-newsletter','footer','mobile-menu','mobile-more','search-overlay','cart-empty','shipping-notice'];
  await writeJson(join(root,'families.json'),{schemaVersion:2,partials:Object.fromEntries(names.map(n=>[n,`partials/${n}.htm`])),families:{home:{templateFile:'templates/home.htm',nativeFile:'common/index.htm'}},pages:[{sourcePath:'/',targetPath:'/',family:'home',dataFile:'data.json'}]});
  const result=await renderFamilies(root,{siteId:'voidresearch',familiesFile:'families.json',shopyy:{assetRootExpression:'/native-assets',variableMap:{}}},{inventory} as Plan);
  const fixture=[...result.preview.values()][0],native=[...result.native.values()][0];
  assert.ok(fixture.includes('\\u003c/script\\u003e'));
  assert.ok(!fixture.includes('</script><img data-injected'));
  assert.ok(!native.includes('data-vr-catalog'));
  assert.ok(!native.includes('fixture-only-public-source-observations'));
  server.on('request',async(req,res)=>{
   if(req.method!=='GET'){posts++;res.writeHead(405).end();return;}
   const path=new URL(req.url!,'http://fixture').pathname;
   if(path==='/'){res.writeHead(200,{'Content-Type':'text/html'}).end(fixture);return;}
   if(path==='/native'){res.writeHead(200,{'Content-Type':'text/html'}).end(native);return;}
   if(path.endsWith('/styles/storefront-common.css')){res.writeHead(200,{'Content-Type':'text/css'}).end(css);return;}
   if(path.endsWith('/styles/page-contracts.css')){res.writeHead(200,{'Content-Type':'text/css'}).end('/* isolated unit fixture; not accepted presentation bindings */');return;}
   if(path.endsWith('/scripts/storefront-runtime.js')){res.writeHead(200,{'Content-Type':'application/javascript'}).end(runtime);return;}
   const name=path.split('/').pop()!;
   if(/^[a-f0-9]{64}\.(png|jpg|webp|avif|svg|gif)$/.test(name)){
    const bytes=await readFile(join(assets,name));const mime:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.avif':'image/avif','.webp':'image/webp','.svg':'image/svg+xml','.gif':'image/gif'};
    res.writeHead(200,{'Content-Type':mime[extname(name)]}).end(bytes);return;
   }
   res.writeHead(200,{'Content-Type':'text/html'}).end('<h1>Isolated navigation fixture</h1>');
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${(server.address() as any).port}`;
  browser=await chromium.launch({headless:true});
  for(const viewport of [{width:1440,height:1000},{width:768,height:1024},{width:375,height:812}]){
   const context=await browser.newContext({viewport}),page=await context.newPage();
   try{
    await page.goto(origin);await page.locator('[data-vr-storefront][data-initialized=true]').waitFor();
    assert.equal(await page.locator('[data-injected]').count(),0);
    assert.equal(await page.locator('#intl-waitlist-email').isVisible(),true);
    await page.locator('#intl-waitlist-email').fill('fixture@example.invalid');
    await page.locator('#intl-waitlist-email').press('Enter');
    assert.equal(posts,0);
    await page.getByRole('button',{name:'Dismiss shipping notice',exact:true}).press('Enter');
    assert.equal(await page.locator('#intl-waitlist-email').count(),0);
    if(viewport.width<1024){
     await page.getByRole('button',{name:'Toggle menu',exact:true}).click();
     const panel=page.locator('[data-vr-component=mobilePanel]');assert.equal(await panel.isVisible(),true);
     await panel.getByRole('button',{name:'More Void Research pages'}).click();
     assert.equal(await panel.getByRole('link',{name:'My Wishlist',exact:true}).isVisible(),true);
     await panel.getByRole('button',{name:'More Void Research pages'}).click();
     assert.equal(await panel.locator('[data-vr-mobile-more]').count(),0);
     await page.getByRole('button',{name:'Toggle menu',exact:true}).click();assert.equal(await panel.count(),0);
    }else{
     await page.getByRole('button',{name:'Shop by section'}).hover();
     await page.locator('[data-shop-section-menu=desktop]').getByRole('link',{name:'Peptides',exact:true}).waitFor({state:'visible',timeout:5000});
     assert.equal(await page.locator('[data-shop-section-menu=desktop]').getByRole('link',{name:'Peptides',exact:true}).isVisible(),true);
     await page.locator('h1').hover();
    }
    await page.getByRole('button',{name:'Search products',exact:true}).click();
    const overlay=page.locator('[data-vr-component=searchOverlay]'),input=overlay.locator('input');
    await input.fill('GHK');await page.waitForFunction(()=>document.querySelectorAll('[data-vr-component=searchOverlay] a').length===4);
    assert.match(await overlay.locator('a').first().innerText(),/GHK-CU\/KPV.*70 mg.*\$54\.99/s);
    await input.fill('');assert.match(await overlay.innerText(),/Start typing to search the catalog\./);assert.equal(await overlay.locator('[data-vr-search-all]').count(),0);
    await input.fill('zz-s2s-504457-no-match');assert.match(await overlay.innerText(),/No compounds match/);assert.equal(await overlay.locator('a').count(),0);
    await overlay.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await overlay.count(),0);
    await page.getByRole('button',{name:'Cart, 0 items',exact:true}).click();
    assert.match(await page.locator('[data-vr-component=cartPanel]').innerText(),/Your cart is empty/);
    await page.getByRole('button',{name:'Close cart',exact:true}).click();assert.equal(await page.locator('[data-vr-component=cartPanel]').count(),0);
    await page.getByRole('button',{name:'Scroll researcher picks right',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#researcher-picks')?.scrollLeft===284);
    await page.getByRole('button',{name:'Scroll researcher picks left',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#researcher-picks')?.scrollLeft===0);
    await page.getByRole('button',{name:'Search products',exact:true}).click();await page.locator('[data-vr-component=searchOverlay] input').fill('GHK');
    await page.getByRole('button',{name:'View all results',exact:true}).click();await page.waitForURL('**/collections/all?q=GHK');
   }finally{await context.close();}
  }
  const context=await browser.newContext(),page=await context.newPage();
  await page.goto(origin+'/native');
  await page.evaluate(()=>{(window as any).unbound=[];document.addEventListener('vr:unbound-capability',(e:any)=>(window as any).unbound.push(e.detail.capability));});
  await page.getByRole('button',{name:'Cart, 0 items',exact:true}).click();
  assert.equal(await page.locator('[data-vr-component=cartPanel]').count(),0);
  assert.deepEqual(await page.evaluate(()=>(window as any).unbound),['cart']);
  assert.equal(posts,0);await context.close();
 }finally{await browser?.close();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
