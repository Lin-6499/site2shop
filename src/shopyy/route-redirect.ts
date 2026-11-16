import {readRef,contained} from './artifacts.js';
import {readdir,readFile} from 'node:fs/promises';
import {dirname,join,basename} from 'node:path';
import {mappedTargetPath,stageTargetErrors} from './target-context.js';
import {renderedEvidenceRejection} from '../rendered-page-validity.js';

/** Only the exact evidenced broken href can become an intentionally disabled link. */
export async function verifyBrokenSourceLink(root:string,inventory:any,path:string){
 const mapping=inventory.routes[path],rule=mapping?.removal;if(mapping?.disposition!=='removed'||rule?.kind!=='broken-source-link'||rule.behavior!=='disabled'||rule.preserveHref!==true||mapping.targetPath!==path||stageTargetErrors({preflight:path}).length||mapping.targetPaths&&Object.values(mapping.targetPaths).some(p=>p!==path))throw Error('Broken link requires an explicit preserved local href and disabled disposition');
 const raw=JSON.parse((await readRef(root,rule.diagnostic)).toString()),failure=raw.failureStage,page=failure?.page,origin=new URL(inventory.sourceUrl).origin;
 const url=raw.finalUrl||raw.url||(page?.origin&&page?.pathname&&Array.isArray(page.queryKeys)&&page.queryKeys.length===0?page.origin+page.pathname:null),status=raw.status??failure?.navigationStatus,title=raw.title??page?.title,h1=raw.headings?.filter((h:any)=>h.tag==='H1').map((h:any)=>h.text)??page?.publicH1;
 if(!url)throw Error('Broken source exact URL/query missing');const actual=new URL(url);if(actual.origin!==origin||actual.pathname+actual.search!==path||actual.hash)throw Error('Broken source route identity differs');
 const rejection=renderedEvidenceRejection({status:200,url:actual.href,title,visibleText:(h1||[]).join(' '),cfMitigated:raw.cfMitigated,challengeUiVisible:raw.challengeUiVisible});
 if(rejection&&rejection!=='soft 404 page'||!(status===404||status===200&&rejection==='soft 404 page'&&Array.isArray(h1)&&h1.some(text=>String(text).trim()==='404')))throw Error('Source broken link requires actual non-challenge 404 evidence');
 return rule.diagnostic.path;
}

/** An observed redirect is distinct from a same-page canonical alias. */
export async function verifyMappedRedirect(root:string,inventory:any,path:string){
 const mapping=inventory.routes[path],proof=mapping?.redirect,owner=inventory.routes[proof?.sourcePath];
 if(mapping?.disposition!=='mapped-redirect'||!proof||stageTargetErrors({preflight:path}).length||stageTargetErrors({preflight:proof.sourcePath}).length||proof.sourcePath===path||owner?.disposition!=='mapped'||mapping.family!==owner.family||mapping.representative!==owner.representative||['preflight','online'].some(stage=>mappedTargetPath(mapping,stage as 'preflight'|'online')!==mappedTargetPath(owner,stage as 'preflight'|'online')))throw Error('Redirect must point to an existing exact canonical mapped owner');
 const request=JSON.parse((await readRef(root,proof.request)).toString()),observation=JSON.parse((await readRef(root,proof.observation)).toString()),origin=new URL(inventory.sourceUrl).origin;
 const requested=new URL(request.sourcePath||request.requestedUrl||(proof.finalUrlEvidence?request.url:undefined),origin);if(requested.origin!==origin||requested.pathname+requested.search!==path)throw Error('Redirect requested source identity differs');
 if(proof.finalUrlEvidence){const record=JSON.parse((await readRef(root,proof.finalUrlEvidence)).toString());if(request.op!=='read'||typeof request.page!=='string'||!request.page||request.page==='main'||!proof.request.path.endsWith('.running.json')||!proof.finalUrlEvidence.path.endsWith('.result.json')||proof.request.path.replace(/\.running\.json$/,'')!==proof.finalUrlEvidence.path.replace(/\.result\.json$/,'')||record.ok!==true||!Number.isFinite(Date.parse(record.finishedAt))||new URL(record.result?.url).href!==new URL(proof.sourcePath,origin).href)throw Error('Redirect actual complete first-use read URL/request pair differs');
  const directory=dirname(await contained(root,proof.request.path));for(const file of await readdir(directory)){if(!file.endsWith('.running.json')||file===basename(proof.request.path))continue;const previous=JSON.parse(await readFile(join(directory,file),'utf8'));if(previous.page!==request.page)continue;let completed:any;try{completed=JSON.parse(await readFile(join(directory,file.replace(/\.running\.json$/,'.result.json')),'utf8'));}catch{throw Error('Read page freshness cannot be established');}if(!Number.isFinite(Date.parse(completed.finishedAt))||Date.parse(completed.finishedAt)<Date.parse(record.finishedAt))throw Error('Read on an existing named page does not prove navigation');}
 }
 let final:string|undefined,status:number|undefined,title:string|undefined,text:string|undefined;
 if(observation.finalUrl||observation.url){final=observation.finalUrl||observation.url;status=observation.status;title=observation.title;text=observation.text;}
 else{const stage=observation.failureStage,page=stage?.page;if(!page||page.origin!==origin||!Array.isArray(page.queryKeys)||page.queryKeys.length||!Array.isArray(page.publicH1)||!page.publicH1.length)throw Error('Redirect observation cannot establish exact final URL/query');final=page.origin+page.pathname;status=stage.navigationStatus;title=page.title;text=page.publicH1.join(' ');}
 const actual=new URL(final!);if(actual.origin!==origin||actual.pathname+actual.search!==proof.sourcePath||status!==200||renderedEvidenceRejection({status,url:actual.href,title,visibleText:text}))throw Error('Redirect final source evidence differs or is not a normal rendered destination');
 return[proof.request.path,proof.observation.path,...(proof.finalUrlEvidence?[proof.finalUrlEvidence.path]:[])];
}
