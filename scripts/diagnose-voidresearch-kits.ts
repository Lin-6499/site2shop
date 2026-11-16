import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {jsonFile} from '../src/shopyy/artifacts.js';
import {sourceStorage} from '../src/shopyy/source-session.js';
import {admittedSourceReadQuery} from '../src/shopyy/source-read-queries.js';
const project=await jsonFile(resolve(process.argv[2]));const storageState=await sourceStorage(project),browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({storageState,serviceWorkers:'block'}),queries:any[]=[];
 await context.route('**/*',async route=>{const r=route.request();if(['GET','HEAD','OPTIONS'].includes(r.method()))return route.continue();const allowed=admittedSourceReadQuery(project,{method:r.method(),url:r.url(),frameUrl:r.frame().url(),payload:r.postData()||'',navigation:r.isNavigationRequest(),resourceType:r.resourceType()});if(allowed){queries.push({id:allowed.id});return route.continue();}return route.abort();});
 const page=await context.newPage();await page.goto(new URL('/shop?category=Kits',project.sourceUrl).href);await page.locator('h1').waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('section')].some(n=>/\b47 kits\b/.test(n.textContent||'')),null,{timeout:25000}).catch(()=>undefined);
 console.log(JSON.stringify({queries,sections:await page.locator('div.min-h-screen > section').evaluateAll(nodes=>nodes.map((n,i)=>({index:i+1,paragraphs:[...n.querySelectorAll('p')].slice(0,5).map(p=>p.textContent),links:n.querySelectorAll('a').length}))),shippingDismiss:await page.locator('button[aria-label="Dismiss shipping notice"]').count()}));
}finally{await browser.close();}
