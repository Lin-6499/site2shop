import { dirname, join, resolve } from 'node:path';
import { load } from 'cheerio';
import { readFile } from 'node:fs/promises';
import { jsonFile, readRef, writeJson, digest, saveArtifact } from '../src/shopyy/artifacts.js';

// Site-specific planning decisions remain separate from the portable adapter and approved inventory.
const file=resolve(process.argv[2]||''),root=dirname(file),project=await jsonFile(file);
if(new URL(project.sourceUrl).hostname!=='voidresearch.shop')throw Error('This agent-authored planning recipe is specific to the observed Void Research source');
const inventory=await jsonFile(join(root,'contracts/route-inventory.v2.json'));
const native=await jsonFile(join(root,'verification/recon-current/native-navigation.json')).catch(()=>null);
const nativeEvidence=native?await saveArtifact(root,native):null;
const articles=new Set(['/shipping-and-returns','/terms','/privacy','/billing','/complaints','/partner-terms']);
const named:Record<string,string>={'/':'home','/about':'about','/coa':'coa','/contact':'contact','/membership':'membership','/affiliate':'affiliate','/how-to-save':'promotions','/wishlist':'wishlist','/the-void':'discount-game','/box':'box-configurator','/wholesale':'wholesale-inquiry','/order-sheet':'order-sheet','/list':'list-parser','/gift-cards':'gift-card-purchase','/gift-cards/redeem':'gift-card-redeem','/gift-cards/balance':'gift-card-balance','/ghost':'ghost-content'};
const rows:any[]=[],pending:string[]=[];
for(const [sourcePath,entry]of Object.entries<any>(inventory.routes)){
  const url=new URL(sourcePath,project.sourceUrl);
  if(url.origin!==new URL(project.sourceUrl).origin){
    const occurrence=inventory.occurrences.find((o:any)=>o.path===sourcePath);
    const surface=inventory.coverage.surfaces.find((s:any)=>s.path===occurrence?.from&&s.viewport==='desktop');
    rows.push({sourcePath,proposedDisposition:'external',targetPath:sourcePath,family:['mailto:','tel:'].includes(url.protocol)?'contact-link':'external-lab-document',sourceEvidence:surface?.evidence,rationale:'Preserve the observed public destination. Source lab/contact evidence is not proof of target merchant ownership, target batches or target provider installation.'});
    continue;
  }
  if(entry.disposition==='deferred-online'){
    const path=url.pathname==='/track'?'/account/trackingorder':'/account/login';
    const verified=native?.origin==='https://pepsss.zenshop.cn'&&native.links.some((l:any)=>l.href===path);
    rows.push({sourcePath,proposedDisposition:'deferred-online',targetPath:verified?native.origin+path:null,family:'platform-account-or-order-boundary',sourceEvidence:entry.evidence,nativeEvidence,capabilityStatus:url.pathname.startsWith('/account/partner')?'generic-sign-in-entry-only; affiliate-enrollment-unverified':'entry-observed; workflow-unverified',rationale:entry.rationale+' Only the actual SHOPYY public entry is mapped; private account/order/enrollment behavior remains outside this local phase.'});continue;
  }
  const surface=inventory.coverage.surfaces.find((s:any)=>s.path===sourcePath&&s.viewport==='desktop'&&s.state==='initial');
  if(!surface){pending.push(sourcePath);rows.push({sourcePath,proposedDisposition:'unresolved',rationale:'No current desktop initial observation'});continue;}
  const observation=JSON.parse((await readRef(root,surface.evidence)).toString()),$=load(observation.structure);
  const buttons=observation.controls.filter((c:any)=>c.tag==='BUTTON').map((c:any)=>c.label);
  let family=named[url.pathname],targetPath=url.pathname==='/'?'/':`/pages/${url.pathname.slice(1)}`;
  if(url.pathname==='/shop'||url.pathname==='/referral'){
    family='collection';targetPath=url.searchParams.has('category')?`/collections/${url.searchParams.get('category')!.toLowerCase()}`:'/collections/all'+url.search;
  }else if(url.pathname.startsWith('/product/')){
    if($('main').length===1&&buttons.some((s:string)=>/^Notify me$/i.test(s)))family='product-notify-detail';
    else if($('main').length===0&&buttons.includes('Add To Cart'))family='product-purchase-bundle';
    else if($('main').length===0&&buttons.some((s:string)=>/^Notify me$/i.test(s)))family='product-unavailable-bundle';
    else{family='unclassified-product-boundary';pending.push(sourcePath);}
    targetPath='/products/'+url.pathname.split('/').pop();
  }else if(url.pathname==='/policies'){
    family='policy-tabs';targetPath='/pages/policies'+url.search;
  }else if(articles.has(url.pathname))family='policy-article';
  else if(url.pathname.startsWith('/guides/')){family='reference-guide';targetPath='/pages/guide-'+url.pathname.split('/').pop();}
  if(!family){family='unclassified';pending.push(sourcePath);}
  rows.push({sourcePath,proposedDisposition:family.startsWith('unclassified')?'unresolved':'mapped',targetPath,family,sourceEvidence:surface.evidence,title:observation.headings[0]?.text||null,viewportsObserved:inventory.coverage.surfaces.filter((s:any)=>s.path===sourcePath&&s.state==='initial').map((s:any)=>s.viewport),rationale:'Proposed from the actual rendered structure and controls. The target URL is a local implementation proposal, not proof that a SHOPYY catalog item/page/category exists.'});
}
const counts:Record<string,number>={};for(const row of rows)counts[row.family]=(counts[row.family]||0)+1;
const result={schemaVersion:2,status:'agent-planning-proposal-not-approved-inventory',sourceUrl:project.sourceUrl,inventorySha256:digest(await readFile(join(root,'contracts/route-inventory.v2.json'))),phase:'homepage-and-navigation-first',target:{origin:'https://pepsss.zenshop.cn',draftSkinId:'504457',publish:false},counts,rows,pending,remaining:['Select representative and boundary samples for every behavior family','Complete independent component/state/transition plans and raw source captures','Review three-device navigation surfaces and every route disposition before signing the inventory','Implement ordinary mapped destinations locally; account/order boundaries alone may defer','Bind real SHOPYY routes/catalog/assets and confirm external proof/contact ownership before online acceptance'],restrictedSourceActions:['No source newsletter/contact/partner/notification form submissions','No source wishlist/account/cart/order mutations or purchases','No source reward/coupon claiming, game cash-out or personal eligibility declarations']};
await writeJson(join(root,'contracts/navigation-proposal.v2.json'),result);
console.log(JSON.stringify({file:join(root,'contracts/navigation-proposal.v2.json'),families:counts,pending,status:result.status},null,2));
