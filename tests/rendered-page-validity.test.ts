import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium} from 'playwright';
import {assertRenderedEvidencePage,renderedEvidenceRejection} from '../src/rendered-page-validity.js';

const normalStore=`<!doctype html><title>Contact LPPEPTIDE | LPPEPTIDE</title><header>LPPEPTIDE</header><main><h1>Contact LPPEPTIDE</h1><p>Contact our support team</p></main><footer>Shipping and returns</footer><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script><script>window.__CF$cv$params={r:'public-fixture',t:'fixture'};/* cf-chl- JS Detections */</script>`;

test('Cloudflare JS Detections markers in normal storefront scripts are not interstitial evidence',()=>{
 assert.equal(renderedEvidenceRejection({status:200,title:'Contact LPPEPTIDE | LPPEPTIDE',visibleText:'LPPEPTIDE Contact LPPEPTIDE Contact our support team Shipping and returns',html:normalStore}),null);
 for(const input of [{status:403,title:'Contact LPPEPTIDE'},{status:429,title:'Product'},{status:200,cfMitigated:'challenge',title:'Contact LPPEPTIDE'},{status:200,title:'Just a moment...'},{status:200,title:'Contact',visibleText:'Verify you are human'},{status:200,title:'Contact',challengeUiVisible:true},{status:200,title:'Rate limited',visibleText:'Error 1015'}])assert.ok(renderedEvidenceRejection(input),JSON.stringify(input));
});

test('real rendered storefront retains its CF scripts while visible/HTTP/header challenges remain rejected',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();let mode='store';
  await page.route('https://fixture.invalid/**',route=>{
   if(route.request().resourceType()==='script')return route.fulfill({status:200,contentType:'application/javascript',body:'/* normal Cloudflare JS Detections */'});
   const status=mode==='forbidden'?403:mode==='limited'?429:200;
   const headers:Record<string,string>=mode==='header'?{'cf-mitigated':'challenge'}:{};
   const body=mode==='ui'?'<title>Security</title><form id="challenge-form">Continue</form>':mode==='title'?'<title>Just a moment...</title><p>Checking your browser</p>':normalStore+'<iframe src="/cdn-cgi/challenge-platform/hidden-frame" style="display:none"></iframe>';
   if(route.request().url().endsWith('/hidden-frame'))return route.fulfill({status:200,contentType:'text/html',body:'<p>Hidden detection frame</p>'});
   return route.fulfill({status,headers,contentType:'text/html',body});
  });
  let response=await page.goto('https://fixture.invalid/contact');
  assert.equal((await assertRenderedEvidencePage(page,response,'source')).title,'Contact LPPEPTIDE | LPPEPTIDE');
  assert.equal(await page.locator('script[src*="challenge-platform"]').count(),1,'source DOM scripts were preserved');
  for(mode of ['ui','title','forbidden','limited','header']){
   response=await page.goto('https://fixture.invalid/contact');
   await assert.rejects(assertRenderedEvidencePage(page,response,'source'),/SOURCE_EVIDENCE_INVALID/,mode);
  }
 }finally{await browser.close();}
});
