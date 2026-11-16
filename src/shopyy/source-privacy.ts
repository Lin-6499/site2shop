import type {Page} from 'playwright';
import {digest,canonical} from './artifacts.js';

/** An explicit privacy projection, never an assertion that an account workflow was replicated. */
export function sourcePrivacyBoundaries(project:any,path:string){
 const entries=project.workflow?.sourcePrivacyBoundaries||[];
 if(!Array.isArray(entries)||entries.length>10)throw Error('Invalid source privacy policy');
 return entries.filter((b:any)=>b.sourcePath===path).map((b:any)=>{
  if(!b.id||!b.selector||b.kind!=='private-account'||!b.reason)throw Error('Incomplete source privacy boundary');
  return {id:b.id,selector:b.selector,kind:b.kind,reason:b.reason,readySelector:b.readySelector||null};
 });
}
export function sourcePrivacyPolicy(project:any,path:string){const b=sourcePrivacyBoundaries(project,path);return b.length?digest(canonical({version:1,boundaries:b})):null;}
export async function projectSourcePrivacy(page:Page,project:any){
 const url=new URL(page.url()),boundaries=sourcePrivacyBoundaries(project,url.pathname+url.search),rows:any[]=[];
 for(const boundary of boundaries){
  const locator=page.locator(boundary.selector);
  const already=await locator.count()===1&&await locator.getAttribute('data-vr-private-source-boundary')===boundary.id;
  if(!already&&boundary.readySelector)await page.locator(boundary.readySelector).waitFor({state:'visible',timeout:15000});
  if(await locator.count()!==1)throw Error('Source private region is missing or ambiguous');
  // Keep original layout; erase text, attributes, form values and descendants before any
  // observations/snapshots. Stop late React hydration from reinserting private identity.
  const geometry=await locator.evaluate((node,boundary)=>{
   const box=node.getBoundingClientRect(),parent=node.parentElement;if(!parent)throw Error('Private region has no parent');
   const placeholder=document.createElement(node.tagName);placeholder.id=node.id;
   placeholder.className=node.className;
   placeholder.setAttribute('data-vr-private-source-boundary',boundary.id);
   placeholder.setAttribute('aria-label','Private account region redacted');
   placeholder.style.cssText=`box-sizing:border-box;width:${box.width}px;height:${box.height}px;max-width:100%;overflow:hidden;`;
   parent.replaceChild(placeholder,node);
   return {width:box.width,height:box.height};
  },boundary);
  rows.push({id:boundary.id,selector:boundary.selector,kind:boundary.kind,geometry,scope:'redacted-account-boundary-not-workflow-acceptance'});
 }
 await assertNoPrivateSourceIdentity(page,project);
 return {sourcePrivacyPolicySha256:sourcePrivacyPolicy(project,url.pathname+url.search),privacyProjection:rows};
}

/** Inspect the existing SDK identity in browser memory only; never export its values. */
export async function assertNoPrivateSourceIdentity(page:Page,project:any){
 const key=project.workflow?.sourceSession?.enabled&&project.workflow.sourceSession.sessionStorageKey;
 if(!key)return;
 const safe=await page.evaluate(key=>{
  try{const user=JSON.parse(localStorage.getItem(key)||'null')?.user;if(!user)return true;
   const privateValues=[user.email,user.id].filter(v=>typeof v==='string'&&v.length>=8);
   const body=document.body.cloneNode(true) as HTMLElement;body.querySelectorAll('script,noscript').forEach(n=>n.remove());
   const html=body.innerHTML.toLowerCase();return !privateValues.some(v=>html.includes(v.toLowerCase()));
  }catch{return false;}
 },key);
 if(!safe)throw Error('Private source identity remains outside its declared redaction boundary; no evidence may be saved');
}
