import {dirname,join,resolve} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {load} from 'cheerio';
import {jsonFile,writeJson,digest,canonical} from '../src/shopyy/artifacts.js';

const file=resolve(process.argv[2]),root=dirname(file),project=await jsonFile(file);
const families=await jsonFile(join(root,project.familiesFile)),page=families.pages.find((p:any)=>p.sourcePath==='/coa'),data=await jsonFile(join(root,page.dataFile));
const original=await readFile(join(root,data.bodyFile),'utf8'),dom=load(original,null,false),wrapper=dom('[data-vr-storefront]');
if(wrapper.length!==1||wrapper.children('header').length!==1||wrapper.children('div.h-16').length!==1||wrapper.children('footer').length!==1)throw Error('Unexpected COA shell boundaries');
if(dom('#coa-reports > div.grid > div').length!==23||dom('#coa-reports > div.grid > div:first-child > div:first-child p:first-child').text()!=='GLP-3 RT')throw Error('Fixed directory source identity changed; do not mix newer live names');
wrapper.children('header,div.h-16,footer').remove();
const body=dom.html(),templates=await readFile(join(root,data.coaTemplatesFile),'utf8'),cardTemplates=await readFile(join(root,data.coaCardTemplatesFile),'utf8'),model=JSON.stringify(data.publicUi,null,2),style=await readFile(join(root,project.commonStyleFile),'utf8'),runtime=await readFile(join(root,project.commonScriptFile),'utf8');
if(runtime!==await readFile(join(root,project.commonScriptFile),'utf8'))throw Error('Shared runtime changed during freeze');
const comparisons=[];
for(const[filename,expected]of [['coa-development-comparison.json',12],['coa-card-development-comparison.json',18]] as const){
 const path='verification/recon-current/'+filename,bytes=await readFile(join(root,path)),report=JSON.parse(bytes.toString());
 if(report.rows.length!==expected||report.rows.some((r:any)=>r.errors?.length||r.differences?.length))throw Error('Fixed baseline COA comparisons incomplete');
 comparisons.push({file:path,sha256:digest(bytes),rows:report.rows.length,developmentRenderSha256:report.developmentRenderSha256,scope:report.kind,newerSourceAttempt:report.newerSourceAttempt||null});
}
const files={'body.htm':body,'templates.htm':templates,'card-templates.htm':cardTemplates,'public-ui.json':model,'source.css':style,'runtime.snapshot.js':runtime};
const hashes=Object.fromEntries(Object.entries(files).map(([name,content])=>[name,digest(content)])),version='r1-coa-directory-inputs-'+digest(canonical(hashes)).slice(0,12),directory=join(root,'staging/handoff-inputs',version);
await mkdir(directory,{recursive:false});for(const[name,content]of Object.entries(files))await writeFile(join(directory,name),content);
await writeJson(join(directory,'manifest.json'),{schemaVersion:1,version,status:'provisional-fixed-baseline-inputs-not-editor-package-or-full-workflow-acceptance',target:{origin:'https://pepsss.zenshop.cn',skinId:'504457',role:'draft'},sourcePath:'/coa',targetPath:page.targetPath,body:{file:'body.htm',sha256:hashes['body.htm'],originalFile:data.bodyFile,originalSha256:digest(original),extraction:'Retain wrapper and all direct page sections; remove exactly one shared header, h-16 spacer and footer.'},templates:[{file:'templates.htm',sha256:hashes['templates.htm'],sourceFile:data.coaTemplatesFile},{file:'card-templates.htm',sha256:hashes['card-templates.htm'],sourceFile:data.coaCardTemplatesFile}],publicUi:{file:'public-ui.json',sha256:hashes['public-ui.json'],schema:'coa-name-search-and-fixed-representative-card-variants-v1'},sharedStyle:{file:'source.css',sha256:hashes['source.css']},runtime:{file:'runtime.snapshot.js',sha256:hashes['runtime.snapshot.js']},baselineComparisons:comparisons,provenScope:{directoryCards:23,searchStates:4,representativeCard:'GLP-3 RT',cardStates:6,objectiveRows:30},unboundCapabilities:['All other cards amount/history branches','Combined representative amount/history states; newer source identity isolated','View COA button to per-certificate route binding','Clipboard Copy buttons','Lot lookup submission','Live report ownership/PDF verification','Shared navigation and current-build online route validation'],nativeBound:false,localEditorTransportComparison:'pending-A-compiler',visualReview:'pending-independent-review',wholeSiteAcceptance:false,publicationAllowed:false});
console.log(JSON.stringify({version,objectiveRows:30,fullWorkflowAccepted:false,published:false}));
