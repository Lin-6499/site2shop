import {dirname,join,resolve} from 'node:path';
import {load} from 'cheerio';
import {jsonFile,readRef,writeJson,digest} from '../src/shopyy/artifacts.js';
import {prepareComposerInputs} from '../src/shopyy/composer-inputs.js';
import {sourceSessionPolicy} from '../src/shopyy/source-session.js';

const file=resolve(process.argv[2]||''),root=dirname(file),project=await jsonFile(file);
if(new URL(project.sourceUrl).hostname!=='voidresearch.shop')throw Error('Site-specific observed destination recipe');
const proposal=await jsonFile(join(root,'contracts/navigation-proposal.v2.json'));
const inventory=await jsonFile(join(root,'contracts/route-inventory.v2.json'));
const catalog=await jsonFile(join(root,'common/content/search-fixture.json'));
const config=await jsonFile(join(root,'contracts/families.v2.json'));
const searchObservation=await jsonFile(join(root,'verification/recon-current/home-development-comparison-searchdirect.json')).catch(()=>null);
const result:any[]=[],failures:any[]=[];
for(const row of proposal.rows.filter((r:any)=>r.proposedDisposition==='mapped'&&r.sourcePath!=='/')){
 try{
  const surface=inventory.coverage.surfaces.find((s:any)=>s.path===row.sourcePath&&s.viewport==='desktop'&&s.state==='initial');
  let sourceEvidence=surface.evidence,publicQueryInputs:any[]=[];
  if(row.sourcePath==='/shop?q=GHK'){
    const observed=searchObservation?.comparisons?.find((r:any)=>r.viewport==='desktop');
    if(!observed?.sourceStructure)throw Error('Current rendered search destination evidence required');
    const dom=JSON.parse((await readRef(root,observed.sourceStructure)).toString());
    const field=JSON.parse((await readRef(root,dom.componentObservation)).toString());
    if(field.captureEnvironment?.sourceSessionCurrent!==true||field.captureEnvironment.sourceSessionPolicySha256!==sourceSessionPolicy(project))throw Error('Search query binding requires the current source session policy');
    sourceEvidence=observed.sourceStructure;
    publicQueryInputs=[{selector:field.selectors.catalogQuery,parameter:'q',component:'catalogQuery',observation:dom.componentObservation}];
  }
  const data=JSON.parse((await readRef(root,sourceEvidence)).toString()),$=load(data.structure);
  const id='page-'+digest(row.sourcePath).slice(0,16),wrapped=$('div.min-h-screen').length===1;
  const recipe={schemaVersion:2,sourcePath:row.sourcePath,componentSelectorsFile:'contracts/secondary-components.draft.json',outputDirectory:`staging/pages/${id}`,publicQueryInputs,fragments:[{id:'body',selector:wrapped?'div.min-h-screen':'body',...(wrapped?{}:{asDiv:true,keepChildren:'header,main,footer,div.h-16'}),rootAttributes:{'data-vr-storefront':'','data-vr-page':row.family,'data-vr-page-id':id},observation:sourceEvidence}]};
  const recipeFile=`contracts/page-recipes/${id}.json`;await writeJson(join(root,recipeFile),recipe);
  await prepareComposerInputs(file,recipeFile);
  const dataFile=`common/content/pages/${id}.json`;
  const previous=await jsonFile(join(root,dataFile)).catch(()=>({}));
  await writeJson(join(root,dataFile),{...previous,title:data.title||row.title,sourcePath:row.sourcePath,targetCanonical:row.targetPath.split('?')[0],family:row.family,bodyFile:`staging/pages/${id}/body.htm`,catalog,ui:previous.ui||{},publicUi:previous.publicUi||{},sourceEvidence,scope:'initial-read-only-navigation-destination; not complete workflow or native binding acceptance'});
  config.families[row.family]||={templateFile:'common/composers/secondary.htm'};
  const page={sourcePath:row.sourcePath,targetPath:row.targetPath,family:row.family,nativeFile:`pages/${id}.htm`,dataFile};
  config.pages=config.pages.filter((p:any)=>p.sourcePath!==row.sourcePath);config.pages.push(page);result.push(page);
 }catch(error){failures.push({sourcePath:row.sourcePath,error:error instanceof Error?error.message:String(error)});}
}
await writeJson(join(root,'contracts/families.v2.json'),config);
await writeJson(join(root,'verification/recon-current/destination-inputs.json'),{kind:'prepared-destination-inputs-not-acceptance',prepared:result,failures,pending:['Complete family-specific state contracts and behavior adapters','Independent source/local comparisons','Verified native SHOPYY field and resource bindings before draft installation']});
console.log(JSON.stringify({prepared:result.length,failures,status:'inputs-only-not-accepted-build'},null,2));
if(failures.length)process.exitCode=2;
