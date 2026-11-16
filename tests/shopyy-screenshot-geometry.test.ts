import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {captureFullPagePreservingLayout} from '../src/shopyy/screenshot-geometry.js';

test('classic scrollbar full-page capture preserves original content width, scroll and inline styles; short pages remain unchanged',async()=>{
 const browser=await chromium.launch({headless:false});
 try{
  const page=await browser.newPage({viewport:{width:800,height:600}});
  for(const long of [true,false]){
   await page.setContent(`<!doctype html><html style="color-scheme:light;--fixture:kept"><style>html{background:white}body{margin:0}main{height:${long?1800:100}px;background:rgb(18,52,86)}header{height:20px;max-width:600px;margin:auto}</style><body><main><header>Fixture</header></main></body></html>`);
   if(long)await page.evaluate(()=>window.scrollTo(0,100));
   const before=await page.evaluate(()=>({innerWidth,clientWidth:document.documentElement.clientWidth,scrollHeight:document.documentElement.scrollHeight,scrollY,style:document.documentElement.getAttribute('style'),mainWidth:document.querySelector('main')!.getBoundingClientRect().width,headerX:document.querySelector('header')!.getBoundingClientRect().x}));
   if(long)assert.ok(before.innerWidth>before.clientWidth,'independent Windows headed fixture must have a real classic scrollbar');
   else assert.equal(before.innerWidth,before.clientWidth);
   const capture=await captureFullPagePreservingLayout(page);
   assert.equal(capture.environment.projection,long?'body-width-preservation':'none');
   const after=await page.evaluate(()=>({innerWidth,clientWidth:document.documentElement.clientWidth,scrollHeight:document.documentElement.scrollHeight,scrollY,style:document.documentElement.getAttribute('style'),mainWidth:document.querySelector('main')!.getBoundingClientRect().width,headerX:document.querySelector('header')!.getBoundingClientRect().x}));
   assert.deepEqual(after,before);
   const image=sharp(capture.image),metadata=await image.metadata();assert.equal(metadata.width,before.mainWidth);assert.equal(metadata.height,long?1800:600);
   const pixel=await sharp(capture.image).extract({left:before.mainWidth-1,top:50,width:1,height:1}).removeAlpha().raw().toBuffer();
   assert.deepEqual([...pixel],[18,52,86],'full-page image must preserve normal main width instead of expanding it into the gutter');
  }
 }finally{await browser.close();}
});

test('failed full-page screenshot restores capture-only gutter and preexisting scroll/style',async()=>{
 const browser=await chromium.launch({headless:false});
 try{
  const page=await browser.newPage({viewport:{width:800,height:600}});await page.setContent('<!doctype html><html style="--fixture:original"><style>body{height:1800px;margin:0}</style><body>Fixture</body></html>');await page.evaluate(()=>scrollTo(0,100));
  const before=await page.evaluate(()=>({style:document.documentElement.getAttribute('style'),width:document.documentElement.clientWidth,y:scrollY}));
  page.screenshot=async()=>{throw Error('fixture screenshot failure');};
  await assert.rejects(captureFullPagePreservingLayout(page),/fixture screenshot failure/);
  assert.deepEqual(await page.evaluate(()=>({style:document.documentElement.getAttribute('style'),width:document.documentElement.clientWidth,y:scrollY})),before);
 }finally{await browser.close();}
});

test('actual post-screenshot content geometry drift fails closed with phase and exact before/after measurements',async()=>{
 const browser=await chromium.launch({headless:false});
 try{
  const page=await browser.newPage({viewport:{width:800,height:600}});await page.setContent('<!doctype html><html style="--fixture:original"><style>body{height:1800px;margin:0}</style><body>Public fixture</body></html>');
  await page.waitForFunction(()=>innerWidth>document.documentElement.clientWidth);
  const originalStyle=await page.evaluate(()=>document.documentElement.getAttribute('style'));
  const screenshot=page.screenshot.bind(page);page.screenshot=async options=>{const image=await screenshot(options);await page.evaluate(()=>document.body.style.height='2200px');return image;};
  await assert.rejects(captureFullPagePreservingLayout(page),error=>{const detail=(error as any).sourceScreenshotGeometryDiagnostic;assert.match(String(error),/restore geometry differs/);assert.equal(detail.phase,'restore');assert.equal(detail.before.scrollHeight,1800);assert.equal(detail.actual.scrollHeight,2200);assert.ok(detail.differences.some((d:any)=>d.field==='scrollHeight'));return true;});
  assert.equal(await page.evaluate(()=>document.documentElement.getAttribute('style')),originalStyle,'capture-only root projection was restored despite source content drift');
 }finally{await browser.close();}
});

test('capture width projection preserves viewport-unit CSS instead of changing vw-based Home gallery padding',async()=>{
 const browser=await chromium.launch({headless:false});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.setContent('<!doctype html><style>body{margin:0}main{height:1800px;box-sizing:border-box;padding-inline:calc(max(24px,50vw - 617px))}aside{width:100vw;height:1px}</style><main><aside></aside>Public gallery fixture</main>');
  const measure=()=>page.evaluate(()=>({padding:getComputedStyle(document.querySelector('main')!).paddingLeft,vw:document.querySelector('aside')!.getBoundingClientRect().width,bodyWidth:document.body.getBoundingClientRect().width,bodyStyle:document.body.getAttribute('style')}));
  const before=await measure();assert.equal(before.padding,'103px');assert.equal(before.vw,1440);
  // This is the observed source failure: stable root gutter changes vw even though body width stays identical.
  await page.evaluate(()=>document.documentElement.style.scrollbarGutter='stable');assert.equal((await measure()).padding,'95.5px');await page.evaluate(()=>document.documentElement.style.removeProperty('scrollbar-gutter'));
  const screenshot=page.screenshot.bind(page);page.screenshot=async options=>{const projected=await measure();assert.equal(projected.padding,before.padding);assert.equal(projected.vw,before.vw);assert.equal(projected.bodyWidth,before.bodyWidth);return screenshot(options);};
  await captureFullPagePreservingLayout(page);assert.deepEqual(await measure(),before);
 }finally{await browser.close();}
});

test('installed Chrome156 full-page capture preserves three measured native grid gutters and actual offscreen content',async()=>{
 const browser=await chromium.launch({headless:false,channel:'chrome'});
 try{
  const page=await browser.newPage({viewport:{width:800,height:600}});await page.setContent('<!doctype html><style>body{margin:0;background:#123456}main{padding-top:700px}.rail{display:grid;grid-auto-flow:column;grid-auto-columns:224px;gap:14px;overflow-x:auto;scrollbar-width:thin;scrollbar-color:#d9bc59 #edf1f4;padding:2px 2px 13px}.rail::-webkit-scrollbar{height:6px}.shelf{padding:26px 0 30px}article{height:280px}#marker{height:100px;background:rgb(200,30,40)}</style><main>'+Array.from({length:3},()=>'<section class="shelf"><div class="rail">'+('<article>Public fixture</article>'.repeat(6))+'</div></section>').join('')+'<div id="marker">Real offscreen marker</div></main>');
  await page.waitForFunction(()=>document.querySelector('.rail')!.getBoundingClientRect().height>300);
  await page.locator('.rail').nth(1).evaluate(n=>{n.scrollLeft=60;});
  const measure=()=>page.evaluate(()=>({height:document.documentElement.scrollHeight,bodyStyle:document.body.style.cssText,scrollY,marker:document.querySelector('#marker')!.getBoundingClientRect().y+scrollY,rails:[...document.querySelectorAll<HTMLElement>('.rail')].map(n=>({height:n.getBoundingClientRect().height,clientHeight:n.clientHeight,scrollLeft:n.scrollLeft,style:n.style.cssText,children:[...n.children].map(c=>{const r=c.getBoundingClientRect();return{x:r.x,y:r.y+scrollY,width:r.width,height:r.height};})}))}));
  const before=await measure();assert.equal(before.rails.length,3);assert.ok(before.marker>600);
  const capture=await captureFullPagePreservingLayout(page);
  assert.deepEqual(await measure(),before,'real scrollbar height, child geometry, scroll and original styles must all be restored');
  assert.equal(capture.environment.nativeGridGutters.length,3);assert.ok(capture.environment.nativeGridGutters.every((r:any)=>r.childrenUnchanged&&r.originalGutter===10));
  const pixel=await sharp(capture.image).extract({left:200,top:Math.floor(before.marker)+50,width:1,height:1}).removeAlpha().raw().toBuffer();assert.deepEqual([...pixel],[200,30,40],'offscreen marker must be real captured pixels, not fallback background');
  assert.equal((await sharp(capture.image).metadata()).height,before.height);
 }finally{await browser.close();}
});

test('installed Chrome156 preserves the observed Matcha single-row flex thumbnail gutter at desktop/tablet; nonoverflow mobile stays untouched',async()=>{
 const browser=await chromium.launch({headless:false,channel:'chrome'});
 try{
  const page=await browser.newPage();
  for(const viewport of [{width:1440,height:1000},{width:768,height:1024},{width:390,height:844}]){
   await page.setViewportSize(viewport);
   await page.setContent('<!doctype html><style>body{margin:0;background:#123456}main{padding-top:100px}.gallery{width:420px;max-width:100%}.thumbs{scrollbar-width:thin;gap:8px;min-width:0;max-width:100%;padding:2px;display:flex;overflow-x:auto}.thumb:nth-child(odd){background:rgb(20,80,140)}.thumb:nth-child(even){background:rgb(200,50,30)}.thumb{flex:0 0 68px;width:68px;height:68px;padding:0;border:1px solid #d9e6eb;box-sizing:border-box}#spacer{height:1300px}#marker{height:100px;background:rgb(200,30,40)}@media(max-width:500px){.thumb{flex-basis:30px;width:30px;height:30px}}</style><main><section class="gallery"><div class="thumbs">'+'<button class="thumb">Image</button>'.repeat(7)+'</div></section><div id="spacer"></div><div id="marker">Actual offscreen marker</div></main>');
   await page.locator('.thumbs').evaluate(n=>{n.scrollLeft=40;});
   const measure=()=>page.evaluate(()=>{const n=document.querySelector<HTMLElement>('.thumbs')!,r=n.getBoundingClientRect();return{height:document.documentElement.scrollHeight,bodyStyle:document.body.style.cssText,scrollY,marker:document.querySelector('#marker')!.getBoundingClientRect().y+scrollY,rail:{height:r.height,clientHeight:n.clientHeight,scrollLeft:n.scrollLeft,style:n.style.cssText,children:[...n.children].map(c=>{const r=c.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})}};});
   const before=await measure(),capture=await captureFullPagePreservingLayout(page);
   const scrolledPixel=await sharp(capture.image).extract({left:50,top:110,width:1,height:1}).removeAlpha().raw().toBuffer();assert.deepEqual([...scrolledPixel],[200,50,30],'full-page pixels must show the original second scrolled tile, not reset-to-zero first tile');
   assert.deepEqual(await measure(),before,'native gutter, exact children, scroll and original styles restored');
   assert.equal(capture.environment.nativeGridGutters.length,viewport.width>500?1:0);
   if(viewport.width>500){const rail=capture.environment.nativeGridGutters[0];assert.equal(rail.layout,'flex-row');assert.equal(rail.originalGutter,10);assert.ok(rail.childrenUnchanged&&rail.restoredChildrenUnchanged);}
   const pixel=await sharp(capture.image).extract({left:200,top:Math.floor(before.marker)+50,width:1,height:1}).removeAlpha().raw().toBuffer();assert.deepEqual([...pixel],[200,30,40]);
   assert.equal((await sharp(capture.image).metadata()).height,before.height);
  }
 }finally{await browser.close();}
});

test('installed Chrome156 restores nonzero flex scroll and original child styles after screenshot failure',async()=>{
 const browser=await chromium.launch({headless:false,channel:'chrome'});try{const page=await browser.newPage({viewport:{width:800,height:600}});await page.setContent('<!doctype html><style>body{margin:0;height:1800px}.rail{display:flex;overflow-x:auto;scrollbar-width:thin;width:420px;padding:2px}.tile{flex:0 0 68px;height:68px}</style><div class="rail">'+'<div class="tile" style="color:red">Public tile</div>'.repeat(7)+'</div>');await page.locator('.rail').evaluate(n=>{n.scrollLeft=60;});const measure=()=>page.evaluate(()=>({height:document.documentElement.scrollHeight,nodes:[...document.querySelectorAll('.rail,.tile')].map(n=>({tag:n.tagName,classes:n.className,style:(n as HTMLElement).style.cssText})),left:document.querySelector('.rail')!.scrollLeft}));const before=await measure();page.screenshot=async()=>{throw Error('fixture screenshot failure');};await assert.rejects(captureFullPagePreservingLayout(page),/fixture screenshot failure/);assert.deepEqual(await measure(),before);}finally{await browser.close();}
});

test('installed Chrome156 preserves actual auto-height detail-tabs flex buttons when the native gutter disappears',async()=>{
 const browser=await chromium.launch({headless:false,channel:'chrome'});try{const page=await browser.newPage({viewport:{width:768,height:1024}});await page.setContent('<!doctype html><style>body{margin:0}.detail-tabs{width:400px;background:#fff;border:1px solid #d7e1eb;border-bottom:0;border-radius:8px 8px 0 0;display:flex;overflow-x:auto}.detail-tabs button{color:#40566f;background:none;border:0;border-bottom:3px solid transparent;flex:none;align-items:center;min-height:48px;padding:0 20px;font-size:12px;font-weight:900;display:inline-flex}#spacer{height:1500px}#marker{height:100px;background:rgb(200,30,40)}</style><nav class="detail-tabs">'+['Detailed Information','Storage Conditions','Available Warehouses','Related Research'].map(t=>'<button>'+t+'</button>').join('')+'</nav><div id="spacer"></div><div id="marker"></div>');await page.locator('.detail-tabs').evaluate(n=>{n.scrollLeft=70;});const measure=()=>page.evaluate(()=>({height:document.documentElement.scrollHeight,marker:document.querySelector('#marker')!.getBoundingClientRect().y,scrollLeft:document.querySelector('.detail-tabs')!.scrollLeft,buttons:[...document.querySelectorAll('button')].map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,style:n.style.cssText};})}));const before=await measure(),capture=await captureFullPagePreservingLayout(page);assert.deepEqual(await measure(),before);assert.ok(capture.environment.nativeGridGutters[0].childrenUnchanged);const pixel=await sharp(capture.image).extract({left:200,top:Math.floor(before.marker)+50,width:1,height:1}).removeAlpha().raw().toBuffer();assert.deepEqual([...pixel],[200,30,40]);}finally{await browser.close();}
});

test('installed Chrome156 detects long body extent when documentElement reports viewport height and preserves its native detail-tab gutter',async()=>{
 const browser=await chromium.launch({headless:false,channel:'chrome'});try{const page=await browser.newPage({viewport:{width:390,height:844}});await page.setContent('<!doctype html><html><style>body{margin:0;position:fixed;top:0;width:100%}.detail-tabs{display:flex;overflow-x:auto;border:1px solid #ddd;border-bottom:0}.detail-tabs button{flex:none;min-height:48px;display:inline-flex;align-items:center;padding:0 20px;border:0;border-bottom:3px solid transparent}#spacer{height:1800px}#marker{height:100px;background:rgb(200,30,40)}</style><body><nav class="detail-tabs">'+['Overview','Research','Dosing & Protocol','Side Effects','COA & Testing'].map(t=>'<button>'+t+'</button>').join('')+'</nav><div id="spacer"></div><div id="marker"></div></body></html>');const measure=()=>page.evaluate(()=>({mode:document.compatMode,documentHeight:document.documentElement.scrollHeight,bodyHeight:document.body.getBoundingClientRect().height,bodyScrollHeight:document.body.scrollHeight,navHeight:document.querySelector('.detail-tabs')!.getBoundingClientRect().height,marker:document.querySelector('#marker')!.getBoundingClientRect().y}));const before=await measure();assert.equal(before.documentHeight,844);assert.ok(before.bodyScrollHeight>844,'real long body must not be mistaken for a short page');const capture=await captureFullPagePreservingLayout(page);assert.equal(capture.environment.nativeGridGutters.length,1);assert.equal(capture.environment.nativeGridGutters[0].originalGutter,15);assert.deepEqual(await measure(),before);assert.equal((await sharp(capture.image).metadata()).height,before.bodyScrollHeight);const pixel=await sharp(capture.image).extract({left:200,top:Math.floor(before.marker)+50,width:1,height:1}).removeAlpha().raw().toBuffer();assert.deepEqual([...pixel],[200,30,40]);}finally{await browser.close();}
});

test('installed Chrome156 preserves the measured nested country-list vertical gutter, option geometry and focus through full-page capture',async()=>{
 const browser=await chromium.launch({headless:false,channel:'chrome'});try{const page=await browser.newPage({viewport:{width:800,height:600}});await page.setContent('<!doctype html><style>body{margin:0;height:1800px}#country{position:absolute;top:40px;left:20px;width:294px}#popup{position:absolute;top:40px;width:294px;height:240px;box-sizing:border-box;padding:4px;border:1px solid #ddd;overflow:auto;background:white}#popup button{display:block;width:100%;height:40px;border:0;background:rgb(20,80,140)}#marker{position:absolute;top:1500px;width:100%;height:100px;background:rgb(200,30,40)}</style><div id="country"><input id="input" role="combobox" value=""><div id="popup" role="listbox">'+'<button role="option">Public country</button>'.repeat(40)+'</div></div><div id="marker"></div>');await page.locator('#input').focus();await page.locator('#popup').evaluate(n=>{n.scrollTop=40;});const measure=()=>page.evaluate(()=>{const n=document.querySelector<HTMLElement>('#popup')!,r=n.getBoundingClientRect();return{width:r.width,height:r.height,clientWidth:n.clientWidth,scrollWidth:n.scrollWidth,scrollTop:n.scrollTop,style:n.style.cssText,focus:document.activeElement!.id,value:(document.querySelector('#input')as HTMLInputElement).value,children:[...n.children].map(c=>{const r=c.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})};});const before=await measure();assert.equal(before.clientWidth,277);const capture=await captureFullPagePreservingLayout(page);assert.deepEqual(await measure(),before);assert.equal(capture.environment.nativeVerticalGutters.length,1);assert.equal(capture.environment.nativeVerticalGutters[0].clientWidth,277);assert.ok(capture.environment.nativeVerticalGutters[0].childrenUnchanged);const pixel=await sharp(capture.image).extract({left:200,top:1550,width:1,height:1}).removeAlpha().raw().toBuffer();assert.deepEqual([...pixel],[200,30,40]);
 }finally{await browser.close();}
});
