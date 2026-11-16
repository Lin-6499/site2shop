import {readFile,writeFile,mkdir,readdir,rename} from 'node:fs/promises';
import {resolve,join,dirname,relative} from 'node:path';
import {homedir} from 'node:os';
import {load} from 'cheerio';
import {writeJson} from '../src/shopyy/artifacts.js';
const root=resolve(process.argv[2]||'../voidresearch-shopyy'),base=join(homedir(),'.codex/private-evidence/voidresearch');
const folders=(await readdir(base)).sort(),quarantine=join(base,folders.at(-1)!);const paths:string[]=[];
async function walk(folder:string){for(const f of await readdir(folder,{withFileTypes:true})){const p=join(folder,f.name);if(f.isDirectory())await walk(p);else paths.push(p);}}await walk(join(quarantine,'records'));
const identity=new Set<string>(),privateImages=new Set<string>();
for(const p of paths){let d:any;try{d=JSON.parse(await readFile(p,'utf8'));}catch{continue;}if(!d.structure)continue;const $=load(d.structure);
 $('#apply').find('*').contents().each((_,n)=>{if(n.type!=='text'||!n.data.includes('Verified as'))return;const parent=$(n).parent();for(const s of parent.text().match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.(?:com|net|org|cn|io|co)(?=[^a-z]|$)/gi)||[])identity.add(s);parent.contents().each((_,leaf)=>{if(leaf.type==='text')for(const s of leaf.data.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}\b/gi)||[])identity.add(s);});});
}
if(!identity.size)throw Error('Private account identity was not located; no evidence restored');
let restored=0,sanitized=0,retained=0;
for(const p of paths){const bytes=await readFile(p,'utf8'),matches=[...identity].some(s=>bytes.includes(s));const rel=relative(join(quarantine,'records'),p),dest=join(root,rel);
 if(matches){retained++;if(rel.startsWith('artifacts')){const d=JSON.parse(bytes);const refs=(v:any)=>{if(!v||typeof v!=='object')return;if(v.path?.endsWith('.png'))privateImages.add(resolve(root,v.path));for(const x of Object.values(v))refs(x);};refs(d);continue;}
 let clean=bytes;for(const s of identity)clean=clean.split(s).join('[account identity redacted]');await mkdir(dirname(dest),{recursive:true});await writeFile(dest,clean);sanitized++;}
 else{await mkdir(dirname(dest),{recursive:true});await rename(p,dest);restored++;}
}
const imagePaths:string[]=[];async function imgs(folder:string){for(const f of await readdir(folder,{withFileTypes:true})){const p=join(folder,f.name);if(f.isDirectory())await imgs(p);else imagePaths.push(p);}}await imgs(join(quarantine,'images'));
let restoredImages=0;for(const p of imagePaths){const dest=join(root,relative(join(quarantine,'images'),p));if(privateImages.has(dest))continue;await mkdir(dirname(dest),{recursive:true});await rename(p,dest);restoredImages++;}
await writeJson(join(root,'verification/recon-current/privacy-restoration.json'),{kind:'public-contact-evidence-restored-private-account-kept-quarantined',restored,sanitizedMetadata:sanitized,retainedPrivateRecords:retained,restoredImages,privateValuesPrinted:false,requiresAffectedRecapture:true,published:false});
console.log(JSON.stringify({restored,sanitizedMetadata:sanitized,retainedPrivateRecords:retained,restoredImages,privateValuesPrinted:false}));
