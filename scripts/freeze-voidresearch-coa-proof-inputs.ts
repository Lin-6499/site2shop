import {dirname,join,resolve} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {load} from 'cheerio';
import {jsonFile,writeJson,digest,canonical} from '../src/shopyy/artifacts.js';

const root=dirname(resolve(process.argv[2])),sourceFile='verification/recon-current/coa-proof-states/source-run.json',sourceBytes=await readFile(join(root,sourceFile)),source=JSON.parse(sourceBytes.toString()),document=await jsonFile(join(root,'verification/coa-proof-documents/observed-source-get.json'));
const states=['initial','checking','normal-result','read-error','mismatch','retry-match'];
if(source.rows.length!==18||source.rows.some((r:any)=>r.passed===false)||states.some(state=>source.rows.filter((r:any)=>r.state===state).length!==3))throw Error('Expected complete six-state three-device source observations');
const pdf=await readFile(join(root,document.file));if(digest(pdf)!==source.expectedSha256||pdf.length!==document.bytes)throw Error('Published public document identity mismatch');
const project=await jsonFile(resolve(process.argv[2]));
const files:Record<string,string|Buffer>={'public-report.pdf':pdf,'source.css':await readFile(join(root,project.commonStyleFile),'utf8')};
const templates:Record<string,string>={};
for(const state of states){
 const rows=source.rows.filter((r:any)=>r.state===state);if(new Set(rows.map((r:any)=>r.html)).size!==1)throw Error('Proof DOM differs across devices: '+state);
 const html=rows[0].html,$=load(html,null,false);if($('script').length||$('[data-proof-seal]').length!==1||$('button').length!==1||$('[title="'+source.expectedSha256+'"]').length!==1)throw Error('Unexpected proof template boundaries');
 files[state+'.htm']=html;if(state!=='initial'&&state!=='retry-match')templates[state==='normal-result'?'match':state==='read-error'?'error':state==='mismatch'?'differs':state]='vr-coa-proof-'+state;
}
if(files['retry-match.htm']!==files['normal-result.htm'])throw Error('Normal match/retry source DOM mismatch');
files['templates.htm']=Object.entries(templates).map(([state,id])=>{const file=state==='match'?'normal-result':state==='error'?'read-error':state==='differs'?'mismatch':state;return '<template id="'+id+'">'+files[file+'.htm']+'</template>';}).join('\n');
files['public-ui.json']=JSON.stringify({coaProof:{selector:'[data-proof-seal]',documentUrl:null,expectedSha256:document.sha256,expectedBytes:document.bytes,templates}},null,2);
const hashes=Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,digest(bytes)])),version='r1-coa-proof-inputs-'+digest(canonical(hashes)).slice(0,12),directory=join(root,'staging/handoff-inputs',version);await mkdir(directory,{recursive:false});
for(const[name,bytes]of Object.entries(files))await writeFile(join(directory,name),bytes);
await writeJson(join(directory,'manifest.json'),{schemaVersion:1,version,status:'observed-component-inputs-pending-runtime-and-paired-local-acceptance',sourcePath:source.sourcePath,source:{file:sourceFile,sha256:digest(sourceBytes),module:source.sourceModule},files:hashes,document:{...document,file:'public-report.pdf',targetUrl:null},sourceStates:states,objectiveRows:18,componentWidths:source.rows.filter((r:any)=>r.state==='initial').map((r:any)=>({viewport:r.viewport,size:r.size,width:r.width})),faultConditions:'read-error and mismatch are explicit local faults of the exact public PDF GET, not real provider failures; normal-result/retry-match use actual source PDF responses',nativeBound:false,targetReady:false,clipboardTested:false,wholePageAccepted:false,publicationAllowed:false});
const planFile=join(root,'verification/recon-current/coa-detail-behavior-plan.pending.json'),plan=await jsonFile(planFile),priorAttempt={path:'artifacts/'+digest(await readFile(planFile))+'.json',sha256:digest(await readFile(planFile))};await writeFile(join(root,priorAttempt.path),await readFile(planFile));
for(const row of plan.rows){row.workflowStates=(row.workflowStates||[]).filter((r:any)=>r.id==='copy-public-verification-code');if(row.controls.includes('Check this file'))row.workflowStates.unshift(...states.map(id=>({id,status:row.sourcePath===source.sourcePath?'observed-source-component-pending-local-implementation':'pending-source-observation',evidence:row.sourcePath===source.sourcePath?sourceFile:null})));}
plan.priorAttempt=priorAttempt;plan.correctedMechanism='GET the currently published public PDF, compare byte length and client SHA-256; no file picker, upload or reset/reselect workflow';plan.representativeFrozenInput='staging/handoff-inputs/'+version+'/manifest.json';await writeJson(planFile,plan);
console.log(JSON.stringify({version,sourceRows:18,templateCount:4,pdfBytes:pdf.length,targetReady:false,published:false}));
