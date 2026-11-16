import {digest} from './artifacts.js';

function declarations(project:any,sourcePath:string){
 const origin=new URL(project.sourceUrl).origin;
 const queries=project.workflow?.sourceReadQueries||[];
 if(!Array.isArray(queries)||queries.length>10)throw Error('Bounded source read-query declarations required');
 return queries.filter((q:any)=>q.sourcePaths?.includes(sourcePath)).map((q:any)=>{
  if(!/^[a-z][a-z0-9-]{0,63}$/.test(q.id)||q.method!=='POST'||q.origin!==origin||!/^\/_serverFn\/[a-f0-9]{64}$/.test(q.path)||!/^[a-f0-9]{64}$/.test(q.payloadSha256)||!q.rationale||!q.reviewedSourceModule?.sha256)throw Error('Source read query lacks exact reviewed origin, function, payload and evidence');
  return {id:q.id,method:q.method,origin:q.origin,path:q.path,payloadSha256:q.payloadSha256};
 });
}

/** Separate from authentication: only pages affected by an added query need recapture. */
export function sourceReadQueryPolicy(project:any,sourcePath:string){
 const rules=declarations(project,sourcePath);
 return rules.length?digest(JSON.stringify({version:1,sourcePath,rules})):null;
}

/** A POST transport is allowed only for an independently reviewed display query. */
export function admittedSourceReadQuery(project:any,request:{method:string;url:string;frameUrl:string;payload:string;navigation:boolean;resourceType:string}){
 if(request.navigation||request.method!=='POST'||!['fetch','xhr'].includes(request.resourceType))return null;
 const frame=new URL(request.frameUrl),url=new URL(request.url),origin=new URL(project.sourceUrl).origin;
 if(frame.origin!==origin||url.origin!==origin||url.search||url.hash||url.username||url.password)return null;
 return declarations(project,frame.pathname+frame.search).find(q=>q.path===url.pathname&&q.payloadSha256===digest(request.payload))||null;
}
