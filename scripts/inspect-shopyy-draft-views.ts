import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const state=process.argv[2];if(!state)throw Error('Authorized state path required');
const out=resolve('../voidresearch-shopyy/verification/incremental-draft-504457/view-capabilities');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:false});
const context=await browser.newContext({storageState:resolve(state),viewport:{width:1600,height:1100},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
context.setDefaultTimeout(7000);const page=await context.newPage(),steps:any[]=[];
async function snapshot(name:string){
 const data=await page.locator('body').evaluate(b=>({text:b.innerText.slice(0,16000),inputs:[...b.querySelectorAll('input')].map(i=>({placeholder:i.placeholder,value:i.value,type:i.type})),links:[...b.querySelectorAll('a')].filter(a=>a.innerText.includes('管理')).map(a=>({text:a.innerText,href:a.getAttribute('href')}))}));
 await page.screenshot({path:join(out,name+'.png')});steps.push({name,...data});console.log(JSON.stringify({step:name,...data}));
}
try{
 await page.goto('https://pepsss.zenshop.cn/admin/card?theme_id=504457',{waitUntil:'domcontentloaded',timeout:25000});
 await page.locator('span[title="自定义"]').first().waitFor({timeout:15000});
 await page.locator('input[placeholder="请选择"]').first().click();await snapshot('page-options');
 const custom=page.getByText('自定义页面',{exact:true}).filter({visible:true});
 if(await custom.count()===1){await custom.click();await page.waitForTimeout(1500);await snapshot('content-page');}
 const view=page.getByText('默认视角',{exact:true}).filter({visible:true});
 if(await view.count()===1){await view.click();await snapshot('view-popover');
  const manage=page.getByText('点击管理',{exact:true}).filter({visible:true});
  if(await manage.count()===1){await manage.click();await snapshot('view-management');
   const create=page.getByText('新建视角',{exact:true}).filter({visible:true});
   if(await create.count()===1){await create.click();await snapshot('new-view-fields');}
  }
 }
}catch(error){steps.push({error:error instanceof Error?error.message:'Error'});console.log(JSON.stringify(steps.at(-1)));}
finally{await writeFile(join(out,'report.json'),JSON.stringify({target:{origin:'https://pepsss.zenshop.cn',skinId:'504457',role:'draft'},steps,remoteContentWrites:false,published:false},null,2));await context.close();await browser.close();}
