import {execFileSync} from 'node:child_process';
import {request} from 'playwright';
import {openSourceBrowser,guardSourceSession} from './source-session.js';
import {sourceUrlMutationReason} from './source-safety-policy.js';

/** Public visual-resource transport only. Credentials remain inside Chrome. */
export async function publicAssetClient(project:any,observedUrls:Iterable<string>=[],limits:{maxResponseBytes?:number;readJsonErrorBodies?:boolean}={}){
 if(limits.maxResponseBytes!==undefined&&(!Number.isInteger(limits.maxResponseBytes)||limits.maxResponseBytes<1||limits.maxResponseBytes>100*1024*1024))throw Error('Invalid public response size budget');
 if(project.workflow?.publicAssetTransport==='existing-chrome-session'){
  if(project.workflow?.sourceSession?.connection?.mode!=='existing-chrome')throw Error('Chrome asset transport requires the registered existing-Chrome source session');
  const origin=new URL(project.sourceUrl).origin,allowed=new Set([...observedUrls].map(url=>new URL(url).href));
  const noConnection=async():Promise<never>=>{throw Error('Chrome asset transport requires an already registered source browser; no new connection is opened');};
  const browser=await openSourceBrowser(project,undefined,{launch:noConnection,connectOverCDP:noConnection}).catch(()=>noConnection());
  let lease:Awaited<ReturnType<typeof browser.createContext>>|undefined;
  try{
   lease=await browser.createContext({});
   let page=lease.context.pages().find(page=>{
    if(page.isClosed())return false;
    try{const url=new URL(page.url());return url.origin===origin&&!/^\/(?:api|cdn-cgi)(?:\/|$)/i.test(url.pathname);}catch{return false;}
   });
   if(!page){page=await lease.newPage();await guardSourceSession(page,project);await page.goto(project.sourceUrl,{waitUntil:'domcontentloaded',timeout:30000});}
   const activePage=page;let disposed=false;
   return{transport:'existing-chrome-session; browser-owned-credentials-not-exported',client:{
    async get(raw:string,options:{timeout?:number;maxRedirects?:number}={}){
     if(disposed)throw Error('Public asset client is disposed');
     const url=new URL(raw);
     if(url.origin!==origin||url.username||url.password||!allowed.has(url.href)||sourceUrlMutationReason(url.href))throw Error('Asset URL must be an exact observed, read-only, same-origin resource');
     await activePage.bringToFront();
     if(new URL(activePage.url()).origin!==origin)throw Error('Source page origin changed before asset fetch');
     const data=await activePage.evaluate(async({url,timeout,maxResponseBytes,readJsonErrorBodies})=>{
      const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),timeout);
      try{
       const response=await fetch(url,{method:'GET',credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store',signal:abort.signal});
       const headers:Record<string,string>={};
       for(const key of ['content-type','content-length','cache-control','etag','last-modified']){const value=response.headers.get(key);if(value!==null)headers[key]=value;}
       const type=(headers['content-type']||'').split(';')[0].trim().toLowerCase();
       if(response.status===429)return{status:response.status,headers,base64:''};
       const jsonType=type==='application/json'||/^application\/[a-z0-9.+-]+\+json$/.test(type);
       if(!response.ok&&(!readJsonErrorBodies||!jsonType))return{status:response.status,headers,base64:''};
       if(type==='text/html'||type==='application/xhtml+xml')throw Error('HTML is not a public visual asset');
       const maximum=maxResponseBytes??(['video/mp4','video/webm'].includes(type)?100:10)*1024*1024;
       if(Number(headers['content-length'])>maximum)throw Error('Asset exceeds browser transfer size budget');
       const chunks:Uint8Array[]=[],reader=response.body?.getReader();let size=0;
       if(reader){while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maximum){await reader.cancel();throw Error('Asset exceeds browser transfer size budget');}chunks.push(part.value);}}
       const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
       if(/^\s*<(?:!doctype\s+html|html|head|body)\b/i.test(new TextDecoder().decode(bytes.subarray(0,512))))throw Error('HTML is not a public visual asset');
       const binary:string[]=[];for(let i=0;i<bytes.length;i+=32768)binary.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
       return{status:response.status,headers,base64:btoa(binary.join(''))};
      }finally{clearTimeout(timer);}
     },{url:url.href,timeout:options.timeout??30000,maxResponseBytes:limits.maxResponseBytes,readJsonErrorBodies:limits.readJsonErrorBodies??false});
     const bytes=Buffer.from(data.base64,'base64');
     return{ok:()=>data.status>=200&&data.status<300,status:()=>data.status,headers:()=>data.headers,body:async()=>bytes};
    },
    async dispose(){if(disposed)return;disposed=true;await lease!.close();await browser.close();}
   }};
  }catch(error){await lease?.close();await browser.close();throw error;}
 }
 if(project.workflow?.publicAssetTransport!=='existing-system-loopback-proxy')return{client:await request.newContext(),transport:'direct-public-http'};
 if(process.platform!=='win32')throw Error('Configured existing system proxy transport requires this Windows host');
 const settings=JSON.parse(execFileSync('powershell',['-NoProfile','-Command',"Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' | Select-Object ProxyEnable,ProxyServer | ConvertTo-Json -Compress"],{encoding:'utf8'}));
 const entry=String(settings.ProxyServer||'').split(';').find(s=>s.startsWith('https='))||String(settings.ProxyServer||'').split(';').find(s=>!s.includes('=')),endpoint=entry?.replace(/^https=/,''),url=endpoint?new URL(endpoint.includes('://')?endpoint:'http://'+endpoint):null;
 if(settings.ProxyEnable!==1||!url||!['http:','https:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password)throw Error('Configured public transport requires an existing credential-free local system proxy');
 return{client:await request.newContext({proxy:{server:url.href}}),transport:'existing-user-configured-local-proxy; settings-not-changed'};
}
