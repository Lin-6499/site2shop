import type {Page} from 'playwright';
import {digest} from './artifacts.js';

export type SourceContextPolicy={mode:'isolated-guest'};
export type SourceContextProof={mode:'isolated-guest';policySha256:string;ownedContext:true;registeredTransport:true;copiedClearanceCookieNames:string[];applicationCookiesCopied:false;storageStateImported:false;apiGetOnly:true;webSocketsBlocked:true;authStorageKeyPresence?:{key:'mall-auth-token';present:false;valuesRead:false}};
export function validateSourceContext(value:unknown):SourceContextPolicy|undefined{
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||(value as any).mode!=='isolated-guest')throw Error('Only explicit sourceContext isolated-guest is supported');
 return{mode:'isolated-guest'};
}
export function sourceContextPolicy(sourceUrl:string,value:unknown){
 const policy=validateSourceContext(value);return policy?digest(JSON.stringify({version:'isolated-guest-v1',origin:new URL(sourceUrl).origin,...policy,applicationCookiesCopied:false,storageStateImported:false,apiMethods:['GET'],webSocketsBlocked:true})):null;
}
export function isolatedGuestContextPolicyHash(sourceUrl:string){return sourceContextPolicy(sourceUrl,{mode:'isolated-guest'})!;}
const isolatedPages=new WeakMap<Page,any>();
export function registerSourceContextPage(page:Page,proof:any){if(proof)isolatedPages.set(page,proof);}
export function isIsolatedGuestPage(page:Page){return isolatedPages.has(page);}
export async function observeSourceContext(page:Page,sourceUrl:string,config:unknown){
 const policy=sourceContextPolicy(sourceUrl,config);if(!policy)return undefined;
 if(new URL(page.url()).origin!==new URL(sourceUrl).origin)throw Error('Isolated guest presence requires the declared source origin');
 const proof=isolatedPages.get(page);verifySourceContextProof(sourceUrl,config,proof,false);
 const presence=await page.evaluate(()=>{let present=false;for(let i=0;i<localStorage.length;i++)if(localStorage.key(i)==='mall-auth-token')present=true;return{key:'mall-auth-token',present,valuesRead:false};});
 if(presence.present)throw Error('Isolated guest context has an application authentication key');
 return{...proof,authStorageKeyPresence:presence};
}
export function verifySourceContextProof(sourceUrl:string,config:unknown,proof:any,requirePresence=true){
 const policy=sourceContextPolicy(sourceUrl,config);
 if(!policy){if(proof)throw Error('Undeclared isolated source context proof');return;}
 if(!proof||proof.mode!=='isolated-guest'||proof.policySha256!==policy||proof.ownedContext!==true||proof.registeredTransport!==true||proof.applicationCookiesCopied!==false||proof.storageStateImported!==false||proof.apiGetOnly!==true||proof.webSocketsBlocked!==true||!Array.isArray(proof.copiedClearanceCookieNames)||proof.copiedClearanceCookieNames.some((name:any)=>!['cf_clearance','__cf_bm','_cfuvid'].includes(name)))throw Error('Isolated guest context proof missing or changed');
 if(requirePresence&&!proof.authStorageKeyPresence||proof.authStorageKeyPresence&&(proof.authStorageKeyPresence.key!=='mall-auth-token'||proof.authStorageKeyPresence.present!==false||proof.authStorageKeyPresence.valuesRead!==false))throw Error('Isolated guest authentication presence proof changed');
}
