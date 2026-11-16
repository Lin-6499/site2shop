import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const {DraftEditor}=createRequire(import.meta.url)('./lib/shopyy-draft-editor.cjs');
const state=process.argv[2];if(!state)throw Error('Authorized state path required');
const target={origin:'https://pepsss.zenshop.cn',skinId:'504457',role:'draft',pageGroup:'自定义页面'};
const out=resolve('../voidresearch-shopyy/verification/incremental-draft-504457/content-group-before');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:false}),context=await browser.newContext({storageState:resolve(state),viewport:{width:1800,height:1200},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
context.setDefaultTimeout(7000);const page=await context.newPage(),editor=new DraftEditor(page,target);
try{
 await page.goto(target.origin+'/admin/card?theme_id=504457',{waitUntil:'domcontentloaded',timeout:25000});await editor.ensureGroup();
 await page.locator('span[title="自定义"]').first().waitFor({state:'visible',timeout:15000});
 const count=await page.locator('span[title="自定义"]').count(),blocks=[];
 for(let index=0;index<count;index++){const code=await editor.select(index);const file='block-'+index+'.html';await writeFile(join(out,file),code);blocks.push({index,file,characters:code.length,sha256:createHash('sha256').update(code).digest('hex'),root:code.match(/id="([^"]+)"/)?.[1]});}
 await writeFile(join(out,'report.json'),JSON.stringify({target,blocks,remoteContentWrites:false,published:false},null,2));console.log(JSON.stringify({target,blocks,remoteContentWrites:false,published:false}));
}finally{await context.close();await browser.close();}
