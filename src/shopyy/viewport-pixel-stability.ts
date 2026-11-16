import {captureCaretScope} from './capture-caret.js';
import sharp from 'sharp';
import type {Page} from 'playwright';
import type {Ref} from './contracts.js';
import {canonical,digest,readRef,saveArtifact} from './artifacts.js';

export type ViewportPixelPolicy={maxRgbDelta:number;maxChangedPixelRatio:number};
export type ViewportPixelDifference={width:number;height:number;changedPixels:number;changedPixelRatio:number;maxDelta:number;alphaExact:boolean};
export type ViewportPixelProof={kind:'viewport-pixel-stability-v1';policySha256:string;frames:[Ref,Ref];difference:ViewportPixelDifference};
export function viewportPixelPolicy(project:any):ViewportPixelPolicy|null{
 const value=project.workflow?.viewportPixelStability;
 if(value===undefined)return null;
 if(!value||Object.keys(value).some(key=>!['maxRgbDelta','maxChangedPixelRatio'].includes(key))||!Number.isInteger(value.maxRgbDelta)||value.maxRgbDelta<0||value.maxRgbDelta>1||!Number.isFinite(value.maxChangedPixelRatio)||value.maxChangedPixelRatio<0||value.maxChangedPixelRatio>0.0005)throw Error('Invalid viewport pixel stability policy');
 return{maxRgbDelta:value.maxRgbDelta,maxChangedPixelRatio:value.maxChangedPixelRatio};
}
export async function viewportPixelDifference(first:Buffer,second:Buffer):Promise<ViewportPixelDifference>{
 const decode=async(bytes:Buffer)=>{const image=sharp(bytes);if((await image.metadata()).format!=='png')throw Error('Viewport stability frames must be PNG');return image.ensureAlpha().raw().toBuffer({resolveWithObject:true});};
 const [a,b]=await Promise.all([decode(first),decode(second)]);
 if(a.info.width!==b.info.width||a.info.height!==b.info.height)throw Error('Viewport stability frame dimensions differ');
 let changedPixels=0,maxDelta=0,alphaExact=true;
 for(let i=0;i<a.data.length;i+=4){let changed=false;for(let channel=0;channel<3;channel++){const delta=Math.abs(a.data[i+channel]-b.data[i+channel]);maxDelta=Math.max(maxDelta,delta);if(delta)changed=true;}if(a.data[i+3]!==b.data[i+3]){alphaExact=false;changed=true;}if(changed)changedPixels++;}
 return{width:a.info.width,height:a.info.height,changedPixels,changedPixelRatio:changedPixels/(a.info.width*a.info.height),maxDelta,alphaExact};
}
export function viewportPixelDifferenceAllowed(policy:ViewportPixelPolicy,difference:ViewportPixelDifference){return difference.alphaExact&&difference.maxDelta<=policy.maxRgbDelta&&difference.changedPixelRatio<=policy.maxChangedPixelRatio;}
export async function verifyViewportPixelProof(project:any,root:string,screenshot:Ref,proof?:ViewportPixelProof){
 const policy=viewportPixelPolicy(project);
 if(!policy){if(proof)throw Error('Unplanned viewport pixel stability proof');return;}
 if(!proof||proof.kind!=='viewport-pixel-stability-v1'||proof.policySha256!==digest(canonical(policy))||!Array.isArray(proof.frames)||proof.frames.length!==2||canonical(proof.frames[1])!==canonical(screenshot))throw Error('Missing/changed viewport pixel stability proof or screenshot');
 const [first,second]=await Promise.all(proof.frames.map(ref=>readRef(root,ref)));
 const difference=await viewportPixelDifference(first,second);
 if(canonical(difference)!==canonical(proof.difference)||!viewportPixelDifferenceAllowed(policy,difference))throw Error('Viewport pixel stability proof failed decoded verification');
}
/** Optional tolerance only selects an unmodified viewport frame; it never compares source to target. */
export async function stableViewportScreenshot(page:Page,evidenceRoot:string,project:any={}){
 const policy=viewportPixelPolicy(project);const caret=await captureCaretScope(page);try{let previous:Buffer|undefined;
 for(let attempt=0;attempt<8;attempt++){
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const current=await page.screenshot({fullPage:false,caret:'initial'});
  if(previous){
   if(!policy&&previous.equals(current))return{image:current};
   if(policy){const difference=await viewportPixelDifference(previous,current);if(viewportPixelDifferenceAllowed(policy,difference)){
    const frames=await Promise.all([saveArtifact(evidenceRoot,previous,'png'),saveArtifact(evidenceRoot,current,'png')]) as [Ref,Ref];
    const proof:ViewportPixelProof={kind:'viewport-pixel-stability-v1',policySha256:digest(canonical(policy)),frames,difference};return{image:current,proof};
   }}
  }
  if(attempt>=6)await saveArtifact(evidenceRoot,current,'png');
  previous=current;await page.waitForTimeout(100);
 }
 const animations=await page.evaluate(()=>document.getAnimations().map(a=>({state:a.playState,time:a.currentTime,name:a instanceof CSSAnimation?a.animationName:'web-animation',iterations:a.effect?.getTiming().iterations})));
 await saveArtifact(evidenceRoot,{kind:'unstable-viewport-diagnostic',animations});
 throw Error('Viewport pixels did not stabilize; screenshot requires investigation');
 }finally{await caret.close();}
}
