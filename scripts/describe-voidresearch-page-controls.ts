import {resolve,dirname,join} from 'node:path';
import {jsonFile,readRef} from '../src/shopyy/artifacts.js';
import {load} from 'cheerio';
const file=resolve(process.argv[2]),root=dirname(file),inventory=await jsonFile(join(root,'contracts/route-inventory.v2.json'));
const paths=process.argv.slice(3);
for(const path of paths){const s=inventory.coverage.surfaces.find((s:any)=>s.path===path&&s.viewport==='desktop'&&s.state==='initial');if(!s)continue;const d=JSON.parse((await readRef(root,s.evidence)).toString()),$=load(d.structure);$('header,footer,script,noscript,body > div:has(#intl-waitlist-email)').remove();console.log(JSON.stringify({path,title:d.title,headings:$('h1,h2,h3').map((_,n)=>$(n).text()).get(),controls:$('button,input,select,textarea,summary').map((_,n)=>({tag:n.tagName,label:$(n).attr('aria-label')||$(n).text().trim().replace(/\s+/g,' '),type:$(n).attr('type'),placeholder:$(n).attr('placeholder'),options:$(n).is('select')?$(n).find('option').map((_,o)=>({value:$(o).attr('value'),text:$(o).text()})).get():undefined})).get()}));}
