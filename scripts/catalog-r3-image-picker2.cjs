const fs=require('node:fs/promises'),path=require('node:path'),{chromium}=require('playwright');
(async()=>{
 const out=path.resolve('../voidresearch-shopyy/verification/catalog-import-r1/batches/r3-catalog-batch01-variants-66560ff56087/official-import');
 const b=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const c=await b.newContext({storageState:'D:/Documents/deepseek-harness/默认工作区/shopyy-login/zenshop-state.json'}),p=await c.newPage();
  await p.goto('https://pepsss.zenshop.cn/admin/products/edit/6527469',{waitUntil:'domcontentloaded'});
  const row=p.locator('tbody tr').filter({has:p.locator('[data-col-key="style"]',{hasText:'10 mg'})});
  await row.waitFor({state:'visible',timeout:15000});if(await row.count()!==1)throw Error('10mg unique row required');
  await p.getByText('添加图片或视频',{exact:true}).click();
  await p.getByRole('dialog',{name:'插入图片'}).filter({visible:true}).getByRole('tab',{name:'商品图片',exact:true}).click();
  await p.waitForTimeout(500);
  await fs.writeFile(path.join(out,'variant-image-picker.html'),await p.content());
  console.log((await p.locator('body').innerText()).slice(-5000));
  console.log(await p.locator('input[type="file"]').evaluateAll(es=>es.map(e=>({type:e.type,accept:e.accept,html:e.outerHTML}))));
  await p.screenshot({path:path.join(out,'variant-image-picker.png'),caret:'initial'});
 }finally{await b.close();}
})();
