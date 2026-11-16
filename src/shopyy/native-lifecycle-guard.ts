/** Shared, emitted native draft lifecycle safety. No commerce, route, or CSS policy is invented here. */
export const NATIVE_LIFECYCLE_GUARD_SOURCE=String.raw`function nativeLifecycleGuard(options){
 'use strict';
 const {host,payloads,snapshots,validate,onInvalid,ownerRoot,observedNodes=[]}=options;
 const hostId=host?.id,payloadIds=Array.isArray(payloads)?payloads.map(p=>p?.id):[];let stopped=false,observer=null;const listeners=[];
 const disconnect=()=>{if(stopped)return;stopped=true;if(observer)observer.disconnect();for(const [node,type,fn,capture]of listeners)node.removeEventListener(type,fn,capture);};
 const invalidate=reason=>{if(stopped)return false;disconnect();if(host?.removeAttribute)host.removeAttribute('data-ready');if(typeof hostId==='string'&&hostId)document.querySelectorAll('[id="'+CSS.escape(hostId)+'"]').forEach(n=>n.removeAttribute('data-ready'));try{onInvalid(reason);}catch{}return false;};
 const unique=node=>node?.isConnected&&typeof node.id==='string'&&node.id&&document.querySelectorAll('[id="'+CSS.escape(node.id)+'"]').length===1&&document.getElementById(node.id)===node;
 const check=(reason='lifecycle-context-or-payload')=>{if(stopped)return false;try{if(host.id!==hostId||!unique(host)||!ownerRoot?.isConnected||!ownerRoot.contains(host)||!Array.isArray(payloads)||!payloads.length||!Array.isArray(snapshots)||snapshots.length!==payloads.length||new Set(payloads).size!==payloads.length||payloads.some((p,i)=>!(p instanceof HTMLTemplateElement)||p.id!==payloadIds[i]||!unique(p)||!ownerRoot.contains(p)||typeof snapshots[i]!=='string'||p.innerHTML!==snapshots[i])||typeof validate!=='function'||validate()!==true)return invalidate(reason);return true;}catch{return invalidate(reason);}};
 const listen=(node,type,fn,capture=false)=>{node.addEventListener(type,fn,capture);listeners.push([node,type,fn,capture]);};
 if(!check('initial-lifecycle-context-or-payload'))return{check,disconnect};
 observer=new MutationObserver(()=>check('post-ready-context-or-payload'));
 observer.observe(ownerRoot,{subtree:true,childList:true,characterData:true,attributes:true});
 if(document.head)observer.observe(document.head,{subtree:true,childList:true,characterData:true,attributes:true});
 for(const p of payloads)observer.observe(p.content,{subtree:true,childList:true,characterData:true,attributes:true});
 for(const node of observedNodes)if(node&&typeof node.nodeType==='number')observer.observe(node,{subtree:true,childList:true,characterData:true,attributes:true});
 const beforeInteraction=event=>{if(!check('owned-interaction-context-or-payload')){event.preventDefault();event.stopImmediatePropagation();}};
 for(const type of ['click','submit','change'])listen(host,type,beforeInteraction,true);
 for(const type of ['popstate','hashchange'])listen(window,type,()=>check('navigation-context-or-payload'));
 return{check,disconnect};
}`;
export type NativeLifecycleGuardExpressions={hostExpression:string;payloadsExpression:string;snapshotsExpression:string;validateExpression:string;onInvalidExpression:string;ownerRootExpression:string;additionalObservedNodesExpressions?:string[]};
/** Expressions are generator-owned JavaScript, never merchant input or captured source scripts. */
export function emitNativeLifecycleGuard(o:NativeLifecycleGuardExpressions):string{
 for(const value of [o.hostExpression,o.payloadsExpression,o.snapshotsExpression,o.validateExpression,o.onInvalidExpression,o.ownerRootExpression,...o.additionalObservedNodesExpressions||[]])if(typeof value!=='string'||!value.trim())throw Error('Explicit generator-owned lifecycle expressions required');
 return '('+NATIVE_LIFECYCLE_GUARD_SOURCE+')({host:('+o.hostExpression+'),payloads:('+o.payloadsExpression+'),snapshots:('+o.snapshotsExpression+'),validate:('+o.validateExpression+'),onInvalid:('+o.onInvalidExpression+'),ownerRoot:('+o.ownerRootExpression+'),observedNodes:['+(o.additionalObservedNodesExpressions||[]).map(v=>'('+v+')').join(',')+']})';
}
