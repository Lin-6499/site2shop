import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { discover } from '../src/shopyy/discovery.js';
import { collectSourceAssets } from '../src/shopyy/source-assets.js';
import { safeBrowserError } from '../src/shopyy/artifacts.js';
import { prepareComposerInputs } from '../src/shopyy/composer-inputs.js';

test('browser error evidence omits request-header call logs',()=>{
  assert.equal(safeBrowserError(new Error('Timeout 30000ms exceeded.\nCall log:\n - cookie: secret-session')),'Error: Timeout 30000ms exceeded.');
});

test('unknown source redirects fail; an explicitly observed alias resumes only the missing route and preserves the failed attempt',async()=>{
  const root=await mkdtemp(join(tmpdir(),'shopyy-redirect-'));
  const server=createServer((req,res)=>{
    if(req.url==='/sitemap.xml'){res.writeHead(404).end();return;}
    if(req.url==='/alias'){res.writeHead(302,{Location:'/'}).end();return;}
    res.writeHead(200,{'Content-Type':'text/html'}).end('<h1>Catalog</h1><a href="/alias">Alias</a>');
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const sourceUrl=`http://127.0.0.1:${(server.address() as any).port}`,file=join(root,'project.json');
  try{
    await writeFile(file,JSON.stringify({sourceUrl}));
    await discover(file,5);
    const failed=JSON.parse(await readFile(join(root,'contracts/route-inventory.v2.json'),'utf8'));
    assert.equal(failed.sources.filter((s:any)=>s.status==='failed').length,3);
    await writeFile(file,JSON.stringify({sourceUrl,workflow:{discoveryAliases:{'/alias':'/'}}}));
    await discover(file,5,true);
    const repaired=JSON.parse(await readFile(join(root,'contracts/route-inventory.v2.json'),'utf8'));
    assert.equal(repaired.sources.filter((s:any)=>s.status==='failed').length,0);
    assert.equal(repaired.coverage.surfaces.length,6);
    assert.equal(repaired.complete,false);
    const alias=repaired.coverage.surfaces.find((s:any)=>s.path==='/alias');
    const data=JSON.parse(await readFile(join(root,alias.evidence.path),'utf8'));
    assert.equal(data.expectedRedirect,'/');assert.equal(data.url,sourceUrl+'/');
    const {readdir}=await import('node:fs/promises');
    const records=await Promise.all((await readdir(join(root,'artifacts'))).filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await readFile(join(root,'artifacts',f),'utf8'))));
    assert.ok(records.some(r=>r.kind==='previous-discovery-attempt-not-acceptance'));
  }finally{await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});

test('discovery captures real three-device structure, strips scripts/values and does not traverse account boundaries', async () => {
  const root=await mkdtemp(join(tmpdir(),'shopyy-discovery-'));
  let accountRequests=0;
  const server=createServer((req,res)=>{
    if(req.url?.startsWith('/account'))accountRequests++;
    if(req.url==='/sitemap.xml'){res.writeHead(404).end();return;}
    if(req.url==='/fixture.css'){res.writeHead(200,{'Content-Type':'text/css'}).end('h1{color:blue}');return;}
    if(req.url==='/fixture.svg'){res.writeHead(200,{'Content-Type':'image/svg+xml'}).end('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8" fill="blue"/></svg>');return;}
    res.writeHead(200,{'Content-Type':'text/html'}).end('<html><head><link rel="stylesheet" href="/fixture.css"></head><body><h1>Fixture catalog</h1><a href="/account">Account</a><a href="/account/orders">Orders</a><picture><source type="image/svg+xml" srcset="/fixture.svg"><img src="/missing-fallback.webp" alt="fixture-media" width="20" height="20"></picture><input value="private-value"><textarea>private-value</textarea><form action="/subscribe"><button onclick="alert(1)">Subscribe</button></form><script>/* not deliverable */</script></body></html>');
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const file=join(root,'project.json');
    await writeFile(file,JSON.stringify({sourceUrl:origin,assetsDirectory:'assets',workflow:{discoveryBoundaries:[{path:'/account',includeDescendants:true,rationale:'Personal account online boundary'}]}}));
    await discover(file,5);
    const inventory=JSON.parse(await readFile(join(root,'contracts/route-inventory.v2.json'),'utf8'));
    assert.equal(accountRequests,0);
    assert.equal(inventory.complete,false);
    assert.equal(inventory.routes['/account/orders'].disposition,'deferred-online');
    assert.ok(inventory.routes['/account/orders'].evidence.sha256);
    assert.equal(inventory.coverage.surfaces.length,3);
    for(const surface of inventory.coverage.surfaces){
      const data=JSON.parse(await readFile(join(root,surface.evidence.path),'utf8'));
      assert.equal(data.viewportSize.width,{desktop:1440,tablet:768,mobile:375}[surface.viewport as 'desktop']);
      assert.match(data.structure,/Fixture catalog/);
      assert.doesNotMatch(data.structure,/private-value|<script/);
    }
    const continued=await discover(file,5,true);
    assert.equal(continued.visited,1);
    const resumed=JSON.parse(await readFile(join(root,'contracts/route-inventory.v2.json'),'utf8'));
    assert.deepEqual(resumed.coverage.surfaces,inventory.coverage.surfaces);
    const {mkdir}=await import('node:fs/promises');await mkdir(join(root,'assets'));
    const copied=await collectSourceAssets(file);
    assert.equal(copied.downloaded,2);
    assert.equal(copied.passed,true);
    const manifest=JSON.parse(await readFile(join(copied.directory,'manifest.json'),'utf8'));
    const style=manifest.assets.find((a:any)=>a.kind==='stylesheet');
    assert.equal(style.contentType,'text/css');
    assert.equal(await readFile(join(copied.directory,style.file),'utf8'),'h1{color:blue}');
    await writeFile(join(root,'recipe.json'),JSON.stringify({schemaVersion:2,sourcePath:'/',fragments:[{id:'body',selector:'body',observation:inventory.coverage.surfaces[0].evidence}]}));
    const prepared=await prepareComposerInputs(file,'recipe.json');
    const fragment=await readFile(join(prepared.directory,'body.htm'),'utf8');
    assert.match(fragment,/\{\{route:\/account\}\}/);
    assert.doesNotMatch(fragment,/onclick|action=|<script|private-value/);
    assert.doesNotMatch(fragment,/missing-fallback|<source/);
    assert.match(fragment,/\{\{asset:images\/source-current\/[a-f0-9]+\.svg\}\}/);
    assert.equal(prepared.status,'prepared-inputs-not-build-or-acceptance');
  } finally {
    await new Promise<void>(r=>server.close(()=>r()));
    await rm(root,{recursive:true,force:true});
  }
});
import {chromium} from 'playwright';
import {navigateDiscoveryPage,sourceRateLimited} from '../src/shopyy/discovery.js';

test('discovery uses an existing visible real anchor, uses goto only for absent links',async()=>{
 const server=createServer((req,res)=>res.writeHead(200,{'Content-Type':'text/html'}).end(req.url==='/'?'<h1>Home</h1><a hidden href="/faq">Hidden</a><a href="/faq" onclick="window.name=\'observed-anchor-clicked\'">FAQ</a>':'<h1>FAQ</h1>'));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${(server.address() as any).port}`,browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  assert.equal((await navigateDiscoveryPage(page,origin+'/'))?.status(),200);
  assert.equal((await navigateDiscoveryPage(page,origin+'/faq'))?.status(),200);
  assert.equal(await page.evaluate(()=>window.name),'observed-anchor-clicked');
  assert.equal(page.url(),origin+'/faq');
  assert.equal((await navigateDiscoveryPage(page,origin+'/faq'))?.status(),200);
  assert.equal((await navigateDiscoveryPage(page,origin+'/unlinked'))?.status(),200);
  assert.equal(page.url(),origin+'/unlinked');
 }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
});

test('HTTP429 and Cloudflare Error1015 stop route traversal and preserve uncaptured pending routes',async()=>{
 assert.equal(sourceRateLimited(200,'Error 1015 You are being rate limited'),true);
 assert.equal(sourceRateLimited(200,'Ordinary storefront'),false);
 for(const status of [429,200]){
  const root=await mkdtemp(join(tmpdir(),'shopyy-rate-limit-'));let documents=0;
  const server=createServer((req,res)=>{
   if(req.url==='/sitemap.xml'){res.writeHead(404).end();return;}
   if(req.url==='/favicon.ico'){res.writeHead(404).end();return;}
   documents++;res.writeHead(status,{'Content-Type':'text/html'}).end('<title>Rate limited</title><h1>Error 1015</h1><p>You are being rate limited</p>');
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${(server.address() as any).port}`;
  try{
   const file=join(root,'project.json');await writeFile(file,JSON.stringify({sourceUrl:origin,workflow:{discoverySeeds:['/later'],discoveryNetworkIdleMs:1}}));
   await discover(file,5);
   const inventory=JSON.parse(await readFile(join(root,'contracts/route-inventory.v2.json'),'utf8'));
   const analysis=JSON.parse(await readFile(join(root,'contracts/site-analysis.json'),'utf8'));
   assert.equal(documents,1);assert.equal(inventory.coverage.surfaces.length,0);assert.equal(inventory.complete,false);
   assert.equal(analysis.stoppedReason,'source-rate-limit');assert.equal(analysis.crawlComplete,false);assert.deepEqual(analysis.pending,['/','/later']);
  }finally{await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
 }
});
