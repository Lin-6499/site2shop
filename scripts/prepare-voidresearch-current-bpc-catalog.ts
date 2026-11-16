import {dirname,join,resolve} from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {load} from 'cheerio';
import {digest,jsonFile,writeJson} from '../src/shopyy/artifacts.js';
const root=dirname(resolve(process.argv[2])),inspectionFile='verification/recon-current/inspections/bpc-native-catalog-current-r1/component-inspection-dee4b8e36f68.json',inspectionBytes=await readFile(join(root,inspectionFile)),inspection=JSON.parse(inspectionBytes.toString());
if(!inspection.passed||inspection.rows.length!==3||inspection.rows.some((r:any)=>!r.passed))throw Error('Current complete three-device BPC planning inventory required');
const descriptions:any[]=[],sourceRows:any[]=[];
for(const row of inspection.rows){
 const bytes=await readFile(join(root,row.structure.path));if(digest(bytes)!==row.structure.sha256)throw Error('Current BPC inventory changed');
 const source=JSON.parse(bytes.toString());if(source.requestedPath!=='/product/bpc-157'||!source.sourceSessionCurrent)throw Error('Wrong source route/session');
 const $=load(source.structure),heading=$('h2').filter((_,n)=>$(n).text()==='Compound Information');
 if(heading.length!==1)throw Error('Compound information owner absent/ambiguous');
 const compound=heading.parent().parent().parent();
 if(compound.find('h3').filter((_,n)=>$(n).text()==='BPC-157 (Body Protection Compound)').length!==1)throw Error('Unexpected source description owner');
 const snippets=[compound.clone()];
 for(const title of ['Research Application Guidelines','Regulatory Notice','Purchase & Responsibility Agreement']){
  const h=$('h2').filter((_,n)=>$(n).text()===title);if(h.length!==1)throw Error('Description disclosure absent/ambiguous');snippets.push(h.closest('section').clone());
 }
 const clean=load(snippets.map(n=>$.html(n)).join(''),null,false);
 clean('script,style,svg,math,iframe,object,embed,form,input,textarea,button,select,img,video,audio,canvas').remove();
 clean('a').each((_,n)=>clean(n).replaceWith(clean(n).contents()));
 clean('*').each((_,n)=>{for(const name of Object.keys(n.attribs||{}))clean(n).removeAttr(name);});
 const html=clean.html(),text=clean.root().text().replace(/\s+/g,' ').trim();
 if(/<(script|style|form|input|iframe)|\bon\w+=|https?:/i.test(html))throw Error('Unsafe product description remains');
 descriptions.push({viewport:row.viewport,html,text,sha256:digest(html),evidence:row.structure});
 sourceRows.push({viewport:row.viewport,structure:row.structure,screenshot:source.screenshot,capturedAt:source.capturedAt,kind:source.kind});
}
if(descriptions.some(d=>d.html!==descriptions[0].html))throw Error('Source static description differs by device; manual resolution required');
const base=await jsonFile(join(root,'verification/native-catalog-plan/offline-products.proposed.json')),product=structuredClone(base.createNowAfterPrimaryResolvesFieldNotes[0]);
const proofFile='verification/asset-hosting-504457/bpc-current-r1/report.json',proofBytes=await readFile(join(root,proofFile)),proof=JSON.parse(proofBytes.toString()),token='images/source-current/'+product.fields.primaryImage.uploadAlternative.sha256+'.png',host=proof.rows.find((r:any)=>r.assetToken===token);
const verified=await jsonFile(join(root,'verification/asset-hosting-504457/verified-asset-map.json'));
if(!proof.passed||!host?.sameBytes||!host.samePixels||!host.sameDimensions||host.targetSha256!==product.fields.primaryImage.uploadAlternative.sha256||verified[token]!==host.targetUrl)throw Error('Current primary target image proof invalid');
product.fields.primaryImage.targetBinding={assetToken:token,targetUrl:host.targetUrl,report:proofFile,reportSha256:digest(proofBytes),sameBytes:true,samePixels:true,sameDimensions:true};
product.fields.descriptionHtmlFile='description.html';product.fields.descriptionHtmlSha256=digest(descriptions[0].html);delete product.fields.descriptionHtml;
product.descriptionEvidence={sourceRows,threeDeviceStaticHtmlIdentical:true,sourceTextCopied:true,sanitization:'Remove scripts, trackers, forms, input controls, media and decorative SVG; unwrap links; remove all attributes; retain actual source technical prose/disclosures only. No added product claims.'};
const currencyFile='verification/native-catalog-plan/source-currency-public-code.json',currencyBytes=await readFile(join(root,currencyFile));product.fields.currencyEvidence={file:'source-currency-public-code.json',sha256:digest(currencyBytes),storefrontDefault:'USD',scope:'Public source defaults; product-specific runtime currency unobserved. Primary must explicitly accept default mapping before assigning native price currency.'};
product.pendingBeforeCommerceBinding=product.pendingBeforeCommerceBinding.filter((s:string)=>!s.startsWith('Source description/related body'));product.pendingBeforeCommerceBinding.push('Related product links/current images and whole-body native rendering remain pending; this creation package is not a native page acceptance');
const version='r1-current-bpc-catalog-'+digest(JSON.stringify(product)+descriptions[0].html).slice(0,12),directory='staging/handoff-inputs/'+version;
await mkdir(join(root,directory),{recursive:false});await writeFile(join(root,directory,'description.html'),descriptions[0].html);await writeJson(join(root,directory,'product.json'),product);await writeFile(join(root,directory,'source-currency-public-code.json'),currencyBytes);await writeFile(join(root,directory,'source-inspection.json'),inspectionBytes);
await writeJson(join(root,directory,'manifest.json'),{version,kind:'real-source-offline-product-creation-fields-not-page-render-package-or-commerce-acceptance',sourcePath:product.sourcePath,proposedTargetPath:product.proposedTargetPath,files:{'product.json':digest(await readFile(join(root,directory,'product.json'))),'description.html':digest(descriptions[0].html),'source-currency-public-code.json':digest(currencyBytes),'source-inspection.json':digest(inspectionBytes)},sourceRows,primaryImage:product.fields.primaryImage.targetBinding,sourceCurrencyCodeProductFieldObserved:false,sourceStorefrontDefaultUsdObserved:true,nativeProductId:null,sourceCatalogBound:false,productsCreated:false,sourceCartSubmitted:false,targetReady:false,published:false});
console.log(JSON.stringify({version,directory,descriptionCharacters:descriptions[0].html.length,threeDeviceStaticHtmlIdentical:true,hostedPrimaryVerified:true,currency:'source-public-default-USD-product-record-unobserved',remoteModified:false}));
