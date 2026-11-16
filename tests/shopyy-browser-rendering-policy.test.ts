import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium} from 'playwright';
import {ownedHeadlessOptions,observeScrollbarEnvironment} from '../src/shopyy/browser-rendering-policy.js';

test('explicit owned headless scrollbar policy matches Windows classic content width only on overflowing pages',async()=>{
 assert.deepEqual(ownedHeadlessOptions({}),{headless:true});
 assert.deepEqual(ownedHeadlessOptions({workflow:{preserveClassicScrollbars:false}}),{headless:true});
 assert.deepEqual(ownedHeadlessOptions({workflow:{preserveClassicScrollbars:true}}),{headless:true,ignoreDefaultArgs:['--hide-scrollbars']});
 for(const preserve of [false,true]){
  const project={workflow:{preserveClassicScrollbars:preserve}},browser=await chromium.launch(ownedHeadlessOptions(project));
  try{
   const page=await browser.newPage({viewport:{width:800,height:600}});
   for(const long of [true,false]){
    await page.setContent(`<!doctype html><style>body{margin:0}main{height:${long?1800:100}px}</style><main>Rendering fixture</main>`);
    const actual=await observeScrollbarEnvironment(page,project,true);
    assert.equal(actual.innerWidth,800);assert.equal(actual.clientWidth,preserve&&long?785:800);assert.equal(actual.bodyWidth,preserve&&long?785:800);assert.equal(actual.verticalScrollbarWidth,preserve&&long?15:0);
    assert.equal(actual.policy,preserve?'owned-headless-preserve-classic-scrollbars':'owned-browser-defaults');
    assert.equal((await observeScrollbarEnvironment(page,project,false)).policy,'existing-browser-unchanged');
   }
  }finally{await browser.close();}
 }
});

test('owned browser channel is explicit and composes with classic scrollbar policy; defaults remain bundled',()=>{assert.deepEqual(ownedHeadlessOptions({}),{headless:true});assert.deepEqual(ownedHeadlessOptions({workflow:{ownedBrowserChannel:'chrome',preserveClassicScrollbars:true}}),{headless:true,channel:'chrome',ignoreDefaultArgs:['--hide-scrollbars']});assert.throws(()=>ownedHeadlessOptions({workflow:{ownedBrowserChannel:'other'}}as any),/Unsupported owned browser channel/);});
