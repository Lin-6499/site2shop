import {dirname,join,resolve} from 'node:path';
import {jsonFile,writeJson,safeBrowserError,saveArtifact} from '../src/shopyy/artifacts.js';
import {sourceStorage} from '../src/shopyy/source-session.js';
import {inspectSourceComponents} from '../src/shopyy/browser.js';
const file=resolve(process.argv[2]||''),root=dirname(file),project=await jsonFile(file);
if(new URL(project.sourceUrl).hostname!=='voidresearch.shop')throw Error('Site-specific observed collection controls');
const storageState=await sourceStorage(project),rows:any[]=[];
const query=(value:string)=>({op:'fill',selector:'input[placeholder="Search for products"]',value,effect:'read-only'});
const filter=(text:string)=>({op:'click',selector:`div.min-h-screen > section:nth-of-type(3) button:has-text("${text}")`,effect:'read-only'});
const sort=(value:string)=>({op:'select',selector:'select',value,effect:'read-only'});
const states:any[]=[
 {id:'initial',actions:[],count:'74 products'},
 {id:'search-ghk',actions:[query('GHK')],count:'4 products'},
 {id:'search-none',actions:[query('zz-s2s-504457-no-match')],count:'0 products'},
 {id:'search-reset',actions:[query('GHK'),query('')],count:'74 products'},
 {id:'new',actions:[filter('New')],count:'12 products'},
 {id:'coming',actions:[filter('Coming soon')],count:'22 products'},
 {id:'filter-reset',actions:[filter('Coming soon'),filter('All')],count:'74 products'},
 {id:'sort-price-asc',actions:[sort('price-asc')]},
 {id:'sort-price-desc',actions:[sort('price-desc')]},
 {id:'sort-name',actions:[sort('name')]},
 {id:'sort-reset',actions:[sort('name'),sort('popularity')]},
 {id:'combined-new-ghk',actions:[query('GHK'),filter('New')],count:'1 product'},
 {id:'combined-coming-ghk',actions:[query('GHK'),filter('Coming soon')],count:'1 product'},
 ...['Peptides','Capsules','Gluta','Aminos','Kits','Raws','Supplies'].map(category=>({id:'category-'+category.toLowerCase(),sourcePath:`/shop?category=${category}`,actions:[],...(category==='Kits'?{postReady:'div.min-h-screen > section:nth-of-type(5) a[href^="/product/"] >> nth=0'}:{})})),
];
const only=process.argv.find(v=>v.startsWith('--only='))?.slice(7).split(',');
if(only?.some(id=>!states.some(s=>s.id===id)))throw Error('Unknown collection state');
const reportFile=join(root,'verification/recon-current/collection-development-source-run.json');
const previous=await jsonFile(reportFile).catch(()=>null);
const priorAttempt=previous?await saveArtifact(root,{kind:'prior-collection-source-run',report:previous}):null;
for(const state of states.filter(s=>!only||only.includes(s.id))){
 const sourcePath=state.sourcePath||'/shop',selectors=`contracts/collection-development-${state.id}.json`;
 await writeJson(join(root,selectors),{sourcePath,inspectionId:`collection-development-${state.id}`,captureStructure:true,topology:'component-tree',infiniteAnimations:'frame-zero',rasterizeInfiniteFrameZero:true,preloadImages:true,imageRoot:'div.min-h-screen',initialReady:'button[aria-label="Dismiss shipping notice"]',actions:[{op:'press',selector:'button[aria-label="Dismiss shipping notice"]',value:'Enter',effect:'read-only'},...state.actions,{op:'scroll',y:0,effect:'read-only'}],postReady:state.postReady||(state.count?`div.min-h-screen > section:nth-of-type(3) p:text-is("${state.count}")`:'div.min-h-screen > section:nth-of-type(5)'),components:{header:'div.min-h-screen > header',intro:'div.min-h-screen > section:nth-of-type(1)',trust:'div.min-h-screen > section:nth-of-type(2)',filters:'div.min-h-screen > section:nth-of-type(3)',box:'div.min-h-screen > section:nth-of-type(4)',grid:'div.min-h-screen > section:nth-of-type(5)',newsletter:'div.min-h-screen > section:nth-of-type(6)',footer:'footer',query:'input[placeholder="Search for products"]',sort:'select'}});
 try{const report=await inspectSourceComponents(file,selectors,{sourceStorageState:storageState});rows.push({state:state.id,sourcePath,...report});console.log(JSON.stringify({state:state.id,captures:report.rows.length,failed:report.rows.filter((r:any)=>!r.passed).length}));}
 catch(error){rows.push({state:state.id,sourcePath,passed:false,error:safeBrowserError(error)});}
 const combined=[...(only?previous?.rows||[]:[]).filter((r:any)=>!rows.some(next=>next.state===r.state)),...rows];
 await writeJson(reportFile,{kind:'collection-control-observations-not-acceptance',rows:combined,priorAttempt,sourceSubmissionPerformed:false,published:false});
}
if(rows.some(r=>!r.passed))process.exitCode=1;
