import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {compileCustomBlock} from '../src/shopyy/custom-blocks.js';
import {jsonFile,writeJson} from '../src/shopyy/artifacts.js';
const file=resolve(process.argv[2]),root=dirname(file),project=await jsonFile(file),directory=join(root,'staging/incremental-draft-504457');await mkdir(directory,{recursive:true});
const css=await readFile(join(root,project.commonStyleFile),'utf8'),blocks:any[]=[];
for(const id of ['quality']){
 const html=await readFile(join(root,'staging/composers',id+'.htm'),'utf8'),compiled=compileCustomBlock({id,html,css});
 if(compiled.characters>65536)throw Error('Block exceeds the tested editor lower bound; split transport or verify a higher bound first');
 await writeFile(join(directory,id+'.html'),compiled.html);
 blocks.push({id,...compiled,html:undefined,file:`staging/incremental-draft-504457/${id}.html`,status:'prepared-provisional-component; native readback and visual verification pending'});
}
await writeJson(join(directory,'manifest.json'),{kind:'user-authorized-incremental-provisional-draft-components',target:{origin:'https://pepsss.zenshop.cn',skinId:'504457',role:'draft'},blocks,publicationAllowed:false,fullSiteAcceptance:false});console.log(JSON.stringify({blocks:blocks.map(b=>({id:b.id,characters:b.characters,sha256:b.sha256})),draftChanged:false,published:false}));
