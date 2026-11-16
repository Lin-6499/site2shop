import {dirname,join,resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {load} from 'cheerio';
import {digest,jsonFile,writeJson} from '../src/shopyy/artifacts.js';
const root=dirname(resolve(process.argv[2])),file='verification/recon-current/inspections/collection-native-catalog-current-r1/component-inspection-26315ce1e935.json',bytes=await readFile(join(root,file)),inspection=JSON.parse(bytes.toString());
if(!inspection.passed||inspection.rows.length!==3||inspection.rows.some((r:any)=>!r.passed))throw Error('Current three-device catalog inventory required');
const devices:any[]=[];
for(const row of inspection.rows){
 const data=await readFile(join(root,row.structure.path));if(digest(data)!==row.structure.sha256)throw Error('Inventory changed');const source=JSON.parse(data.toString()),$=load(source.structure),cards:any[]=[];
 $('a[href^="/product/"]').filter((_,n)=>!!$(n).text().trim()).each((_,n)=>{
  const anchor=$(n),card=anchor.closest('div.group');if(!card.length||card.find('a[href^="/product/"]').length!==2)return;
  const href=anchor.attr('href')!,text=card.text(),prices=text.match(/\$\d+\.\d{2}/g)||[],image=card.find('img').first();
  if(cards.some(c=>c.sourcePath===href))throw Error('Duplicate catalog product card');
  const categories=card.find('p').map((_,p)=>$(p).text().trim()).get().filter(t=>t.includes(' · '));
  cards.push({sourcePath:href,title:anchor.text().trim(),categoryAndAmount:categories[0]||null,priceLabels:prices,cardPrice:prices.at(-1)||null,compareAt:prices.length>1?prices[0]:null,comingSoon:card.find('button').text().includes('Coming Soon')||/Coming Soon/i.test(text),newBadge:card.find('span').filter((_,s)=>$(s).text()==='NEW').length>0,image:{src:image.attr('src')||null,alt:image.attr('alt')||null},sourceCardHtmlSha256:digest($.html(card))});
 });
 if(cards.length!==74)throw Error('Current catalog does not have 74 exact product cards: '+cards.length);
 const sections=$('section').map((index,n)=>({observedOrder:index,heading:$(n).find('h1,h2,h3').first().text()||null,htmlSha256:digest($.html(n)),text:$(n).text().replace(/\s+/g,' ').trim(),images:$(n).find('img').map((_,i)=>({src:$(i).attr('src'),alt:$(i).attr('alt')})).get(),controls:$(n).find('button,select,input,a[href]').map((_,c)=>({tag:c.tagName,name:$(c).attr('aria-label')||$(c).text().replace(/\s+/g,' ').trim(),placeholder:$(c).attr('placeholder')||null,href:$(c).attr('href')||null,type:$(c).attr('type')||null,options:$(c).is('select')?$(c).find('option').map((_,o)=>({value:$(o).attr('value'),label:$(o).text(),selected:$(o).attr('selected')!==undefined})).get():undefined})).get()})).get();
 devices.push({viewport:row.viewport,evidence:row.structure,capturedAt:source.capturedAt,screenshot:source.screenshot,cards,sections});
}
const canonical=(rows:any[])=>JSON.stringify(rows.map(({sourceCardHtmlSha256,...r})=>r)),same=devices.every(d=>canonical(d.cards)===canonical(devices[0].cards));
if(!same)throw Error('Catalog product public fields disagree by device');
const old=await jsonFile(join(root,'staging/handoff-inputs/r1-core-inner-inputs-4a07a348744b/product/data.json')),oldByPath=new Map(old.catalog.products.map((p:any)=>[p.sourcePath,p]));
const products=devices[0].cards.map((c:any)=>{const previous:any=oldByPath.get(c.sourcePath);return {...c,evidence:devices.map(d=>({viewport:d.viewport,ref:d.evidence})),detailFieldsVerified:c.sourcePath==='/product/bpc-157',nativeProductId:null,nativeStatusOnCreation:0,stockCount:null,weight:null,sourceSku:null,additionalOptions:null,oldTitle:previous?.title||null,titleChangedFromPrior:!!previous&&previous.title!==c.title,currentPriceImageCardObserved:true,fullProductAcceptance:false};});
await writeJson(join(root,'verification/native-catalog-plan/current-collection-inventory.json'),{schemaVersion:1,kind:'current-three-device-readonly-source-catalog-and-section-inventory-not-planned-state-acceptance',sourcePath:'/shop',inspection:{file,sha256:digest(bytes)},devices,threeDevicePublicProductFieldsIdentical:same,productCount:74,newSection:'Ways to Save',old60StateComparisonInheritanceAllowed:false,wholePageAccepted:false,nativeReady:false,sourceCartSubmitted:false,published:false});
await writeJson(join(root,'verification/native-catalog-plan/current-catalog-public-fields.json'),{kind:'actual-current-catalog-public-product-fields-not-full-SKU-contract-or-commerce-binding',products,productCount:products.length,evidence:devices.map(d=>({viewport:d.viewport,ref:d.evidence})),threeDeviceFieldsIdentical:true,creationScope:'Only source-observed names/base card amounts/prices/images may seed offline native records; no invented SKU/stock/weight/options. BPC detail fields and static description have an independent fixed package; other73 detail descriptions/options still pending.',catalogAccepted:false,productsCreated:false,published:false});
console.log(JSON.stringify({productCount:74,threeDeviceFieldsIdentical:same,changedTitles:products.filter((p:any)=>p.titleChangedFromPrior).map((p:any)=>({sourcePath:p.sourcePath,old:p.oldTitle,current:p.title})),sections:devices[0].sections.length,old60Inherited:false}));
