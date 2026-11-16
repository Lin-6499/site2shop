import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {unlockStorefrontIfNeeded} from '../.codex-build/src/storefront-auth.js';
const project=path.resolve(process.argv[2]),dir=path.join(project,'cart-diagnostic');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();const url='https://azhiip-13.myshopify.com/products/home-state-wine-glass?preview_theme_id=189701193927';await page.goto(url,{waitUntil:'domcontentloaded'});await unlockStorefrontIfNeeded(page,url);
 const identity=await page.evaluate(()=>({theme:window.Shopify?.theme,build:document.querySelector('meta[name="site2shop-build-id"]')?.content,asset:[...document.scripts].map(n=>n.src).find(n=>n.includes('/assets/s2s-family-product.js'))}));
 if(String(identity.theme?.id)!=='189701193927'||identity.theme?.role!=='unpublished')throw new Error('Wrong draft identity '+JSON.stringify(identity.theme));
 const results=[];
 for(const filename of ['s2s-commerce.js','s2s-commerce.css']){
  const asset=new URL(identity.asset);asset.pathname=asset.pathname.replace(/[^/]+$/,filename);asset.search='';
  const response=await page.context().request.get(asset.href);if(response.status()!==200)throw new Error('Missing cart asset '+filename);
  const bytes=await response.body();await fs.mkdir(path.join(dir,'remote-readback/assets'),{recursive:true});await fs.writeFile(path.join(dir,'remote-readback/assets',filename),bytes);
  const local=await fs.readFile(path.join(project,'theme/assets',filename));results.push({filename,match:bytes.equals(local),sha256:createHash('sha256').update(bytes).digest('hex')});
 }
 await fs.writeFile(path.join(dir,'remote-identity.json'),JSON.stringify({checkedAt:new Date().toISOString(),...identity,assets:results},null,2));console.log(JSON.stringify({theme:identity.theme,assets:results},null,2));
}finally{await browser.close();}
