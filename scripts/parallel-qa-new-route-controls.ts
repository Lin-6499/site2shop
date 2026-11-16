import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {load} from 'cheerio';
const root=resolve('../voidresearch-shopyy');
const inv=JSON.parse(await readFile(join(root,'contracts/route-inventory.v2.json'),'utf8')),rows=[];
for(const path of ['/order-sheet','/gift-cards','/ghost','/list','/gift-cards/redeem','/gift-cards/balance']){
 const viewports=[];
 for(const viewport of ['desktop','tablet','mobile']){
  const surface=inv.coverage.surfaces.find((s:any)=>s.path===path&&s.viewport===viewport&&s.state==='initial'&&s.status==='captured');
  if(!surface){viewports.push({viewport,status:'missing'});continue;}
  const bytes=await readFile(join(root,surface.evidence.path));
  if(createHash('sha256').update(bytes).digest('hex')!==surface.evidence.sha256)throw Error('Changed reconnaissance evidence');
  const observation=JSON.parse(bytes.toString()),$=load(observation.structure);
  const sharedShippingNoticePresent=$('#intl-waitlist-email').length>0;
  $('header,footer,script,noscript,body > div:has(#intl-waitlist-email)').remove();
  const controls=$('button,input,select,textarea,summary').toArray().map((node,index)=>({
   index,tag:node.tagName,id:$(node).attr('id')||null,role:$(node).attr('role')||null,
   label:$(node).attr('aria-label')||$(node).text().trim().replace(/\s+/g,' '),
   type:$(node).attr('type')||null,placeholder:$(node).attr('placeholder')||null,
   disabled:$(node).attr('disabled')!==undefined,required:$(node).attr('required')!==undefined,
   options:node.tagName==='select'?$(node).find('option').map((_,n)=>({value:$(n).attr('value'),text:$(n).text()})).get():undefined
  }));
  viewports.push({viewport,status:'reconnaissance-initial-only',sharedShippingNoticePresent,evidence:surface.evidence,controls,forms:$('form').length,links:$('a[href]').map((_,n)=>({text:$(n).text().trim().replace(/\s+/g,' '),href:$(n).attr('href')})).get()});
 }
 rows.push({sourcePath:path,viewports,interactionCoverage:'not-captured',required:'Define semantic actions/postconditions from rendered behavior, collect read-only states and local equivalent states; do not infer interaction implementation from static DOM.',boundaries:['No source purchases, form submissions, gift redemption, personal balance lookup, account changes or reward claims.','Do not use source product/gift/customer identifiers in a live target transaction.','Native SHOPYY or owned local adapter must handle transaction boundaries and report capabilities explicitly.']});
}
await writeFile(join(root,'verification/parallel-qa/new-route-control-inventory.json'),JSON.stringify({kind:'read-only-planning-audit-not-approved-plan',reviewer:'/root/independent_qa',createdAt:new Date().toISOString(),rows,wholeSiteAccepted:false,published:false},null,2));
console.log(JSON.stringify(rows.map(r=>({path:r.sourcePath,viewports:r.viewports.map((v:any)=>({viewport:v.viewport,controls:v.controls?.length,forms:v.forms,sharedShippingNoticePresent:v.sharedShippingNoticePresent}))})),null,2));
