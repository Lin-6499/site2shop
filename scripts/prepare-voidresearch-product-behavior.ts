import {dirname,join,resolve} from 'node:path';
import {load} from 'cheerio';
import {jsonFile,readRef,writeJson} from '../src/shopyy/artifacts.js';
import {sourceSessionPolicy} from '../src/shopyy/source-session.js';
const file=resolve(process.argv[2]||''),root=dirname(file),project=await jsonFile(file);
if(new URL(project.sourceUrl).hostname!=='voidresearch.shop')throw Error('Site-specific observed product behavior');
const run=await jsonFile(join(root,'verification/recon-current/product-development-source-run.json'));
const price='div.min-h-screen > section:first-of-type div.mt-4.flex.flex-wrap.items-baseline';
const bundles='div.min-h-screen > section:first-of-type div.grid:has(> button:nth-child(5))';
const coins='div.min-h-screen > section:first-of-type p:has(> span.font-semibold.text-brand) > span';
const quantity='div:has(> button[aria-label="Increase quantity"]) > span';
const choices=[{state:'initial',count:1},{state:'pack-two',count:2},{state:'pack-three',count:3},{state:'pack-five',count:5},{state:'pack-ten',count:10}];
const tiers:any[]=[],evidence:any[]=[];
for(const choice of choices){
 const state=run.rows.find((r:any)=>r.state===choice.state);
 if(!state?.passed||state.rows.length!==3)throw Error('Missing observed three-device product tier');
 const models=[];
 for(const row of state.rows){
  const d=JSON.parse((await readRef(root,row.structure)).toString());
  if(!d.sourceSessionCurrent||d.sourceSessionPolicySha256!==sourceSessionPolicy(project))throw Error('Stale product behavior evidence');
  const $=load(d.structure),cell=$(price),options=$(bundles),reward=$(coins);
  if(cell.length!==1||options.length!==1||options.children('button').length!==5||reward.length!==1)throw Error('Ambiguous observed product price, bundle or reward');
  const selected=options.children('button.border-brand');
  models.push({count:choice.count,priceSpans:cell.children('span').toArray().map(n=>({text:$(n).text(),class:$(n).attr('class')})),coins:reward.text(),selectedClass:selected.attr('class'),idleClasses:options.children('button').toArray().map(n=>$(n).attr('class'))});
  evidence.push(row.structure);
 }
 const model=models[0];
 if(models.some(m=>JSON.stringify(m)!==JSON.stringify(model)))throw Error('Product tier differs across viewports; explicit responsive model required');
 tiers.push(model);
}
// Verify combined controls against independent observations, rather than inferring
// that selecting a bundle is the same state as changing quantity.
for(const[record,tierIndex,packIndex]of [['quantity-two',1,0],['pack-two-quantity-two',2,1],['pack-five-quantity-two',4,3]] as const){
 const state=run.rows.find((r:any)=>r.state===record);if(!state?.passed)throw Error('Missing combined-control evidence');
 for(const row of state.rows){const d=JSON.parse((await readRef(root,row.structure)).toString()),$=load(d.structure);const spans=$(price).children('span').map((_,n)=>({text:$(n).text(),class:$(n).attr('class')})).get();if(JSON.stringify(spans)!==JSON.stringify(tiers[tierIndex].priceSpans)||$(coins).text()!==tiers[packIndex].coins)throw Error('Combined controls contradict tier/reward model');evidence.push(row.structure);}
}
const config=await jsonFile(join(root,project.familiesFile)),page=config.pages.find((p:any)=>p.sourcePath===run.sourcePath);
const data=await jsonFile(join(root,page.dataFile));
const initial=tiers[0];
const idleClasses=tiers[1].idleClasses.map((c:string,index:number)=>index===1?tiers[0].idleClasses[1]:c);
data.ui={...data.ui,product:{sourcePath:run.sourcePath,selectors:{price,bundles,coins,quantity},tiers:tiers.map(({count,priceSpans,coins}:any)=>({count,priceSpans,coins})),selectedClasses:tiers.map(t=>t.selectedClass),idleClasses,evidence,scope:'observed-bundle-and-quantity-presentation; commerce and additional product families remain pending'}};
await writeJson(join(root,page.dataFile),data);
console.log(JSON.stringify({sourcePath:run.sourcePath,tiers:tiers.length,evidence:evidence.length,commerceBound:false,status:'behavior-inputs-prepared-not-accepted'}));
