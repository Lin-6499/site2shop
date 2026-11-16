import type {Page} from 'playwright';
import {digest,canonical} from './artifacts.js';
import {stateMediaPolicy,waitStateMedia,sampleStateMedia,verifyStateMediaProof} from './source-state-adapter.js';

// Match operation names, not generic words such as "action", "id" or "compare"
// in arbitrary asset values. Resource type/extension never bypasses this denylist.
const normalize=(value:string)=>value.toLowerCase().replace(/[-.\s]+/g,'_');
const mutationNames=new Set(['add_to_cart','remove_from_cart','remove_cart_item','remove_item','undo_item','undo_cart_item','add_to_wishlist','remove_from_wishlist','add_to_compare','remove_from_compare','compare','logout','customer_logout','apply_coupon','remove_coupon','coupon','update_cart','empty_cart','clear_cart','checkout','process_checkout','update_order_review','update_shipping_method','save_account_details','save_address']);
const readAjax=new Set(['get_refreshed_fragments','get_variation','get_product','product_search']);

/** Null means no known URL mutation, not authorization for an unsafe method. */
export function sourceUrlMutationReason(raw:string):string|null {
  let url:URL;try{url=new URL(raw);}catch{return 'invalid-url';}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return 'unsafe-url';
  for(const [key,value] of url.searchParams){
    const name=normalize(key).replace(/\[.*$/,''),operation=normalize(value);
    if(mutationNames.has(name))return 'mutation-query';
    if(name==='wc_ajax'&&!readAjax.has(operation))return 'unreviewed-wc-ajax';
    if(['action','task','do'].includes(name)&&mutationNames.has(operation.replace(/^(woocommerce_|yith_woocompare_|yith_wcwl_)/,'')))return 'mutation-action';
    if(['action','task','do'].includes(name)&&/^(yith_woocompare|yith_wcwl)_(add|remove|delete|remove_all|add_to_wishlist|remove_from_wishlist)$/.test(operation))return 'mutation-plugin-action';
  }
  const segments=url.pathname.split('/').filter(Boolean).map(s=>{try{return normalize(decodeURIComponent(s));}catch{return '';}});
  if(segments.some(s=>mutationNames.has(s)||s==='wp_logout_php'))return 'mutation-endpoint';
  if(/\/cart\/(add|change|update|clear)(?:\.(?:js|json))?\/?$/i.test(url.pathname))return 'mutation-cart-endpoint';
  return null;
}
export function sourceSafeMethod(method:string){return ['GET','HEAD','OPTIONS'].includes(method);}

/** Project-owned, hash-bound media policy. Legacy sourceReadiness path->selector
 * maps remain owned by their existing discovery/inspection consumers. */
export function sourceReadinessPolicy(project:any,path:string,state?:string){
  const config=project.workflow?.sourceMediaReadiness;
  if(config===undefined)return null;
  if(config?.schemaVersion===2)return stateMediaPolicy(project,path,state);
  if(!config||config.schemaVersion!==1||typeof config.rationale!=='string'||!config.rationale.trim()||!Array.isArray(config.rules)||!config.rules.length)throw Error('Invalid explicit sourceMediaReadiness policy');
  for(const rule of config.rules){
    if(!Array.isArray(rule.paths)||!rule.paths.length||rule.paths.some((p:any)=>typeof p!=='string'||!/^\/(?!\/)/.test(p)||/[#\\\s]/.test(p))||
      !Array.isArray(rule.absent)||rule.absent.some((s:any)=>typeof s!=='string'||!s.trim())||
      !Array.isArray(rule.requiredImages)||rule.requiredImages.some((r:any)=>typeof r.selector!=='string'||!r.selector.trim()||!Number.isInteger(r.minCount)||r.minCount<1)||
      !rule.absent.length&&!rule.requiredImages.length)throw Error('Invalid sourceMediaReadiness rule');
  }
  const rules=config.rules.filter((r:any)=>r.paths.includes(path));
  if(!rules.length)throw Error('Source readiness policy has no rule for current exact path');
  return {rules,sha256:digest(canonical(config))};
}
export async function waitSourceReadiness(page:Page,project:any,timeout:number,state?:string){
  const url=new URL(page.url()),policy=sourceReadinessPolicy(project,url.pathname+url.search,state);
  if(!policy)return null;
  if('rule'in policy){await waitStateMedia(page,policy,timeout);return policy.sha256;}
  await page.waitForFunction((rules:any[])=>rules.every(rule=>
    rule.absent.every((selector:string)=>document.querySelectorAll(selector).length===0)&&
    rule.requiredImages.every((spec:any)=>{
      const images=[...document.querySelectorAll(spec.selector)];
      return images.length>=spec.minCount&&images.every(image=>image instanceof HTMLImageElement&&image.complete&&image.naturalWidth>0&&image.naturalHeight>0);
    })),policy.rules,{timeout});
  return policy.sha256;
}

/** Immediate post-screenshot check: a later recovery cannot validate earlier pixels. */
export async function assertSourceReadiness(page:Page,project:any,state?:string){
  const url=new URL(page.url()),policy=sourceReadinessPolicy(project,url.pathname+url.search,state);
  if(!policy)return;
  if('rule'in policy){verifyStateMediaProof(policy,await sampleStateMedia(page,policy));return;}
  const ready=await page.evaluate((rules:any[])=>rules.every(rule=>
    rule.absent.every((selector:string)=>document.querySelectorAll(selector).length===0)&&
    rule.requiredImages.every((spec:any)=>{
      const images=[...document.querySelectorAll(spec.selector)];
      return images.length>=spec.minCount&&images.every(image=>image instanceof HTMLImageElement&&image.complete&&image.naturalWidth>0&&image.naturalHeight>0);
    })),policy.rules);
  if(!ready)throw Error('Source readiness changed during screenshot capture');
}

export function sourceNavigationOptions(project:any):{waitUntil:'commit'|'domcontentloaded'}{
  const config=project.workflow?.sourceNavigation;
  if(config===undefined)return {waitUntil:'domcontentloaded'};
  if(!['commit','domcontentloaded'].includes(config.waitUntil)||typeof config.rationale!=='string'||!config.rationale.trim()||typeof config.readySelector!=='string'||!config.readySelector.trim())throw Error('Explicit sourceNavigation requires rationale and semantic readySelector');
  return {waitUntil:config.waitUntil};
}
export async function waitSourceNavigation(page:Page,project:any,timeout:number){
  sourceNavigationOptions(project);
  if(project.workflow?.sourceNavigation)await page.locator(project.workflow.sourceNavigation.readySelector).waitFor({state:'visible',timeout});
}
