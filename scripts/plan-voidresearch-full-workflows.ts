import {dirname,join,resolve} from 'node:path';
import {load} from 'cheerio';
import {jsonFile,readRef,writeJson,digest} from '../src/shopyy/artifacts.js';

const file=resolve(process.argv[2]||''),root=dirname(file),project=await jsonFile(file);
if(new URL(project.sourceUrl).hostname!=='voidresearch.shop')throw Error('Site-specific rendered control inventory');
const inventory=await jsonFile(join(root,'contracts/route-inventory.v2.json'));
const proposal=await jsonFile(join(root,'contracts/navigation-proposal.v2.json')),pages:any[]=[];
for(const route of proposal.rows.filter((r:any)=>r.proposedDisposition==='mapped')){
 const viewports:any[]=[];
 for(const viewport of ['desktop','tablet','mobile']){
  const surface=inventory.coverage.surfaces.find((s:any)=>s.path===route.sourcePath&&s.state==='initial'&&s.viewport===viewport);
  if(!surface){viewports.push({viewport,status:'missing'});continue;}
  const observation=JSON.parse((await readRef(root,surface.evidence)).toString()),$=load(observation.structure);
  $('header,footer,script,noscript,button[aria-label="Dismiss purchase notifications"],body > div:has(#intl-waitlist-email)').remove();
  const controls=$('button,input,select,textarea,summary').toArray().map((node,index)=>({
   index,tag:node.tagName,label:$(node).attr('aria-label')||$(node).text().trim().replace(/\s+/g,' '),
   type:$(node).attr('type')||null,placeholder:$(node).attr('placeholder')||null,
   options:node.tagName==='select'?$(node).find('option').map((_,n)=>({value:$(n).attr('value'),text:$(n).text()})).get():undefined,
   disabled:$(node).attr('disabled')!==undefined,required:$(node).attr('required')!==undefined,
  }));
  viewports.push({viewport,sourceEvidence:surface.evidence,controls,forms:$('form').length,details:$('details').length,sourceErrorCandidate:/something went wrong|failed to load|try again/i.test($('body').text())});
 }
 const signatures=[...new Set(viewports.flatMap(v=>(v.controls||[]).map((c:any)=>`${c.tag}:${c.type||''}:${c.label||c.placeholder||''}`)))];
 pages.push({sourcePath:route.sourcePath,targetPath:route.targetPath,family:route.family,viewports,interactionSignatures:signatures,
  implementationStatus:'requires-per-control-binding-and-replay',objectiveAcceptance:'pending',imageReview:'pending',
  boundaries:['No live source form/cart/account submission','Real SHOPYY merchant bindings and commerce validation after complete local acceptance']});
}
const families=Object.fromEntries([...new Set<string>(pages.map(p=>p.family))].map(family=>{const rows=pages.filter(p=>p.family===family);return[family,{pages:rows.length,controls:[...new Set(rows.flatMap(p=>p.interactionSignatures))],allPagesCompared:false}]}));
await writeJson(join(root,'contracts/full-workflow-inventory.draft.json'),{schemaVersion:2,kind:'agent-planning-input-not-approved-plan',sourceUrl:project.sourceUrl,sourceInventorySha256:digest(JSON.stringify(inventory)),scope:'all-mapped-pages-and-observed-controls',families,pages,pending:['Assign semantic state graphs, locators, rules and generator ownership to every control','Replay all branches and destinations on three devices','Export source contracts and require a guarded current build before draft installation'],published:false});
console.log(JSON.stringify({pages:pages.length,families:Object.fromEntries(Object.entries<any>(families).map(([k,v])=>[k,{pages:v.pages,uniqueControls:v.controls.length}])),sourceErrorCandidates:pages.filter(p=>p.viewports.some((v:any)=>v.sourceErrorCandidate)).map(p=>p.sourcePath)},null,2));
