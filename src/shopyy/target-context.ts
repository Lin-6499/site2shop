import type{Page}from'playwright';
import{digest,canonical}from'./artifacts.js';
export type TargetStage='preflight'|'online';
export type StageTargets={preflight?:string;online?:string};
export const targetPathFor=(state:{paths:{target:string};targetPaths?:StageTargets},stage:TargetStage)=>state.targetPaths?.[stage]??state.paths.target;
export const mappedTargetPath=(mapping:{targetPath?:string;targetPaths?:StageTargets},stage:TargetStage)=>mapping.targetPaths?.[stage]??mapping.targetPath;
export function stageTargetErrors(value:unknown):string[]{
 if(value===undefined)return[];
 if(!value||typeof value!=='object'||Array.isArray(value))return['Target paths must be a stage object'];
 return Object.entries(value).flatMap(([stage,path])=>!['preflight','online'].includes(stage)||typeof path!=='string'||!path.startsWith('/')||path.startsWith('//')||path.includes('#')||/[\\\x00-\x20]/.test(path)||new URL(path,'https://owned.invalid').origin!=='https://owned.invalid'?['Invalid target path for stage '+stage]:[]);
}
export type TargetIdentityProof={mode:'dom-marker';buildId:string;configSha256:string;selector:string;attribute:string;markerCount:number;markerValue:string|null;headerBuildId:string|null};
function configured(project:any,stage:TargetStage){
 const value=stage==='online'?project.workflow?.onlineBuildIdentity:undefined;
 if(value===undefined)return null;
 if(value?.mode!=='dom-marker'||typeof value.selector!=='string'||!value.selector.trim()||!/^data-[a-z][a-z0-9-]*$/.test(value.attribute||''))throw Error('Explicit DOM build identity requires selector and data attribute');
 const context=value.context;
 if(!context||typeof context.origin!=='string'||new URL(context.origin).origin!==context.origin||new URL(context.origin).protocol!=='https:'||!/^\d+$/.test(context.skinId||''))throw Error('DOM build identity requires exact HTTPS draft origin and skinId');
 if(project.workflow?.onlineOrigin&&new URL(project.workflow.onlineOrigin).origin!==context.origin)throw Error('DOM identity origin differs from online target');
 return value;
}
function assertContext(url:string,config:any){const u=new URL(url);if(u.origin!==config.context.origin||Object.entries({theme_id:config.context.skinId,preview:'1',is_theme_edit:'1'}).some(([k,v])=>u.searchParams.getAll(k).length!==1||u.searchParams.get(k)!==v))throw Error('DOM build marker draft context mismatch');}
/** Default remains an exact HTTP build header. DOM identity is online-only and explicit. */
export async function readTargetIdentity(page:Page,project:any,stage:TargetStage,headerBuildId:string|null,expectedBuildId:string):Promise<{buildId:string;proof?:TargetIdentityProof}>{
 const config=configured(project,stage);
 if(!config){if(headerBuildId!==expectedBuildId)throw Error('Served target is not the current HTTP build');return{buildId:expectedBuildId};}
 assertContext(page.url(),config);
 if(headerBuildId!==null&&headerBuildId!==expectedBuildId)throw Error('Conflicting target HTTP build header');
 const values=await page.locator(config.selector).evaluateAll((nodes,attribute)=>nodes.map(n=>n.getAttribute(attribute)),config.attribute);
 if(values.length!==1||values[0]!==expectedBuildId)throw Error('Missing, duplicate or wrong DOM build marker');
 return{buildId:expectedBuildId,proof:{mode:'dom-marker',buildId:expectedBuildId,configSha256:digest(canonical(config)),selector:config.selector,attribute:config.attribute,markerCount:values.length,markerValue:values[0],headerBuildId}};
}
/** Independently validate hashed capture metadata against the current configured adapter. */
export function validateTargetIdentityProof(project:any,stage:TargetStage,url:string,servedBuildId:string|null,expectedBuildId:string,proof?:TargetIdentityProof){
 if(servedBuildId!==expectedBuildId)throw Error('Target server did not identify the current build');
 const config=configured(project,stage);
 if(!config){if(proof)throw Error('Unexpected DOM identity proof without an explicit adapter');return;}
 assertContext(url,config);
 if(!proof||proof.mode!=='dom-marker'||proof.buildId!==expectedBuildId||proof.configSha256!==digest(canonical(config))||proof.selector!==config.selector||proof.attribute!==config.attribute||proof.markerCount!==1||proof.markerValue!==expectedBuildId||proof.headerBuildId!==null&&proof.headerBuildId!==expectedBuildId)throw Error('Stale, conflicting or missing exact DOM identity proof');
}
