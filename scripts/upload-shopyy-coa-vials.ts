import {chromium} from 'playwright';
import {readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const state=process.argv[2];if(!state)throw Error('Authorized authentication state path required');
const root=resolve('../voidresearch-shopyy'),needsIndex=process.argv.indexOf('--needs'),outIndex=process.argv.indexOf('--out'),tag=outIndex>=0?process.argv[outIndex+1]:'coa-vial-uploads';
if(!/^[a-z0-9-]+$/.test(tag))throw Error('Invalid isolated asset batch name');
const out=join(root,'verification/incremental-draft-504457',tag),needsPath=needsIndex>=0?resolve(process.argv[needsIndex+1]):join(root,'verification/coa-directory-vial-upload-needs.json'),needsRaw=await readFile(needsPath,'utf8'),needs=JSON.parse(needsRaw);
needs.assets=(needs.assets||needs.rows||[]).map((a:any)=>({...a,file:resolve(a.absolutePath||a.file)}));
if(needs.target?.skinId!=='504457'||needs.target?.origin!=='https://pepsss.zenshop.cn'||!needs.assets.length||needs.assets.length>32||new Set(needs.assets.map((a:any)=>a.assetToken)).size!==needs.assets.length)throw Error('Target/list mismatch');
for(const a of needs.assets){const source=await readFile(a.file),metadata=await sharp(source).metadata();if(!a.file.toLowerCase().startsWith(join(root,'common/assets/images').toLowerCase())||source.length>10*1024*1024||createHash('sha256').update(source).digest('hex')!==a.sha256||!['jpeg','png','webp'].includes(metadata.format||'')||metadata.width!==a.width||metadata.height!==a.height)throw Error('Asset drift/path/MIME/dimensions mismatch');}
await mkdir(out,{recursive:true});
await writeFile(join(out,'needs.snapshot.json'),needsRaw);
const browser=await chromium.launch({channel:'chrome',headless:false});
const context=await browser.newContext({storageState:resolve(state),viewport:{width:1800,height:1200},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
context.setDefaultTimeout(7000);const page=await context.newPage();
try{
 await page.goto('https://pepsss.zenshop.cn/admin/card?theme_id=504457',{waitUntil:'domcontentloaded',timeout:25000});
 await page.locator('span[title="头部"]').waitFor({timeout:15000});
 await page.locator('span[title="头部"]').click();await page.waitForTimeout(1200);
 const label=page.getByText('pc端logo图片',{exact:true});
 await label.locator('..').locator('.upload-image-btn').click();
 const dialog=page.getByRole('dialog',{name:'插入图片',exact:true});await dialog.waitFor({state:'visible'});
 await page.waitForTimeout(2000);
 await dialog.locator('li.img-wrap').first().waitFor({state:'attached',timeout:20000});
 if(process.argv.includes('--observe-only')){
  console.log(await dialog.evaluate(e=>({inputs:[...e.querySelectorAll('input[type="text"]')].map(i=>({placeholder:(i as HTMLInputElement).placeholder,html:i.outerHTML})),rows:e.querySelectorAll('li.img-wrap').length,text:(e as HTMLElement).innerText.slice(-500)})));
  const observed=[];for(const a of needs.assets){const rows=dialog.locator('li.img-wrap').filter({has:page.getByText(basename(a.file),{exact:true})});observed.push({file:basename(a.file),count:await rows.count()});}console.log(JSON.stringify({existing:observed}));
 }else{
 const missing=[];
 for(const a of needs.assets)if(await dialog.getByText(basename(a.file),{exact:true}).count()===0)missing.push(a);
 if(missing.length){await dialog.locator('input[type="file"]').first().setInputFiles(missing.map(a=>a.file));console.log(JSON.stringify({event:'uploaded-via-material-library',count:missing.length}));}
 const rows=[];
 for(const a of needs.assets){
  const item=dialog.locator('li.img-wrap').filter({has:page.getByText(basename(a.file),{exact:true})});await item.waitFor({state:'attached',timeout:60000});
  await item.scrollIntoViewIfNeeded();
  let url='';
  for(let attempt=0;attempt<30;attempt++){
   url=await item.evaluate(row=>{if(row.querySelectorAll('img').length>1)throw Error('Ambiguous material row');return (row.querySelector('img') as HTMLImageElement|null)?.src||'';});
   if(url)break;await page.waitForTimeout(1000);
  }
  if(!url)throw Error('Uploaded filename exists but asset URL is unresolved');
  const hosted=new URL(url);if(hosted.hostname!=='ssl.ssl-images-feb.com')throw Error('Unexpected asset host');hosted.search='';
  rows.push({...a,targetUrl:hosted.href});
 }
 await copyFile(join(out,'candidates.json'),join(out,'candidates.before-row-scoped-readback.json')).catch(()=>{});
 await writeFile(join(out,'candidates.json'),JSON.stringify({target:needs.target,assets:rows,byteVerification:'pending',nativeLogoAssigned:false,published:false},null,2));
 await dialog.getByRole('button',{name:'取消',exact:true}).click();
 await page.screenshot({path:join(out,'material-library-closed.png')});console.log(JSON.stringify({event:'all-uploaded-url-bindings-observed',count:rows.length,nativeLogoAssigned:false,published:false}));
}}finally{await context.close();await browser.close();}

