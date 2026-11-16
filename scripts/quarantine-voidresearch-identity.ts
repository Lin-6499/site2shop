import {readFile,writeFile,mkdir,rename,readdir} from 'node:fs/promises';
import {resolve,join,dirname,relative} from 'node:path';
import {homedir} from 'node:os';
import {load} from 'cheerio';
import {jsonFile,writeJson,digest} from '../src/shopyy/artifacts.js';
const root=resolve(process.argv[2]||'../voidresearch-shopyy');
const files:string[]=[];
async function walk(folder:string){for(const f of await readdir(folder,{withFileTypes:true})){const p=join(folder,f.name);if(f.isDirectory())await walk(p);else files.push(p);}}
await walk(root);
// Obtain identity values only from the private account subtree, never from business contacts.
const secrets=new Set<string>(),privateRecords=new Set<string>(),privateImages=new Set<string>();
for(const file of files.filter(f=>f.endsWith('.json'))){
 const bytes=await readFile(file,'utf8');let d:any;try{d=JSON.parse(bytes);}catch{continue;}
 if(typeof d.structure!=='string')continue;
 const $=load(d.structure),region=$('#apply');if(!region.length)continue;
 // Only the verified account identity is private; published business contacts are preserved.
 region.find('*').addBack().contents().each((_,n)=>{if(n.type!=='text'||!n.data.includes('Verified as'))return;$(n).parent().contents().each((_,leaf)=>{if(leaf.type==='text')for(const email of leaf.data.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}\b/gi)||[])secrets.add(email);});});
 if(!region.text().includes('Verified as'))continue;
 privateRecords.add(file);
 const refs=(v:any)=>{if(!v||typeof v!=='object')return;if(typeof v.path==='string'&&v.path.endsWith('.png'))privateImages.add(resolve(root,v.path));for(const x of Object.values(v))refs(x);};refs(d);
 if(d.componentObservation?.path){try{const observation=await jsonFile(join(root,d.componentObservation.path));refs(observation);}catch{}}
}
const quarantine=join(homedir(),'.codex','private-evidence','voidresearch',new Date().toISOString().replaceAll(':','-'));
await mkdir(quarantine,{recursive:true});let inputs=0,records=0,images=0;
for(const file of files){
 if(!/\.(json|htm|html|md|txt|js)$/.test(file))continue;
 const bytes=await readFile(file,'utf8');
 const isInput=relative(root,file).replaceAll('\\','/').startsWith('staging/');
 const $=isInput&&/\.htm[l]?$/.test(file)?load(bytes,null,false):null;
 const matches=[...secrets].some(s=>bytes.includes(s));
 if(isInput&&$&&$('#apply').length){
  const r=$('#apply');r.empty().attr('data-vr-account-boundary','pending').append('<p>Account application requires the destination store account integration.</p>');
  const dest=join(quarantine,'inputs',relative(root,file));await mkdir(dirname(dest),{recursive:true});await writeFile(dest,bytes);await writeFile(file,$.html());inputs++;continue;
 }
 if(privateRecords.has(file)||matches){const dest=join(quarantine,'records',relative(root,file));await mkdir(dirname(dest),{recursive:true});await rename(file,dest);records++;}
}
for(const file of privateImages){try{const dest=join(quarantine,'images',relative(root,file));await mkdir(dirname(dest),{recursive:true});await rename(file,dest);images++;}catch{}}
// Missing immutable evidence must fail gates, never be silently rewritten and re-hashed.
await writeJson(join(root,'verification/recon-current/privacy-remediation.json'),{kind:'private-account-evidence-quarantined',capturedAt:new Date().toISOString(),privateValuesPrinted:false,redactedInputs:inputs,quarantinedRecords:records,quarantinedImages:images,quarantineId:digest(quarantine),requiresRecapture:true,acceptance:false,published:false});
console.log(JSON.stringify({redactedInputs:inputs,quarantinedRecords:records,quarantinedImages:images,requiresRecapture:true,privateValuesPrinted:false}));
