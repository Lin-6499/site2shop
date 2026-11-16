import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {jsonFile} from '../src/shopyy/artifacts.js';
import {sourceProfile,sourceStorageCurrent,isSourceSessionRefresh} from '../src/shopyy/source-session.js';

const project=await jsonFile(resolve(process.argv[2])),profile=sourceProfile(project);
const context=await chromium.launchPersistentContext(profile.directory,{headless:true,serviceWorkers:'block'});
try{
 await context.route('**/*',route=>['GET','HEAD','OPTIONS'].includes(route.request().method())||isSourceSessionRefresh(route.request().method(),route.request().url(),project)?route.continue():route.abort('blockedbyclient'));
 const page=context.pages()[0]||await context.newPage();
 await page.goto(project.sourceUrl,{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForLoadState('networkidle',{timeout:5000}).catch(()=>undefined);
 const links=page.locator(project.workflow.sourceSession.readySelector),count=await links.count(),visibility=[];
 for(let i=0;i<Math.min(10,count);i++)visibility.push(await links.nth(i).isVisible());
 const blocked=[];
 for(const selector of project.workflow.sourceSession.blockedSelectors)blocked.push({selector,visible:await page.locator(selector).isVisible()});
 const url=new URL(page.url());
 console.log(JSON.stringify({origin:url.origin,path:url.pathname,queryKeys:[...url.searchParams.keys()],title:await page.title(),heading:await page.locator('h1').allTextContents(),readyLinks:count,visibility,blocked,sessionCurrent:sourceStorageCurrent(project,await context.storageState({indexedDB:true}))}));
}finally{await context.close();}
