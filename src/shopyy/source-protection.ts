import type {Page} from 'playwright';
import {renderedEvidenceRejection,type RenderedEvidenceIdentity} from '../rendered-page-validity.js';

export type SourceProtection={reason:'http-403'|'http-429'|'anti-bot-challenge';status:number|null;origin:string;path:string;queryKeys:string[];detectedAt:string};
export function sourceProtectionReason(identity:RenderedEvidenceIdentity){
 if(identity.status===403)return 'http-403' as const;
 if(identity.status===429)return 'http-429' as const;
 return renderedEvidenceRejection({...identity,status:undefined})==='anti-bot challenge page'?'anti-bot-challenge' as const:null;
}
/** Coarse protection identity only. No body, input, cookie or query values are persisted. */
export async function observeSourceProtection(page:Page,sourceUrl:string,status?:number,cfMitigated?:string|null):Promise<SourceProtection|null>{
 try{
  const url=new URL(page.url());if(url.origin!==new URL(sourceUrl).origin)return null;
  const responseReason=sourceProtectionReason({status,cfMitigated});
  if(responseReason)return{reason:responseReason,status:status??null,origin:url.origin,path:url.pathname,queryKeys:[...url.searchParams.keys()],detectedAt:new Date().toISOString()};
  const identity:RenderedEvidenceIdentity={status,cfMitigated,title:await page.title(),visibleText:await page.locator('body').innerText().catch(()=>''),challengeUiVisible:await page.locator('#challenge-running,#challenge-stage,#challenge-form,[id^="cf-chl-widget"],iframe[src*="/cdn-cgi/challenge-platform/"]').evaluateAll(nodes=>nodes.some(node=>{const r=node.getBoundingClientRect();if(!r.width||!r.height)return false;for(let p:Element|null=node;p;p=p.parentElement){const css=getComputedStyle(p);if(css.display==='none'||css.visibility==='hidden'||Number(css.opacity)===0)return false;}return true;}))};
  const reason=sourceProtectionReason(identity);return reason?{reason,status:status??null,origin:url.origin,path:url.pathname,queryKeys:[...url.searchParams.keys()],detectedAt:new Date().toISOString()}:null;
 }catch{return null;}
}
