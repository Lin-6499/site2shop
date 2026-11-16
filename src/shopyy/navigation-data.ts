import type {Page} from 'playwright';
import {canonical,digest,readRef,contained} from './artifacts.js';
import {readFile} from 'node:fs/promises';
import {applies,type Plan,type Ref} from './contracts.js';
import type {VerifiedMediaAssets} from './media-comparison.js';
import {load} from 'cheerio';
import {resolveCapturedStockField,validateProductsAvailabilitySource,type ProductsAvailabilitySource} from './stock-controls.js';

export type StaticDataField={ref:Ref;pointer:string;decodedPointer?:string;textSelector?:'#purchase-stock-status'};
export type CapturedStockDataField={kind:'captured-stock';route:string;viewport:string;state:string;sourceProductId:number;warehouseCode:string;availabilitySource?:ProductsAvailabilitySource;observed:StaticDataField};
export type DataField=StaticDataField|CapturedStockDataField;
const capturedStock=(field:any):field is CapturedStockDataField=>field?.kind==='captured-stock';
type Format='identity'|'text'|'usd'|{kind:'enum';values:Record<string,string|boolean|number|null>};
export type NavigationDataAssertion={field:'title'|'warehouse'|'price'|'stock'|'hero';source:DataField;sourceEquals?:{left:DataField;right:DataField}[];format?:Format;target:{selector:string;read:'text'|'own-text'|'value'|'attribute'|'media';attribute?:string}};
const pointer=(value:any,path:string)=>{
 if(typeof path!=='string'||path!==''&&!path.startsWith('/'))throw Error('Invalid public data JSON pointer');
 for(const key of path===''?[]:path.slice(1).split('/').map(k=>k.replace(/~1/g,'/').replace(/~0/g,'~'))){if(value===null||typeof value!=='object'||!Object.hasOwn(value,key))throw Error('Public data pointer missing');value=value[key];}return value;
};
export async function readDataField(root:string,field:DataField){
 if(capturedStock(field))throw Error('Captured stock needs its current verified source Capture; no static fallback');
 const document=JSON.parse((await readRef(root,field.ref)).toString());let value=pointer(document,field.pointer);
 if(field.decodedPointer!==undefined){if(typeof value!=='string')throw Error('Encoded public data must be an actual JSON string');value=pointer(JSON.parse(value),field.decodedPointer);}
 if(field.textSelector!==undefined){if(field.textSelector!=='#purchase-stock-status'||!['/structure','/bodyHtml'].includes(field.pointer)||document.status!==200||typeof value!=='string')throw Error('Invalid actual public stock DOM field');const $=load(value),node=$(field.textSelector);if(node.length!==1)throw Error('Actual public stock node missing/ambiguous');value=node.text().trim().replace(/\s+/g,' ');}
 if(value!==null&&!['string','number','boolean'].includes(typeof value))throw Error('Public data assertion requires a scalar leaf');return value;
}
async function sourceValue(root:string,assertion:NavigationDataAssertion){
 if(assertion.sourceEquals!==undefined){if(assertion.field!=='hero'||!Array.isArray(assertion.sourceEquals)||assertion.sourceEquals.length!==1)throw Error('Hero association requires one explicit source equality');for(const pair of assertion.sourceEquals){const left=await readDataField(root,pair.left),right=await readDataField(root,pair.right);if(typeof left!=='string'||!left||left!==right)throw Error('Observed hero/public response association differs');}}
 // The observed leaf is only a planning enum/locale dictionary, never the runtime stock value.
 return readDataField(root,capturedStock(assertion.source)?assertion.source.observed:assertion.source);
}
export async function verifyNavigationDataSources(root:string,mapping:any,plan?:Plan){const errors=navigationDataErrors(mapping.dataAssertions);if(errors.length)throw Error(errors.join('; '));for(const assertion of mapping.dataAssertions||[]){if(capturedStock(assertion.source)){const source=assertion.source,state=plan?.routes[source.route]?.states[source.state];if(!plan?.viewports[source.viewport]||!state||!applies(state,source.viewport))throw Error('Captured stock representative route/state/viewport is not declared in this plan');}const value=await sourceValue(root,assertion);if(assertion.field!=='hero')format(value,assertion.format);}}
function format(value:any,rule:Format='identity'){
 if(rule==='identity')return value;
 if(rule==='text'){if(typeof value!=='string')throw Error('Public text field missing');return value.trim().replace(/\s+/g,' ');}
 if(rule==='usd'){if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('Public USD price must be an observed finite number');return '$'+value.toFixed(2);}
 if(rule?.kind==='enum'&&rule.values&&Object.keys(rule.values).length<=32&&Object.hasOwn(rule.values,String(value))){const mapped=rule.values[String(value)];if(mapped===null||['string','number','boolean'].includes(typeof mapped))return mapped;}
 throw Error('Unsupported/unmapped public data format');
}
export function navigationDataErrors(value:unknown){
 if(value===undefined)return[];
 if(!Array.isArray(value)||!value.length||value.length>5)return['Navigation data assertions must contain 1..5 explicit fields'];
 const fields=new Set();return value.flatMap(a=>{const errors=[];if(!['title','warehouse','price','stock','hero'].includes(a?.field)||fields.has(a.field))errors.push('Invalid/duplicate navigation data field');fields.add(a?.field);const isCaptured=capturedStock(a.source),source=isCaptured?a.source.observed:a.source;if(isCaptured){try{validateProductsAvailabilitySource(a.source.availabilitySource,a.source.warehouseCode);}catch{errors.push('Invalid captured-stock products availability declaration');}}if(isCaptured&&(a.field!=='stock'||a.sourceEquals!==undefined||!['route','viewport','state','warehouseCode'].every(key=>typeof a.source[key]==='string'&&a.source[key].length>0)||!Number.isSafeInteger(a.source.sourceProductId)||a.source.sourceProductId<=0||!['CNFC','USFC','AUSFC'].includes(a.source.warehouseCode)||a.format?.kind!=='enum'))errors.push('Captured stock requires exact route/state/viewport/product/warehouse and observed locale enum');if(!source?.ref||typeof source.pointer!=='string'||!a.target?.selector||!['text','own-text','value','attribute','media'].includes(a.target.read)||a.target.read==='attribute'&&!/^[\w:-]+$/.test(a.target.attribute||'')||a.field==='hero'&&a.target.read!=='media')errors.push('Explicit navigation source leaf and target reader required');return errors;});
}
async function onlineManifest(root:string,project:any){
 const file=project.workflow?.routeDataBindingsFile;if(typeof file!=='string'||!file)throw Error('needs-target: actual native product/variant data bindings missing');
 const data=JSON.parse(await readFile(await contained(root,file),'utf8'));if(data.schemaVersion!==1||!/^\d+$/.test(String(data.storeId))||!data.bindings||Array.isArray(data.bindings))throw Error('Invalid native data binding manifest');return{file,data};
}
async function nativeField(root:string,assertion:NavigationDataAssertion,row:any,store:string){
 if(!row?.field||!row.bindingEvidence)throw Error('needs-target: native '+assertion.field+' readback/mapping missing');
 const binding=JSON.parse((await readRef(root,row.bindingEvidence)).toString()),document=JSON.parse((await readRef(root,row.field.ref)).toString());
 if(binding.kind!=='native-product-field-binding'||String(binding.storeId)!==store||binding.field!==assertion.field||canonical(binding.source)!==canonical(assertion.source)||canonical(binding.target)!==canonical(row.field)||!binding.product?.id||String(pointer(document,binding.product.idPointer))!==String(binding.product.id)||String(pointer(document,binding.product.storePointer))!==store)throw Error('needs-target: actual native product/store ownership differs');
 if(['warehouse','price','stock'].includes(assertion.field)){const variant=binding.variant;if(!variant?.id||!variant.skuCode||String(pointer(document,variant.idPointer))!==String(variant.id)||pointer(document,variant.skuPointer)!==variant.skuCode)throw Error('needs-target: actual native variant/SKU ownership missing');}
 return readDataField(root,row.field);
}
async function expectations(root:string,project:any,path:string,mapping:any,stage:'preflight'|'online',store:string|undefined,assets?:VerifiedMediaAssets){
 const assertions:NavigationDataAssertion[]=mapping.dataAssertions||[];const errors=navigationDataErrors(mapping.dataAssertions);if(errors.length)throw Error(errors.join('; '));
 const manifest=stage==='online'&&assertions.length?await onlineManifest(root,project):null;if(manifest&&String(manifest.data.storeId)!==store)throw Error('needs-target: native data binding store differs from draft');
 const rows=[];for(const assertion of assertions){const sourceObservation=capturedStock(assertion.source)?await resolveCapturedStockField(root,project,assertion.source):undefined,source=sourceObservation?sourceObservation.value:await sourceValue(root,assertion),binding=manifest?.data.bindings[path]?.[assertion.field],target=manifest?await nativeField(root,assertion,binding,store!):source;
  const sourceExpected=assertion.target.read==='media'?assets?.source.get(String(source)):format(source,assertion.format),targetExpected=assertion.target.read==='media'?(manifest?assets?.target.get(String(target)):sourceExpected):format(target,manifest?binding.format??assertion.format:assertion.format);
  if(assertion.target.read==='media'&&(!sourceExpected||!targetExpected)||canonical(sourceExpected)!==canonical(targetExpected))throw Error('needs-target: '+assertion.field+' native/source content differs or is unverified');
  rows.push({assertion,sourceExpected,targetExpected,sourceObservation});
 }return{rows,policySha256:digest(canonical(rows.some(r=>r.sourceObservation)?{assertions,sourceObservations:rows.map(r=>r.sourceObservation??null)}:assertions))};
}
export async function readNavigationData(page:Page,root:string,project:any,path:string,mapping:any,stage:'preflight'|'online',store?:string,assets?:VerifiedMediaAssets){
 if(mapping.dataAssertions===undefined)return undefined;
 const policy=await expectations(root,project,path,mapping,stage,store,assets),rows=[];
 for(const {assertion,sourceExpected,targetExpected,sourceObservation}of policy.rows){const reader=assertion.target,locator=page.locator(reader.selector);let actual:any=null,error:string|undefined;
  try{if(await locator.count()!==1)throw Error('Target data selector must resolve exactly once');
   if(reader.read==='text')actual=(await locator.innerText()).trim().replace(/\s+/g,' ');
   else if(reader.read==='own-text')actual=await locator.evaluate(node=>[...node.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim().replace(/\s+/g,' '));
   else if(reader.read==='value')actual=await locator.inputValue();
   else if(reader.read==='attribute'){actual=await locator.getAttribute(reader.attribute!);if(actual===null)throw Error('Target data attribute missing');}
   else{const image=await locator.evaluate(node=>node instanceof HTMLVideoElement?{src:node.currentSrc||node.src,loaded:node.readyState>=2}:node instanceof HTMLImageElement?{src:node.currentSrc||node.src,loaded:node.complete&&node.naturalWidth>0}:null);if(!image)throw Error('Target media element missing');actual={...image,contentSha256:assets?.target.get(image.src)||null};}
  }catch{error='Actual target '+assertion.field+' could not be read';}
  const compared=reader.read==='media'?actual?.loaded?actual.contentSha256:null:actual;rows.push({field:assertion.field,target:reader,sourceExpected,targetExpected,actual,...(sourceObservation?{sourceObservation}:{}),...(error?{error}:{}),passed:!error&&canonical(compared)===canonical(sourceExpected)&&canonical(compared)===canonical(targetExpected)});
 }return{policySha256:policy.policySha256,rows,passed:rows.every(row=>row.passed)};
}
export async function verifyNavigationData(root:string,project:any,path:string,mapping:any,proof:any,stage:'preflight'|'online',store?:string,assets?:VerifiedMediaAssets){
 if(mapping.dataAssertions===undefined){if(proof)throw Error('Undeclared navigation data evidence');return;}
 const policy=await expectations(root,project,path,mapping,stage,store,assets);if(proof?.policySha256!==policy.policySha256||!Array.isArray(proof.rows)||proof.rows.length!==policy.rows.length)throw Error('Navigation data policy/evidence missing or changed');
 for(const [i,expected]of policy.rows.entries()){const row=proof.rows[i],reader=expected.assertion.target;let actual=row.actual;if(reader.read==='media'){if(!actual?.loaded||assets?.target.get(actual.src)!==actual.contentSha256)throw Error('Unverified navigation hero media');actual=actual.contentSha256;}
  if(row.field!==expected.assertion.field||canonical(row.target)!==canonical(reader)||canonical(row.sourceObservation)!==canonical(expected.sourceObservation)||canonical(row.sourceExpected)!==canonical(expected.sourceExpected)||canonical(row.targetExpected)!==canonical(expected.targetExpected)||row.error||row.passed!==true||canonical(actual)!==canonical(expected.sourceExpected)||canonical(actual)!==canonical(expected.targetExpected))throw Error('Navigation data mismatch: '+expected.assertion.field);
 }
 if(proof.passed!==true)throw Error('Navigation data checks did not pass');
}
export async function routeDataBindingInputFiles(root:string,project:any){
 if(!project.workflow?.routeDataBindingsFile)return[];const {file,data}=await onlineManifest(root,project),files=[file];
 for(const fields of Object.values<any>(data.bindings))for(const row of Object.values<any>(fields)){const binding=JSON.parse((await readRef(root,row.bindingEvidence)).toString());await readRef(root,row.field.ref);files.push(row.bindingEvidence.path,row.field.ref.path);if(canonical(binding.target)!==canonical(row.field))throw Error('Native binding readback Ref differs');}
 return[...new Set(files)];
}
