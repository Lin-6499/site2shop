import {dirname,join,resolve} from 'node:path';
import {jsonFile,writeJson,safeBrowserError} from '../src/shopyy/artifacts.js';
import {sourceStorage} from '../src/shopyy/source-session.js';
import {inspectSourceComponents} from '../src/shopyy/browser.js';

// Agent-selected read-only UI states from the observed BPC-157 controls.
// No cart, checkout, notification subscription or account mutation is operated.
const file=resolve(process.argv[2]||''),root=dirname(file),project=await jsonFile(file);
if(new URL(project.sourceUrl).hostname!=='voidresearch.shop')throw Error('Site-specific observed product controls');
const storageState=await sourceStorage(project),rows:any[]=[];
const click=(selector:string)=>({op:'click',selector,effect:'read-only'});
const quantity='div:has(> button[aria-label="Increase quantity"])';
const pack2=click('button:has-text("2 VIALS")'),pack1=click('button:has-text("1 VIAL")');
const increase=click('button[aria-label="Increase quantity"]'),decrease=click('button[aria-label="Decrease quantity"]');
const states=[
 {id:'initial',actions:[],postReady:`${quantity} > span:text-is("1")`},
 {id:'pack-two',actions:[pack2],postReady:'div.grid > button.border-brand:has-text("2 VIALS")'},
 {id:'pack-three',actions:[click('button:has-text("3 VIALS")')],postReady:'div.grid > button.border-brand:has-text("3 VIALS")'},
 {id:'pack-five',actions:[click('button:has-text("5+ VIALS")')],postReady:'div.grid > button.border-brand:has-text("5+ VIALS")'},
 {id:'pack-ten',actions:[click('button:has-text("10 VIALS")')],postReady:'div.grid > button.border-brand:has-text("10 VIALS")'},
 {id:'quantity-two',actions:[increase],postReady:`${quantity} > span:text-is("2")`},
 {id:'quantity-reset',actions:[increase,decrease],postReady:`${quantity} > span:text-is("1")`},
 {id:'pack-reset',actions:[pack2,pack1],postReady:'div.grid > button.border-brand:has-text("1 VIAL")'},
 {id:'pack-two-quantity-two',actions:[pack2,increase],postReady:`${quantity} > span:text-is("2")`},
 {id:'pack-five-quantity-two',actions:[click('button:has-text("5+ VIALS")'),increase],postReady:`${quantity} > span:text-is("2")`},
 {id:'quantity-minimum',actions:[decrease],postReady:`${quantity} > span:text-is("1")`},
];
const only=process.argv.find(v=>v.startsWith('--only='))?.slice(7).split(',');
if(only?.some(id=>!states.some(s=>s.id===id)))throw Error('Unknown observed product state');
for(const state of states.filter(s=>!only||only.includes(s.id))){
 // Declare the final scroll context on both source and local replay, rather
 // than comparing Playwright's independent auto-scroll decisions as layout.
 const actions=[{op:'press',selector:'button[aria-label="Dismiss shipping notice"]',value:'Enter',effect:'read-only'},...state.actions,{op:'scroll',y:0,effect:'read-only'}];
 const selectors=`contracts/product-development-${state.id}.json`;
 await writeJson(join(root,selectors),{sourcePath:'/product/bpc-157',inspectionId:`bpc-development-${state.id}`,captureStructure:true,topology:'component-tree',infiniteAnimations:'frame-zero',rasterizeInfiniteFrameZero:true,preloadImages:true,imageRoot:'div.min-h-screen',initialReady:'button[aria-label="Dismiss shipping notice"]',actions,postReady:state.postReady,components:{header:'div.min-h-screen > header',title:'h1',hero:'div.min-h-screen > section:first-of-type',bundleOptions:'div.grid:has(> button:nth-child(5))',quantity,footer:'footer'}});
 try{
  const report=await inspectSourceComponents(file,selectors,{sourceStorageState:storageState});
  rows.push({state:state.id,...report});console.log(JSON.stringify({state:state.id,captures:report.rows.length,failed:report.rows.filter((r:any)=>!r.passed).length}));
 }catch(error){rows.push({state:state.id,passed:false,error:safeBrowserError(error)});}
}
const previous=only?await jsonFile(join(root,'verification/recon-current/product-development-source-run.json')).catch(()=>null):null;
const combined=[...(previous?.rows||[]).filter((r:any)=>!rows.some(next=>next.state===r.state)),...rows];
await writeJson(join(root,'verification/recon-current/product-development-source-run.json'),{kind:'read-only-product-ui-observations-not-acceptance',sourcePath:'/product/bpc-157',rows:combined,sourceCartOperated:false,sourceSubmissionPerformed:false,localCompared:false,buildCreated:false,draftChanged:false,published:false});
if(rows.some(r=>!r.passed))process.exitCode=1;
