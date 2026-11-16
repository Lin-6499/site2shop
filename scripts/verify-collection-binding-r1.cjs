'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{chromium}=require('playwright');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 const root=path.resolve(process.argv[2]),out=path.join(root,'verification/collection-binding-r1');
 const report=JSON.parse(await fs.readFile(path.join(out,'local-report.json'))),dir=path.join(out,report.version);
 const m=JSON.parse(await fs.readFile(path.join(dir,'manifest.json'))),html=await fs.readFile(path.join(dir,'adapter.html'),'utf8');
 if(hash(html)!==m.component.sha256)throw Error('Adapter drift');
 const snapshot=JSON.parse(await fs.readFile(path.join(out,'actual-collection-public.json'))),rows=[];
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  for(const [device,viewport]of Object.entries({desktop:{width:1440,height:1000},tablet:{width:768,height:1024},mobile:{width:375,height:812}})){
   for(const state of ['empty','wrong-path','wrong-skin','duplicate-preview','duplicate-adapter','missing-grid','unknown-DTO','nonempty-defer']){
    const c=await browser.newContext({viewport}),p=await c.newPage(),requests=[],errors=[];
    try{
     const config=structuredClone(snapshot.collection);
     if(state==='unknown-DTO')delete config.products;
     if(state==='nonempty-defer'){config.products=[{id:6523798}];config.all_products_count=1;}
     const content=state==='nonempty-defer'?'<ul><li class="collection_item"><a data-product-id="6523798" href="/products/bpc-157">Native existing card</a></li></ul>':'<div class="mo-empty-des">No product</div>';
     const grid=state==='missing-grid'?'':'<div id="collection-product-warp">'+content+'</div>';
     const setup='window.events=[];window._GET_C_SETTING_=()=>('+JSON.stringify(config)+');window.originalSort=document.querySelector("#sort_by_select");window.originalGrid=document.querySelector("#collection-product-warp");window.originalGridHTML=window.originalGrid?.innerHTML;document.addEventListener("vr:collection-native-binding",e=>window.events.push(e.detail));';
     const fixture='<!doctype html><meta charset="utf-8"><main id="MainContent"><div id="block-section-13251221" data-section-type="collection_detail"><select id="sort_by_select"><option value="manual">Featured</option></select>'+grid+'</div></main><script>'+setup+'</script>'+html+(state==='duplicate-adapter'?'<template id="vr-collection-binding-r1"></template>':'');
     await c.route('**/*',r=>{requests.push({method:r.request().method(),navigation:r.request().isNavigationRequest()});return r.fulfill({contentType:'text/html',body:fixture});});
     p.on('pageerror',e=>errors.push(e.message));
     const url='https://pepsss.zenshop.cn'+(state==='wrong-path'?'/collections/other':'/collections/all')+'?theme_id='+(state==='wrong-skin'?'504458':'504457')+'&preview=1&is_theme_edit=1'+(state==='duplicate-preview'?'&preview=1':'');
     await p.goto(url);
     const actual=await p.evaluate(()=>({events:window.events,sortSame:window.originalSort===document.querySelector('#sort_by_select'),gridSame:window.originalGrid===document.querySelector('#collection-product-warp'),gridUnchanged:window.originalGridHTML===document.querySelector('#collection-product-warp')?.innerHTML}));
     const expected=state==='empty'?'empty-native-confirmed':state==='unknown-DTO'?'invalid':state==='nonempty-defer'?'nonempty-observation-required':null;
     rows.push({device,state,actual,errors,passed:(expected?actual.events.length===1&&actual.events[0].state===expected:actual.events.length===0)&&actual.sortSame&&actual.gridSame&&actual.gridUnchanged&&requests.length===1&&requests[0].method==='GET'&&!errors.length});
    }catch(e){rows.push({device,state,passed:false,error:String(e),errors});}finally{await c.close();}
   }
  }
 }finally{await browser.close();}
 const result={version:report.version,manifestSha256:hash(await fs.readFile(path.join(dir,'manifest.json'))),rows,passed:rows.length===24&&rows.every(r=>r.passed),scope:'browser-local native DTO observation only; no actual nonempty acceptance or network writes',published:false};
 const current=path.join(out,'browser-local-report.json');
 try{const prior=await fs.readFile(current);if(!JSON.parse(prior).passed)await fs.writeFile(path.join(out,'browser-local-failed-'+hash(prior).slice(0,12)+'.json'),prior);}catch(e){if(e.code!=='ENOENT')throw e;}
 await fs.writeFile(current,JSON.stringify(result,null,2));
 console.log(JSON.stringify({version:result.version,cases:rows.length,passed:result.passed,failed:rows.filter(r=>!r.passed)}));if(!result.passed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
