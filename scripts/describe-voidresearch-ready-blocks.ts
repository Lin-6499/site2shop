import {resolve,dirname,join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {load} from 'cheerio';
import {jsonFile} from '../src/shopyy/artifacts.js';
const root=dirname(resolve(process.argv[2])),manifest=await jsonFile(join(root,'common/assets/images/source-current/manifest.json'));
for(const id of ['header','hero','researcher-picks','batch-testing','quality','assurance-newsletter','footer']){const html=await readFile(join(root,'staging/composers',id+'.htm'),'utf8'),$=load(html,null,false),images=$('img').map((_,n)=>({src:$(n).attr('src'),alt:$(n).attr('alt')})).get();console.log(JSON.stringify({id,characters:html.length,images:images.map(i=>({...i,bytes:manifest.assets.find((a:any)=>i.src?.includes(a.file))?.bytes}))}));}
