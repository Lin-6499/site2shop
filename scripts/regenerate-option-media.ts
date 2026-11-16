import { resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { familyProductSections, familyProductScript } from '../src/family-product-theme.js';
import { buildOptionMediaArtifacts, optionMediaScript, optionMediaStyles, type OptionMediaContract } from '../src/option-media-theme.js';
import { applyProductScrollOverrides } from '../src/product-scroll-theme.js';
import { readJson, write, json, hash } from '../src/util.js';
import { packageTheme } from '../src/compiler.js';
const out=resolve(process.argv[2]||'../westandwillow-phase3'),theme=join(out,'theme');
const contract=await readJson<OptionMediaContract>(join(out,'option-media-contracts.json'));
const binding=await readJson<any>(join(out,'phase3-product-template-binding.json'));
const consumers=binding.products.filter((p:any)=>p.templateSuffix==='s2s-embroidered').map((p:any)=>p.handle);
const artifacts=await buildOptionMediaArtifacts(out,contract,consumers);
const scroll=await readJson<any>(join(out,'product-scroll-contracts.json'));
const files:Record<string,string|Buffer>={
 'sections/s2s-embroidered-product.liquid':applyProductScrollOverrides(familyProductSections['s2s-embroidered-product'],scroll.overrides['s2s-embroidered-product']),
 'snippets/s2s-option-visual.liquid':artifacts.visual,
 'snippets/s2s-option-media-data.liquid':artifacts.data,
 'assets/s2s-option-media.js':optionMediaScript,
 'assets/s2s-option-media.css':optionMediaStyles,
 'assets/s2s-family-product-v3.js':familyProductScript,
 ...Object.fromEntries(Object.entries(artifacts.assets).map(([k,v])=>['assets/'+k,v]))
};
const before:Record<string,string|null>={};
for(const [name,bytes] of Object.entries(files)){
 const prior=await readFile(join(theme,name)).catch(()=>null);before[name]=prior?hash(prior):null;
 await write(join(theme,name),bytes);
}
await packageTheme(out);
await json(join(out,'option-media-build.json'),{schemaVersion:1,consumers,assetNames:artifacts.assetNames,contractHash:hash(await readFile(join(out,'option-media-contracts.json'))),build:await readJson(join(out,'theme-build.json')),files:Object.entries(files).map(([name,bytes])=>({name,before:before[name],sha256:hash(bytes)}))});
console.log(JSON.stringify({consumers,files:Object.keys(files),build:await readJson(join(out,'theme-build.json'))},null,2));
