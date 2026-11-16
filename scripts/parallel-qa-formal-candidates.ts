import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
const root=resolve(process.argv[2]||'../voidresearch-shopyy');
const out=join(root,'verification/parallel-qa');
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const json=async(p:string)=>JSON.parse(await readFile(join(root,p),'utf8'));
const ref=async(p:string)=>({path:p,sha256:sha(await readFile(join(root,p)))});
const save=async(p:string,v:any)=>writeFile(join(out,p),JSON.stringify(v,null,2));
const inventory=await json('contracts/route-inventory.v2.json');
const proposal=await json('contracts/navigation-proposal.v2.json');
const families=await json('contracts/families.v2.json');
const controls=await json('contracts/full-workflow-inventory.draft.json');
const extraControls=await json('verification/parallel-qa/new-route-control-inventory.json');
const activePlan=await json('contracts/capture-plan.v2.json');
const activeContracts=await json('contracts/page-contracts.v2.json');
const certificateRecon=await json('verification/recon-current/coa-detail-reconnaissance-run.json').catch(()=>({rows:[]}));
const certificateInputFile='staging/handoff-inputs/r3-coa-detail-inputs-5c4264d41412/manifest.json';
const certificateInput=await json(certificateInputFile).catch(()=>({dependencies:[],blocked:[]}));
const inputs=await Promise.all(['contracts/route-inventory.v2.json','contracts/navigation-proposal.v2.json','contracts/families.v2.json','contracts/full-workflow-inventory.draft.json','verification/parallel-qa/new-route-control-inventory.json','contracts/capture-plan.v2.json','contracts/page-contracts.v2.json'].map(ref));
inputs.push(await ref('verification/recon-current/coa-detail-reconnaissance-run.json'));inputs.push(await ref(certificateInputFile));
const mapped=proposal.rows.filter((r:any)=>r.proposedDisposition==='mapped');
const pageCandidates=proposal.rows.filter((r:any)=>r.proposedDisposition==='mapped'||r.family==='coa-certificate-detail');
const candidateRows=proposal.rows.map((r:any)=>({sourcePath:r.sourcePath,disposition:r.proposedDisposition,targetPath:r.targetPath||null,family:r.family,rationale:r.rationale,sourceEvidence:r.sourceEvidence||null,inActiveInventory:!!inventory.routes[r.sourcePath],reviewStatus:'candidate-only; needs explicit route disposition review and target destination validation'}));
const caseSpecs:any[]=[];
for(const f of await readdir(join(root,'contracts'))){
 if(!f.endsWith('.json'))continue;
 let j:any;try{j=await json('contracts/'+f);}catch{continue;}
 if(!j.sourcePath||!j.inspectionId||!j.components||!Array.isArray(j.actions)||/^(local-|target-)/.test(j.inspectionId)||/target/.test(f))continue;
 if(!mapped.some((r:any)=>r.sourcePath===j.sourcePath))continue;
 caseSpecs.push({sourcePath:j.sourcePath,inspectionId:j.inspectionId,spec:await ref('contracts/'+f),viewports:j.viewports||Object.keys(activePlan.viewports),reset:'fresh manually authenticated source context; apply the exact recorded context recipe',actions:j.actions,context:j.context||null,initialReady:j.initialReady||null,postReady:j.postReady||null,postAbsent:j.postAbsent||null,components:j.components,candidateStatus:'reset-to-state recipe; not a verified formal graph edge'});
}
const newBranches:Record<string,any[]>={
 '/order-sheet':[
  {id:'quantity-increase-decrease-reset',sourceBoundary:'client UI only; no source cart',states:['initial','quantity-increased','quantity-decreased','minimum-disabled','reset'],required:'Observe quantity, item count, totals, and disabled controls for an available and unavailable item on all three devices.'},
  {id:'notify-open-close',states:['initial','notify-open','notify-closed'],required:'Open and close a notification panel; never submit email or opt in.'},
  {id:'bulk-cart',states:['target-selection','target-cart-lines','target-empty-reset'],sourceBoundary:'No source cart submission; exercise only synthetic SHOPYY target goods after separate availability authorization.'}
 ],
 '/gift-cards':[
  {id:'amount-controls',states:['initial','preset-25','preset-50','preset-100','preset-200','exact-min','exact-max','range-changed','amount-reset'],required:'Read visible amount/range bounds and summary; no payment or gift issuance.'},
  {id:'recipient-mode',states:['send-as-gift','for-my-balance','gift-mode-reset'],required:'Compare form topology, labels and amount retention; no customer data submission.'},
  {id:'delivery-date-and-design',states:['deliver-now','scheduled-date','signature-design','halloween-design','reset'],required:'Capture visible date constraints and selected state; do not accept a financial/contract step.'},
  {id:'partner-code-disclosure',states:['code-closed','code-open','code-closed-reset'],required:'Open/close disclosure only; do not claim any real code.'},
  {id:'faq-six-items',states:['all-closed','each-open','each-closed'],required:'Each of six observed summary controls, every device; observe whether multiple-open is supported.'},
  {id:'payment-boundary',states:['target-validation','target-review-boundary'],sourceBoundary:'Continue to secure payment / Review and pay must not be executed on source. Payment/issuance is not authorized.'}
 ],
 '/ghost':[{id:'content-and-destinations',states:['initial','footer'],required:'Confirm current page content and every content/navigation destination; no game/prize transactions or subscription.'}],
 '/list':[
  {id:'parse-client-input',states:['initial','one-known-item','multiple-known-items','unknown-item','quantity-and-unit','empty-reset'],required:'Use synthetic public compound names only with all non-read requests blocked; verify parsing/resolution errors and totals, without source cart.'},
  {id:'share-link-boundary',states:['target-share-output'],sourceBoundary:'Source clipboard/share control unexecuted unless narrowly authorized; target clipboard effect must be explicit.'},
  {id:'add-to-cart-boundary',states:['target-cart-lines','target-empty-reset'],sourceBoundary:'Target-only synthetic cart; never submit source product identifiers.'}
 ],
 '/gift-cards/redeem':[{id:'redeem-form-boundary',states:['initial','client-empty-invalid','target-synthetic-code-result'],sourceBoundary:'Do not enter genuine gift codes or submit source redeem; financial/store-credit mutation remains a human boundary.'}],
 '/gift-cards/balance':[{id:'balance-form-boundary',states:['initial','client-empty-invalid','target-synthetic-code-result'],sourceBoundary:'Do not request genuine source card balances or enter real gift codes. Target-only fixture/provider boundary remains pending.'}]
};
const familyRequirements:Record<string,string[]>={
 home:['Current fixed-snapshot module order, announcement/menu/More/search/cart open-close, carousel reverse, lot lookup, disclosures and destinations.'],
 collection:['All category/filter/search/sort combinations and reset, empty results, card/price/media topology; wishlist/notify UI before submit; target-only cart.'],
 'product-purchase-bundle':['Per-route variant/strength/media/bundle applicability; quantity minimum/increase/decrease and retained selection; target-only real goods/cart; no representative acceptance inheritance without boundary rationale.'],
 'product-notify-detail':['Per-route unavailable/coming-soon state, media/strength, notify open-close without email submission, FAQs and destinations.'],
 'product-unavailable-bundle':['Per-route disabled purchase and bundle states, options/media, notify panel and reverse edges; no source cart.'],
 membership:['Every tier and monthly/annual selection, direct tier dropdown, reset, price/selected state, visible/dismissed shipping notice context; no enrollment/notification submission.'],
 coa:['Search known/none/reset, all amount choices, previous batches open-close, exact detail and external lab destinations, clipboard boundaries.'],
 'coa-certificate-detail':['Each certificate identity, compound/strength/lot/date/purity/provider fields, all report links, return navigation and no hidden loading skeleton.','Where observed, Fingerprint of this file / Check this file needs a separate read-only document identity/hash workflow and error/reset states. Public code Copy is a declared clipboard-effect boundary, not accepted from static markup.'],
 affiliate:['Calculator range/buttons and boundaries, each FAQ open-close, public content; logged-in account identity remains explicitly projected, not recreated.'],
 contact:['Each FAQ/disclosure open-close and public contact destinations; no source inquiry submission.'],
 'policy-tabs':['Every tab, direct query URL, reverse navigation and retained scroll, FAQ if present.'],
 'box-configurator':['Every item group, quantities/selection rules, totals and reset; provider/cart submission target-only.'],
 wishlist:['Initial empty and synthetic local populated/remove/reset; no source account or wishlist mutation.'],
 'discount-game':['Visible placement and UI only; no gambling, prize claim, cash-out or source transaction.'],
 'wholesale-inquiry':['All visible field groups and validation boundaries; no source form submission.']
};
const routeCoverage:any[]=[];const bindingCandidates:any[]=[];
for(const route of pageCandidates){
 const page=families.pages.find((p:any)=>p.sourcePath===route.sourcePath);
 const family=page&&families.families[page.family];
 const c=controls.pages.find((p:any)=>p.sourcePath===route.sourcePath)||extraControls.rows.find((p:any)=>p.sourcePath===route.sourcePath);
 const vp=(c?.viewports||[]).map((v:any)=>({viewport:v.viewport,evidence:v.sourceEvidence||v.evidence,controls:(v.controls||[]).map((z:any)=>({tag:z.tag,type:z.type||null,label:z.label||null,placeholder:z.placeholder||null,disabled:!!z.disabled,required:!!z.required})),sharedShippingNoticePresent:v.sharedShippingNoticePresent??null}));
 let data:any=null; if(page?.dataFile)data=await json(page.dataFile).catch(()=>null);
 const files=await Promise.all([family?.templateFile,page?.dataFile,data?.bodyFile].filter(Boolean).map(async(p:string)=>ref(p).catch(()=>({path:p,missing:true}))));
 const recipes=caseSpecs.filter(s=>s.sourcePath===route.sourcePath);
 const primary=Object.entries(activePlan.routes).filter(([,r]:any)=>r.sourcePath===route.sourcePath).map(([id,r]:any)=>({id,states:Object.keys(r.states),transitions:Object.keys(r.transitions),sequence:r.sequence,needsRefreshToCurrentSnapshot:route.sourcePath==='/'}));
 const detail=certificateRecon.rows.find((r:any)=>r.sourcePath===route.sourcePath);
 routeCoverage.push({sourcePath:route.sourcePath,targetPath:route.targetPath,family:route.family,proposedDisposition:route.proposedDisposition,owner:route.family==='home'?'A':'B',viewports:vp,certificateInitialReconnaissance:detail?{report:'verification/recon-current/coa-detail-reconnaissance-run.json',rows:detail.rows,metadata:detail.metadata,status:'planning-observation-only; not formal Capture'}:null,initialEvidenceStatus:vp.length===3?'reconnaissance-only-three-viewports':detail?.rows?.length===3?'certificate-three-device-recon; formal-control-inventory-pending':'missing-control-inventory-or-initial-evidence',sourceStateCases:recipes,existingActivePlan:primary,requiredBranches:newBranches[route.sourcePath]||familyRequirements[route.family]||['Review all observed controls/links and expand any dynamic behavior before treating this as static content.'],formalReadiness:{status:'pending',blockers:['Route disposition review and current-snapshot scope completeness','Source/target exact selectors and semantic pre/postconditions for every planned state','Explicit transition and reverse-edge graph; reset recipes alone are insufficient','Formal source capture with plan hash; source reconnaissance cannot be relabeled','Consumed presentation binding and guarded current build','Build-bound paired state/transition/destination captures and independent full image review']}});
 bindingCandidates.push({sourcePath:route.sourcePath,targetPath:route.targetPath,family:route.family,generator:page?{templateFile:family?.templateFile,nativeFile:page.nativeFile||family?.nativeFile,dataFile:page.dataFile||null,bodyFile:data?.bodyFile||null,inputRefs:files}:null,initialSource:route.sourceEvidence||null,sourceStateCaseRefs:recipes.map(s=>s.spec),captureRef:null,bindings:[],status:'owner/input candidate only; measurement-to-generator mappings must be authored from formal source captures',requiredMeasurementFields:['visible','x','y','width','height','display','fontFamily','fontSize','fontWeight','lineHeight','overflowX','overflowY','parent','order','tag','role','text','imageIdentity','controlInventory'],formalAccepted:false});
}
const base={schemaVersion:1,reviewer:'/root/independent_qa',createdAt:new Date().toISOString(),status:'planning-candidate-not-approved-not-executable-formal-plan',inputs,activeFilesModified:false,wholeSiteAccepted:false,publicationAllowed:false};
await mkdir(out,{recursive:true});
await save('formal-route-dispositions.candidate.json',{...base,sourceUrl:proposal.sourceUrl,activeInventoryCount:Object.keys(inventory.routes).length,rows:candidateRows,inventoryAdditions:candidateRows.filter((r:any)=>!r.inActiveInventory),counts:{all:candidateRows.length,mapped:mapped.length,external:candidateRows.filter((r:any)=>r.disposition==='external').length,deferredOnline:candidateRows.filter((r:any)=>r.disposition==='deferred-online').length}});
await save('formal-state-coverage.candidate.json',{...base,viewports:activePlan.viewports,environment:activePlan.environment,sourceSubmissionPolicy:'No source form/cart/account/financial/prize submissions; restricted branches remain declared and require target-only or human boundary validation.',rows:routeCoverage});
await save('formal-presentation-bindings.candidate.json',{...base,sourceUrl:proposal.sourceUrl,activeContractCaptureCount:activeContracts.captures.length,activeContractBindingCount:activeContracts.bindings.length,candidates:bindingCandidates,captures:[],bindings:[]});
const knownUrls=new Set(proposal.rows.map((r:any)=>new URL(r.sourcePath,proposal.sourceUrl).href));
const dependencyRows=certificateInput.dependencies.map((d:any)=>({...d,in177RouteProposal:knownUrls.has(d.url),status:'pending-destination-identity-and-reachability',proposedDisposition:knownUrls.has(d.url)?'use-existing-proposal-pending-verification':d.kind==='report-document'?'external-document-candidate-pending-validation':'unresolved-internal-route-needs-capture-and-page-plan'}));
await save('formal-navigation-supplement.candidate.json',{...base,source:certificateInputFile,rows:dependencyRows,missingFrom177Proposal:dependencyRows.filter((d:any)=>!d.in177RouteProposal),sourceFailures:certificateInput.blocked,counts:{uniqueDependencies:dependencyRows.length,newBeyond177:dependencyRows.filter((d:any)=>!d.in177RouteProposal).length,newDocuments:dependencyRows.filter((d:any)=>!d.in177RouteProposal&&d.kind==='report-document').length,newInternalPages:dependencyRows.filter((d:any)=>!d.in177RouteProposal&&d.kind!=='report-document').length},rationale:'These are actual links from already fixed certificate detail observations. They are not fresh live-source scope drift. Same-site historical lots cannot be waived as external provider pages; document links require explicit resource ownership/identity/reachability checks.'});
await save('formal-candidate-summary.json',{...base,counts:{routeDispositions:candidateRows.length,mappedRouteCoverage:mapped.length,pageOrPendingPageCoverage:routeCoverage.length,additionalRoutesBeyondActiveInventory:candidateRows.filter((r:any)=>!r.inActiveInventory).length,withThreeViewportControlInventory:routeCoverage.filter(r=>r.viewports.length===3).length,sourceResetRecipes:caseSpecs.length,formalCaptured:activeContracts.captures.length,formalBindings:activeContracts.bindings.length},integrationOrder:['Review dispositions and add all 26 new certificate detail routes to inventory with three-device source evidence','Freeze complete current scope, semantic graphs, exact source/target selectors and expected postconditions; do not treat reset-to-state recipes as reverse-edge evidence','Author formal source-to-generator bindings and collect under the full plan hash','Rebuild shared preview/native output, replay paired states/transitions/destinations and submit independent image review','Only primary writes already-authorized provisional fixed packages to draft504457; whole-site and online gates remain closed'],remoteCapability:{separatePageTypes:'Historical product/collection/content probes rendered on distinct routes in draft504457',perContentSlugIsolation:'not established; default content template may affect multiple consumers',evidence:['verification/custom-block-504457/report.md','verification/custom-block-504457/commerce-report.md','verification/custom-block-504457/commerce-result.json']}});
const summary=JSON.parse(await readFile(join(out,'formal-candidate-summary.json'),'utf8'));
summary.navigationSupplement={file:'formal-navigation-supplement.candidate.json',additionalObservedUrls:dependencyRows.filter((d:any)=>!d.in177RouteProposal).length,additionalDocuments:dependencyRows.filter((d:any)=>!d.in177RouteProposal&&d.kind==='report-document').length,additionalSameSiteHistoricalPages:dependencyRows.filter((d:any)=>!d.in177RouteProposal&&d.kind!=='report-document').length,knownObservedUrlUnion:candidateRows.length+dependencyRows.filter((d:any)=>!d.in177RouteProposal).length,status:'candidate union only; active inventory and formal capture plan incomplete'};
await save('formal-candidate-summary.json',summary);
console.log(JSON.stringify({routes:candidateRows.length,mapped:mapped.length,pageCandidates:routeCoverage.length,inventoryAdditions:candidateRows.filter((r:any)=>!r.inActiveInventory).length,sourceRecipes:caseSpecs.length,controlInventories:routeCoverage.filter(r=>r.viewports.length===3).length,extraDependenciesBeyond177:dependencyRows.filter((d:any)=>!d.in177RouteProposal).length,activeFilesModified:false,formalAccepted:false}));
