import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const state=process.argv[2];if(!state)throw Error('Authorized authentication state path required');
const out=resolve('../voidresearch-shopyy/verification/incremental-draft-504457/native-cart-three-device-recon');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:false}),rows:any[]=[];
try{for(const [device,viewport] of Object.entries({desktop:{width:1440,height:1000},tablet:{width:768,height:1024},mobile:{width:375,height:812}})){
 const context=await browser.newContext({storageState:resolve(state),viewport,locale:'en-US',timezoneId:'America/New_York'}),page=await context.newPage();context.setDefaultTimeout(7000);const row:any={device,network:[]};
 page.on('response',r=>{const u=new URL(r.url());if(u.origin==='https://pepsss.zenshop.cn'&&u.pathname==='/cart/mini')row.network.push({method:r.request().method(),path:u.pathname,status:r.status()});});
 try{
  await page.goto('https://pepsss.zenshop.cn/pages/Contact-Us?theme_id=504457&preview=1&is_theme_edit=1&device='+(device==='mobile'?'phone':'computer'),{waitUntil:'domcontentloaded',timeout:25000});await page.locator('#card-header a#cart_icon.cart_icon').filter({visible:true}).waitFor({timeout:15000});
  await page.locator('#card-header a#cart_icon.cart_icon').filter({visible:true}).click();await page.locator('.minicart.minicart_on').waitFor({state:'visible'});await page.locator('.minicart .minicart_mid').filter({hasText:/Shopping|Cart/}).waitFor();
  await page.waitForTimeout(400);row.open={visible:true,rect:await page.locator('.minicart.minicart_on').boundingBox(),text:await page.locator('.minicart.minicart_on').innerText()};await page.screenshot({path:join(out,device+'-open.png')});
  await page.keyboard.press('Escape');await page.waitForTimeout(350);row.escapeCloses=await page.locator('.minicart.minicart_on').count()===0;
  if(row.escapeCloses){await page.locator('#card-header a#cart_icon.cart_icon').click();await page.locator('.minicart.minicart_on').waitFor({state:'visible'});}
  await page.locator('.minicart.minicart_on .close_btn').click();await page.waitForTimeout(350);row.closeButtonCloses=await page.locator('.minicart.minicart_on').count()===0;await page.screenshot({path:join(out,device+'-closed.png')});
  row.completed=true;
 }catch(e){row.completed=false;row.error=e instanceof Error?e.message.slice(0,220):'Error';}
 finally{rows.push(row);console.log(JSON.stringify({device,completed:row.completed,escapeCloses:row.escapeCloses,closeButtonCloses:row.closeButtonCloses,error:row.error}));await context.close();}
}}finally{await browser.close();}
await writeFile(join(out,'report.json'),JSON.stringify({target:{origin:'https://pepsss.zenshop.cn',skinId:'504457',role:'draft'},kind:'native-platform-cart-entry-and-close-observations-before-owned-bridge',rows,sourceFidelityAccepted:false,addOrUpdateCart:false,orderSubmitted:false,published:false},null,2));
