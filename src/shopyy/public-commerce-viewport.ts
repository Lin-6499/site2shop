import type {Page} from 'playwright';
/** Prime once per document; only a source observer reset/remount permits another real resize. */
export async function preparePublicCommerceViewport(page:Page,enabled:boolean){
 if(!enabled)return undefined;
 const key='site2shop.capture.publicCommerceViewport';
 const existing=await page.evaluate(key=>{const state=(window as any)[Symbol.for(key)];if(!state)return null;const node=document.querySelector<HTMLElement>('.customer-service-widget'),properties=['--chat-visual-viewport-height','--chat-visual-viewport-width','--chat-visual-viewport-offset-top','--chat-visual-viewport-offset-left'];const reset=!!node&&state.proof.viewportObserver.initialized&&properties.some(name=>!node.style.getPropertyValue(name));return{proof:state.proof,refresh:!!node&&(node!==state.observerNode||reset),reason:node!==state.observerNode?'observer-remounted':reset?'observer-variables-cleared':null};},key);if(existing&&!existing.refresh)return existing.proof;
 const sample=()=>page.evaluate(()=>({innerWidth,innerHeight,clientWidth:document.documentElement.clientWidth,clientHeight:document.documentElement.clientHeight,scrollX,scrollY,screenWidth:screen.width,screenHeight:screen.height,availableWidth:screen.availWidth,availableHeight:screen.availHeight,dpr:devicePixelRatio,visualViewport:visualViewport?{width:visualViewport.width,height:visualViewport.height,offsetTop:visualViewport.offsetTop,offsetLeft:visualViewport.offsetLeft,scale:visualViewport.scale}:null}));
 const frame=()=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 const before=await sample();let step:any,restored:any,primary:unknown;
 try{await page.setViewportSize({width:before.innerWidth,height:before.innerHeight+1});await frame();step=await sample();if(step.innerWidth!==before.innerWidth||step.innerHeight!==before.innerHeight+1)throw Error('Actual public commerce viewport step differs');}catch(error){primary=error;}
 finally{await page.setViewportSize({width:before.innerWidth,height:before.innerHeight});await frame();restored=await sample();}
 if(primary)throw primary;
 if(JSON.stringify(restored)!==JSON.stringify(before))throw Error('Public commerce viewport normalization did not restore actual context');
 const viewportObserver=await page.evaluate(()=>{const node=document.querySelector<HTMLElement>('.customer-service-widget'),properties=Object.fromEntries(['--chat-visual-viewport-height','--chat-visual-viewport-width','--chat-visual-viewport-offset-top','--chat-visual-viewport-offset-left'].map(name=>[name,node?.style.getPropertyValue(name)||'']));return{selector:'.customer-service-widget',present:!!node,properties,initialized:!!node&&Object.values(properties).every(Boolean)};});
 const proof={kind:'real-viewport-resize-and-restore-for-observed-widget',preparedAt:new Date().toISOString(),...(existing?{reprimeReason:existing.reason,previousPreparedAt:existing.proof.preparedAt}:{}),viewportObserver,before,step,restored};await page.evaluate(({key,proof})=>{(window as any)[Symbol.for(key)]={proof,observerNode:document.querySelector('.customer-service-widget')};},{key,proof});return proof;
}
export async function publicCommerceViewportProof(page:Page){return page.evaluate(()=>(window as any)[Symbol.for('site2shop.capture.publicCommerceViewport')]?.proof||null);}
