import {dirname,join,resolve} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {load} from 'cheerio';
import {jsonFile,writeJson,digest,canonical} from '../src/shopyy/artifacts.js';

const file=resolve(process.argv[2]),root=dirname(file),project=await jsonFile(file),baseline='staging/handoff-inputs/r1-coa-directory-inputs-fc249edf2a94',input=await jsonFile(join(root,baseline,'manifest.json'));
const body=await readFile(join(root,baseline,'body.htm'),'utf8'),model=JSON.parse(await readFile(join(root,baseline,'public-ui.json'),'utf8')),css=await readFile(join(root,baseline,'source.css'),'utf8'),runtime=await readFile(join(root,project.commonScriptFile),'utf8');
if(!runtime.includes('initializeFromTemplates'))throw Error('A-owned runtime must support explicit template initialization before preparing this candidate');
if(digest(body)!==input.body.sha256||digest(css)!==input.sharedStyle.sha256)throw Error('Frozen directory baseline changed');
const dom=load(body,null,false),grid=dom('#coa-reports > div.grid');if(grid.length!==1||grid.children().length!==23)throw Error('Expected the one observed 23-card grid');
const observedTemplates=new Map<string,string>();
for(const file of input.templates){const bytes=await readFile(join(root,baseline,file.file),'utf8');if(digest(bytes)!==file.sha256)throw Error('Frozen card template changed');const t=load(bytes,null,false);t('template').each((_,n)=>{const key=t(n).attr('data-vr-coa-template');if(!key||observedTemplates.has(key))throw Error('Ambiguous observed template ID');observedTemplates.set(key,t(n).html()||'');});}
const equivalence=[];
for(const[index,node]of grid.children().toArray().entries()){
 const key=model.coa.cards[index].template,source=dom.html(node),template=observedTemplates.get(key);
 if(source!==template)throw Error('Initial card differs from its exact observed search/reset template: '+key);
 equivalence.push({index,template:key,htmlSha256:digest(source),exactMarkup:true});
}
const representative=model.coa.cardVariants['GLP-3 RT'],initial=representative.variants.find((v:any)=>v.amount===representative.initialAmount&&v.history===representative.initialHistory);
if(observedTemplates.get(initial.template)!==observedTemplates.get('card-0'))throw Error('Representative initial variant differs from the observed first card');
observedTemplates.delete(initial.template);initial.template='card-0';
grid.empty();model.coa.initializeFromTemplates=true;
const compactBody=dom.html(),publicUi=JSON.stringify(model,null,2),chunks:string[][]=[];
for(const[key,html]of observedTemplates){const template=`<template data-vr-coa-template="${key}">${html}</template>`,current=chunks.at(-1);if(!current||Buffer.byteLength(current.join('\n')+'\n'+template)>59000)chunks.push([template]);else current.push(template);}
const hashes={body:digest(compactBody),publicUi:digest(publicUi),style:digest(css),runtime:digest(runtime),chunks:chunks.map(c=>digest(c.join('\n')))};
const version='r2-coa-directory-inputs-'+digest(canonical(hashes)).slice(0,12),directory=join(root,'staging/handoff-inputs',version);
await mkdir(directory,{recursive:false});
await writeFile(join(directory,'body.htm'),compactBody);await writeFile(join(directory,'public-ui.json'),publicUi);await writeFile(join(directory,'source.css'),css);await writeFile(join(directory,'runtime.snapshot.js'),runtime);
const chunkFiles=[];
for(const[index,templates]of chunks.entries()){
 const id='coa-templates-'+(index+1),file=`templates-${index+1}.htm`,html=`<div data-vr-coa-template-bundle="${id}" hidden>${templates.join('\n')}</div><style>[data-vr-coa-template-bundle="${id}"]{display:none!important}.block_html:has(> [data-vr-coa-template-bundle="${id}"]){padding:0!important}[id^="block-section-"]:has(> .block_html > [data-vr-coa-template-bundle="${id}"]){margin:0!important;height:0!important;min-height:0!important;overflow:hidden!important}</style>`;
 if(Buffer.byteLength(html)>60000)throw Error('Template chunk exceeds the conservative UTF-8 budget');
 await writeFile(join(directory,file),html);chunkFiles.push({file,sha256:digest(html),characters:html.length,bytes:Buffer.byteLength(html),templateCount:templates.length});
}
await writeJson(join(directory,'manifest.json'),{schemaVersion:1,version,status:'compact-input-candidate-awaiting-local-transport-replay-not-editor-ready',target:{origin:'https://pepsss.zenshop.cn',skinId:'504457',role:'draft'},targetReady:false,sourcePath:'/coa',targetPath:'/pages/coa',baseline:{directory:baseline,manifestSha256:digest(await readFile(join(root,baseline,'manifest.json')))},body:{file:'body.htm',sha256:hashes.body,characters:compactBody.length,initialGridCards:0,renderedGridCardsRequired:23},publicUi:{file:'public-ui.json',sha256:hashes.publicUi},sharedStyle:{file:'source.css',sha256:hashes.style},runtime:{file:'runtime.snapshot.js',sha256:hashes.runtime,initializeFromTemplates:true},templateChunks:chunkFiles,equivalence,initialRepresentativeTemplateDeduplicated:{template:'card-0',exactMarkup:true},installationOrder:[...chunkFiles.map(c=>c.file),'base-owned-styles-body-model-runtime-last'],styleStatesHtml:'All template chunk markup must be supplied to the base compiler styleStatesHtml. Chunks are hidden data stores; cards are rendered into the one original grid, not separate visual grids.',replayRequired:['23-card initialization after model/templates ready','GHK/no-result/reset search','Representative amount and previous-batches states','Template-chunk host boxes do not add page gaps','Single shared runtime boot and no duplicate listeners'],unboundCapabilities:input.unboundCapabilities,objectivePassed:false,visualReview:'pending',wholeSiteAcceptance:false,publicationAllowed:false});
console.log(JSON.stringify({version,bodyCharacters:compactBody.length,originalBodyCharacters:body.length,templateChunks:chunkFiles,templates:observedTemplates.size,targetReady:false}));
