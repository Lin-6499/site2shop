'use strict';
const {chromium}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path');
(async()=>{const b=await chromium.launch({channel:'chrome',headless:true});try{
const c=await b.newContext({storageState:'D:/Documents/deepseek-harness/默认工作区/shopyy-login/zenshop-state.json'}),p=await c.newPage();
await p.goto('https://pepsss.zenshop.cn/admin/card?theme_id=504457',{waitUntil:'domcontentloaded',timeout:25000});
await p.locator('span[title="头部"]').waitFor();await p.waitForTimeout(1300);
await p.locator('input[placeholder="请选择"]').first().click();await p.locator('.el-select-dropdown__item').filter({hasText:/^专辑详情$/}).filter({visible:true}).click();
const d=p.getByRole('dialog').filter({visible:true});await d.waitFor();
await d.locator('input[type="radio"]').waitFor({timeout:20000});
const evidence={capturedAt:new Date().toISOString(),url:p.url(),text:await d.innerText(),html:await d.evaluate(n=>n.outerHTML),rows:await d.locator('tr').evaluateAll(es=>es.map(e=>({text:e.innerText,html:e.outerHTML}))),inputs:await d.locator('input').evaluateAll(es=>es.map(e=>({type:e.type,value:e.value,checked:e.checked,parent:e.parentElement.outerHTML}))),remoteSave:false};
const out=path.resolve('../voidresearch-shopyy/verification/collection-native-initial-r1/picker-readonly.json');await fs.writeFile(out,JSON.stringify(evidence,null,2));console.log(JSON.stringify({file:out,text:evidence.text,rows:evidence.rows.map(e=>e.text),inputs:evidence.inputs.map(({parent,...r})=>r)}));
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
