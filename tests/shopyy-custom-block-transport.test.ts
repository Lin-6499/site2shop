import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {compileCustomBlock} from '../src/shopyy/custom-blocks.js';

test('component transport preserves paint outside the component while source document overflow remains document-owned',async()=>{
 const css='html,body{margin:0;overflow-x:hidden}.sample{position:relative;height:40px}.popup{position:absolute;left:10px;top:60px;width:100px;height:30px;background:rgb(0,120,80);box-shadow:0 4px 4px #0006}';
 const html='<section class="sample"><button class="popup" id="outside">Outside paint</button></section>';
 const compiled=compileCustomBlock({id:'paint-probe',html,css});
 const pages=new Map([['/source',`<style>${css}</style><div>${html}</div>`],['/transport',`<style>body{margin:0}</style>${compiled.html}`]]);
 const server=createServer((req,res)=>res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(pages.get(req.url!)));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${(server.address() as any).port}`,browser=await chromium.launch({headless:true});
 try{for(const width of [1440,768,375]){
  const context=await browser.newContext({viewport:{width,height:300}});
  try{const page=await context.newPage();const hits=[];
   for(const path of ['/source','/transport']){await page.goto(origin+path);hits.push(await page.evaluate(()=>document.elementFromPoint(20,70)?.id));}
   assert.deepEqual(hits,['outside','outside'],'A transport wrapper must not clip otherwise visible source popups or shadows');
  }finally{await context.close();}
 }}finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
});

test('runtime-created result geometry retains declared state styles while probes stay out of emitted markup',async()=>{
 const compiled=compileCustomBlock({id:'state-probe',html:'<section><div data-results></div></section>',css:'.result{height:44px;width:44px;overflow:hidden}.unused{color:red}',styleStatesHtml:['<a><div class="result"><img></div></a>']});
 assert.ok(!compiled.html.includes('<a>'),'State probes are compilation inputs, never hidden UI or duplicated results');
 assert.ok(!compiled.html.includes('.unused'));
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.setContent(`<div class="result" id="host-result">Host</div>${compiled.html}`);await page.locator('[data-results]').evaluate(n=>{n.innerHTML='<a><div class="result">Runtime result</div></a>';});const actual=await page.locator('#vr-block-state-probe .result').evaluate(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,overflow:getComputedStyle(n).overflow}));assert.deepEqual(actual,{width:44,height:44,overflow:'hidden'});assert.notEqual(await page.locator('#host-result').evaluate(n=>n.getBoundingClientRect().height),44);}finally{await browser.close();}
});

test('escaped arbitrary-variant ampersands preserve descendant specificity without leaking to host forms',async()=>{
 const css=String.raw`.mt-6{margin-top:24px}.max-w-md{max-width:448px}.\[\&_form\]\:mt-0 form{margin-top:0}.\[\&_form\]\:max-w-none form{max-width:none}`;
 const html='<section><div class="[&_form]:mt-0 [&_form]:max-w-none"><form class="mt-6 max-w-md"><input></form></div></section>';
 const compiled=compileCustomBlock({id:'variant-probe',html,css});
 const browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage();await page.setContent(`<style>form{margin-top:13px;max-width:101px}</style><div id="host" class="[&_form]:mt-0 [&_form]:max-w-none"><form class="mt-6 max-w-md"><input></form></div>${compiled.html}`);
  const observed=await page.locator('form').evaluateAll(nodes=>nodes.map(n=>({margin:getComputedStyle(n).marginTop,maxWidth:getComputedStyle(n).maxWidth})));
  assert.deepEqual(observed,[{margin:'13px',maxWidth:'101px'},{margin:'0px',maxWidth:'none'}]);
 }finally{await browser.close();}
});
