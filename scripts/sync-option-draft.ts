import { resolve,join } from 'node:path';
import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { shopify,parseCliJson,check } from '../src/shopify.js';
import { assertOptionMediaAcceptance } from '../src/option-media-gate.js';
import { hash } from '../src/util.js';

// Narrow, explicit user-approved diagnostic deployment. Not a general gate bypass.
const out=resolve(process.argv[2]||'../westandwillow-phase3');
const expected={store:'azhiip-13.myshopify.com',themeId:189590896839,name:'Site2Shop Phase 3 Acceptance'};
if(!process.argv.includes('--authorized-option-repair'))throw Error('This command requires the recorded scoped authorization.');
const gate=await assertOptionMediaAcceptance(out,'preflight');
const manifest=JSON.parse(await readFile(join(out,'option-media-build.json'),'utf8'));
const fixed=new Set(['sections/s2s-embroidered-product.liquid','snippets/s2s-option-visual.liquid','snippets/s2s-option-media-data.liquid','assets/s2s-option-media.js','assets/s2s-option-media.css','assets/s2s-family-product-v3.js']);
for(const file of manifest.files){
 if(!fixed.has(file.name)&&!/^assets\/s2s-option-[a-f0-9]{20}\.(png|jpg)$/.test(file.name))throw Error('Out-of-scope upload file');
 if(hash(await readFile(join(out,'theme',file.name)))!==file.sha256)throw Error('Upload bytes changed');
}
await check(out);
const listed=parseCliJson(await shopify(['theme','list','--store',expected.store,'--json','--no-input']));
const themes=Array.isArray(listed)?listed:listed.themes;
const theme=themes.find((t:any)=>String(t.id)===String(expected.themeId));
if(!theme||theme.name!==expected.name||theme.role!=='unpublished')throw Error('Destination is not the exact authorized draft');
const run=join(out,'option-draft-sync',new Date().toISOString().replace(/[:.]/g,'-'));
const before=join(run,'before'),after=join(run,'after');await mkdir(before,{recursive:true});await mkdir(after,{recursive:true});
const only=manifest.files.flatMap((f:any)=>['--only',f.name]);
const record:any={schemaVersion:1,...expected,role:theme.role,authorization:'允许，仅同步本次修复到草稿',scope:'option-media-only',notFullSiteAcceptance:true,published:false,localBuildId:gate.buildId,files:manifest.files,preflight:gate,startedAt:new Date().toISOString(),backup:before};
await writeFile(join(run,'record.json'),JSON.stringify(record,null,2));
await shopify(['theme','pull','--store',expected.store,'--theme',String(expected.themeId),'--path',before,'--nodelete','--no-input',...only]);
record.result=parseCliJson(await shopify(['theme','push','--store',expected.store,'--theme',String(expected.themeId),'--path',join(out,'theme'),'--nodelete','--json','--no-input',...only]));
if(record.result.theme?.id!==expected.themeId||record.result.theme?.role!=='unpublished')throw Error('Unexpected uploaded theme identity');
await shopify(['theme','pull','--store',expected.store,'--theme',String(expected.themeId),'--path',after,'--nodelete','--no-input',...only]);
for(const file of manifest.files)if(hash(await readFile(join(after,file.name)))!==file.sha256)throw Error(`Remote readback differs: ${file.name}`);
record.remoteReadbackVerified=true;record.completedAt=new Date().toISOString();
await writeFile(join(run,'record.json'),JSON.stringify(record,null,2));
await writeFile(join(out,'option-media-draft-deployment.json'),JSON.stringify(record,null,2));
console.log(JSON.stringify({draft:expected,files:manifest.files.length,remoteReadbackVerified:true,record:join(run,'record.json'),published:false},null,2));
