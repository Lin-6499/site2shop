import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { sourceProfile, sourceStorage,sourceStorageCurrent,isSourceSessionRefresh,assertSourceUnblocked } from '../src/shopyy/source-session.js';

test('cached source session expiry is checked again at each viewport boundary without exposing its values',()=>{
 const project={sourceUrl:'https://source.invalid/',workflow:{sourceSession:{enabled:true,sessionStorageKey:'sb-fixture-auth-token'}}};
 const state=(expires_at:number,origin='https://source.invalid')=>({cookies:[],origins:[{origin,localStorage:[{name:'sb-fixture-auth-token',value:JSON.stringify({access_token:'isolated-fixture',refresh_token:'isolated-fixture',expires_at})}]}]});
 assert.equal(sourceStorageCurrent(project,state(120),0),true);
 assert.equal(sourceStorageCurrent(project,state(120),60000),false);
 assert.equal(sourceStorageCurrent(project,state(120,'https://other.invalid'),0),false);
 assert.equal(sourceStorageCurrent(project,undefined,0),false);
 assert.equal(sourceStorageCurrent({sourceUrl:'http://local',workflow:{sourceSession:{enabled:false}}},undefined,0),true);
});

test('source session maintenance admits only declared HTTPS refresh-token renewal',()=>{
 const project={sourceUrl:'https://source.invalid',workflow:{sourceSession:{enabled:true,refreshOrigins:['https://auth.supabase.co']}}};
 const url='https://auth.supabase.co/auth/v1/token?grant_type=refresh_token';
 assert.equal(isSourceSessionRefresh('POST',url,project),true);
 for(const u of [url.replace('https:','http:'),url.replace('auth.supabase.co','other.supabase.co'),url.replace('refresh_token','password'),url+'&token=must-not-admit',url.replace('/auth/v1/token','/rest/v1/orders')])assert.equal(isSourceSessionRefresh('POST',u,project),false);
 assert.equal(isSourceSessionRefresh('GET',url,project),false);
 assert.equal(isSourceSessionRefresh('POST',url,{sourceUrl:'https://source.invalid'}),false);
});

test('dedicated source session retains manual login across real viewport contexts; clean target stays anonymous', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shopyy-session-'));
  let gated=false,slowAsset=false;
  const server = createServer((req, res) => {
    if(req.url==='/slow-image'){res.writeHead(200,{'Content-Type':'image/png'});res.write(Buffer.from([137,80,78,71]));return;}
    res.writeHead(200, {'Content-Type':'text/html'}).end(
      (req.headers.cookie?.includes('fixture-session=authorized') ? '<header><a href="/shop">Shipping update</a><a href="/shop">Shop All</a></header><h1>Catalog</h1>' : '<h1>Sign in</h1>')+(gated?'<div role="dialog">Personal verification</div>':'')+(slowAsset?'<img src="/slow-image" alt="Pending image">':'')
    );
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const project = {sourceUrl:origin, workflow:{sourceSession:{enabled:true,readySelector:'header a[href="/shop"]'}}};
  const profile = sourceProfile(project, root);
  try {
    await assert.rejects(sourceStorage(project, root), /Source login session missing/);
    await mkdir(profile.directory, {recursive:true});
    await writeFile(join(profile.directory, 'source-session.json'), JSON.stringify({origin}));
    const seeded = await chromium.launchPersistentContext(profile.directory, {headless:true});
    try {
      await seeded.addCookies([{name:'fixture-session', value:'authorized', url:origin, expires:Math.floor(Date.now()/1000)+3600}]);
      await seeded.addCookies([{name:'unrelated-provider',value:'must-not-export',url:'https://other.invalid',expires:Math.floor(Date.now()/1000)+3600}]);
      const page = seeded.pages()[0];
      await page.goto(origin);
      await page.evaluate(() => localStorage.setItem('fixture-preference', 'retained'));
    } finally { await seeded.close(); }
    const storageState = await sourceStorage(project, root);
    assert.ok(!storageState?.cookies.some(c=>c.name==='unrelated-provider'));
    const browser = await chromium.launch({headless:true});
    try {
      for (const viewport of [{width:1440,height:1000},{width:768,height:1024},{width:375,height:812}]) {
        const context = await browser.newContext({storageState, viewport});
        const page = await context.newPage();
        await page.goto(origin);
        assert.equal(await page.locator('h1').innerText(), 'Catalog');
        assert.deepEqual(await page.evaluate(() => ({width:innerWidth,height:innerHeight})), viewport);
        assert.equal(await page.evaluate(() => localStorage.getItem('fixture-preference')), 'retained');
        await context.close();
      }
      const target = await browser.newContext();
      const page = await target.newPage();
      await page.goto(origin);
      assert.equal(await page.locator('h1').innerText(), 'Sign in');
      const currentProject={sourceUrl:origin,workflow:{sourceSession:{enabled:true,sessionStorageKey:'sb-fixture-auth-token'}}};
      await page.evaluate(()=>localStorage.setItem('sb-fixture-auth-token',JSON.stringify({expires_at:1})));
      await assert.rejects(assertSourceUnblocked(page,currentProject),/session expired/);
      await page.evaluate(()=>localStorage.setItem('sb-fixture-auth-token',JSON.stringify({access_token:'fixture-only-access',refresh_token:'fixture-only-refresh',expires_at:Math.floor(Date.now()/1000)+3600})));
      await assertSourceUnblocked(page,currentProject);
      await target.close();
    } finally { await browser.close(); }
    gated=true;
    await assert.rejects(sourceStorage({...project,workflow:{sourceSession:{enabled:true,blockedSelectors:['[role=dialog]']}}},root),/human must complete/);
    gated=false;
    slowAsset=true;
    const started=Date.now();
    assert.ok((await sourceStorage(project,root))?.cookies.some(c=>c.name==='fixture-session'));
    assert.ok(Date.now()-started<10000,'A pending image must not block extraction of an already logged-in origin');
    slowAsset=false;
    await writeFile(join(profile.directory, 'source-session.json'), JSON.stringify({origin:'https://other.invalid'}));
    await assert.rejects(sourceStorage(project, root), /another origin/);
    assert.equal(await sourceStorage({sourceUrl:origin}, root), undefined);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
    await rm(root, {recursive:true,force:true});
  }
});
