import { dirname, join, resolve } from 'node:path';
import { load } from 'cheerio';
import { jsonFile, readRef, writeJson } from '../src/shopyy/artifacts.js';

const projectFile=resolve(process.argv[2]||''),root=dirname(projectFile),project=await jsonFile(projectFile);
if(new URL(project.sourceUrl).hostname!=='voidresearch.shop')throw Error('Site-specific observed search recipe');
const inventory=await jsonFile(join(root,'contracts/route-inventory.v2.json'));
const assets=await jsonFile(join(root,project.assetsDirectory,'source-current/manifest.json'));
const list=inventory.coverage.surfaces.find((s:any)=>s.path==='/shop'&&s.viewport==='desktop'&&s.state==='initial');
const listData=JSON.parse((await readRef(root,list.evidence)).toString()),$=load(listData.structure);
const products:any[]=[],pending:any[]=[];
for(const surface of inventory.coverage.surfaces.filter((s:any)=>s.path.startsWith('/product/')&&s.viewport==='desktop'&&s.state==='initial')){
  const data=JSON.parse((await readRef(root,surface.evidence)).toString()),detail=load(data.structure);
  let card:any=null;
  for(const link of $('a[href]').toArray().filter(n=>new URL($(n).attr('href')!,project.sourceUrl).pathname===surface.path)){
    card=$(link).parents().toArray().find(n=>{
      const el=$(n),paths=new Set(el.find('a[href]').toArray().map(a=>new URL($(a).attr('href')!,project.sourceUrl).pathname).filter(p=>p.startsWith('/product/')));
      return el.find('img').length>0&&paths.size===1&&/\$\d|coming soon/i.test(el.text());
    });if(card)break;
  }
  if(!card){pending.push({path:surface.path,reason:'No unambiguous rendered catalog card'});continue;}
  const el=$(card),image=el.find('img').first(),imageUrl=new URL(image.attr('src')!,project.sourceUrl).href,asset=assets.assets.find((a:any)=>a.url===imageUrl);
  if(!asset){pending.push({path:surface.path,reason:'Missing copied card image'});continue;}
  const prices=el.find('*').toArray().filter(n=>/^\$[\d,]+\.\d{2}$/.test($(n).text().trim()));
  const current=[...new Set(prices.filter(n=>!$(n).closest('.line-through').length).map(n=>$(n).text().trim()))];
  const compare=[...new Set(prices.filter(n=>$(n).closest('.line-through').length).map(n=>$(n).text().trim()))];
  if(current.length>1||compare.length>1){pending.push({path:surface.path,reason:'Ambiguous contextual card prices'});continue;}
  const size=detail('h1').siblings('p').toArray().map(n=>detail(n).text().trim()).find(t=>t.startsWith('Size:'))?.replace(/^Size:\s*/,'')||null;
  products.push({sourcePath:surface.path,targetPath:'/products/'+surface.path.split('/').pop(),title:detail('h1').first().text(),amount:size,cardPrice:current[0]||null,compareAt:compare[0]||null,comingSoon:/coming soon/i.test(el.text()),imageAsset:`images/source-current/${asset.file}`,sourceEvidence:[surface.evidence,list.evidence]});
}
const searchSurface=inventory.coverage.surfaces.find((s:any)=>s.path==='/'&&s.viewport==='desktop'&&s.state==='search-ghk');
const observedSearch=JSON.parse((await readRef(root,searchSurface.evidence)).toString()),search=load(observedSearch.structure);
const rank=search('[class~="z-[100]"] a[href]').toArray().map(n=>new URL(search(n).attr('href')!,project.sourceUrl).pathname).filter(p=>p.startsWith('/product/'));
const result={schemaVersion:2,role:'fixture-only-public-source-observations',sourceUrl:project.sourceUrl,products,observedRanks:{ghk:rank},pending,note:'Catalog card prices and selected detail amounts are separate observed contexts. No source identifiers are sent to a live cart, and this file is not a native SHOPYY catalog binding.'};
await writeJson(join(root,'common/content/search-fixture.json'),result);
console.log(JSON.stringify({products:products.length,rank,pending,status:result.role},null,2));
