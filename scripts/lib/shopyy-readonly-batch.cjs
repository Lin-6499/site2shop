const fs=require('node:fs/promises');const path=require('node:path');const crypto=require('node:crypto');const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
async function fingerprint(page,batchFile,route){
 const raw=await fs.readFile(batchFile,'utf8'),batch=JSON.parse(raw),record=batch.pages.find(p=>p.route===route);if(!record)throw Error('Route outside reviewed native batch');
 const url=new URL(route,batch.target.origin);for(const[k,v]of Object.entries(batch.requiredParams))url.searchParams.set(k,v);
 const response=await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:25000});const final=new URL(page.url());
 if(!response||response.status()!==200||final.origin!==batch.target.origin||final.pathname!==route||Object.entries(batch.requiredParams).some(([k,v])=>final.searchParams.getAll(k).length!==1||final.searchParams.get(k)!==v))throw Error('Readonly draft route identity mismatch');
 const html=await response.text(),checks=[];
 for(const part of record.parts){const code=await fs.readFile(path.join(path.dirname(batchFile),part.codeFile),'utf8');if(hash(code)!==part.sha256)throw Error('Immutable batch code drift');const position=html.indexOf(code),unique=position>=0&&html.indexOf(code,position+code.length)<0;checks.push({id:part.id,sha256:part.sha256,exactServedBytes:unique,position});}
 const order=checks.every((c,i)=>i===0||checks[i-1].position<c.position);
 const nativeBlockIds=[...html.matchAll(/<[^>]+\bdata-section-type=["']block_html["'][^>]*>/g)].map(m=>m[0].match(/\bid=["']([^"']+)["']/)?.[1]||null);
 const nativeBlockComposition=record.nativeBlockIds?JSON.stringify(nativeBlockIds)===JSON.stringify(record.nativeBlockIds):null;
 const matched=checks.every(c=>c.exactServedBytes)&&order&&nativeBlockComposition!==false;
 return{batchId:batch.batchId,batchSha256:hash(raw),compositionId:record.compositionId,route,checks,order,nativeBlockIds,nativeBlockComposition,matched,capturedAt:new Date().toISOString(),remoteMutation:false};
}
async function guard(context){
 const blocked=[];
 await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(u.origin==='https://pepsss.zenshop.cn'&&!['GET','HEAD','OPTIONS'].includes(r.method())){blocked.push({method:r.method(),path:u.pathname});return route.abort('blockedbyclient');}return route.continue();});
 return blocked;
}
module.exports={fingerprint,guard};
