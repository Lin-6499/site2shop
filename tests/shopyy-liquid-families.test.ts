import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {saveArtifact,writeJson,readRef,digest} from '../src/shopyy/artifacts.js';
import {renderFamilies} from '../src/shopyy/families.js';
import {shopyyAdapter} from '../src/shopyy/renderer.js';

async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'shopyy-liquid-'));
  const inventory=await saveArtifact(root,{routes:{'/product':{disposition:'mapped',targetPath:'/product',family:'product'}}});
  const project={platform:'shopyy',sourceUrl:'https://source.invalid',siteId:'test',familiesFile:'families.json',contentFile:'content.json',designContractFile:'design.json',capturePlanFile:'plan.json',pageContractsFile:'contracts.json',commonStyleFile:'style.css',assetsDirectory:'images',outputDirectory:'build',shopyy:{templateProfile:'liquid-default-v1',assetUrlFilter:'public_asset_abs_dir_url',assetPathPrefix:'lppeptide',variableMap:{title:'product.title',image:'product.src | public_front_asset_url',content:'page.content',productBody:'product.body_html',products:'collection.products',item:'vo.title'},routeMap:{}}};
  const config={schemaVersion:2,partials:{header:'header.htm'},nativeFiles:[{templateFile:'layout.htm',nativeFile:'layout/theme.liquid'},{templateFile:'header.htm',nativeFile:'snippets/header.liquid'}],families:{product:{templateFile:'product.htm',nativeFile:'templates/product_detail.liquid'}},pages:[{sourcePath:'/product',targetPath:'/product',family:'product',data:{title:'A & B',image:'/fixture.png',content:'<p onclick="run()">Rich <strong>text</strong></p><script>bad()</script>',products:[{item:'One'},{item:'Two'}]}}]};
  await writeJson(join(root,'families.json'),config);
  await writeFile(join(root,'header.htm'),'<header>Shared</header>');
  await writeFile(join(root,'layout.htm'),'<link href="{{asset:styles/page-contracts.css}}">{% include "header" %}{% template %}');
  await writeFile(join(root,'product.htm'),'{{#fixture}}<link href="{{asset:styles/page-contracts.css}}">{{include:header}}{{/fixture}}<h1>{{field:title}}</h1><img src="{{field:image}}"><article>{{html:content}}</article>{{#each:products}}<b>{{field:item}}</b>{{/each}}{{#native}}<i>{{ product.id }}</i><section data-lp-product-body>{{html:productBody}}</section>{{/native}}<img src="{{asset:images/x.png}}">');
  return {root,project,config,plan:{schemaVersion:2,inventory}as any};
}

test('Liquid family profile shares fixture markup and emits official native bindings/layout',async()=>{
  const f=await fixture();try{
    const r=await renderFamilies(f.root,f.project,f.plan),skin=r.native.get('templates/product_detail.liquid')!,html=[...r.preview.values()][0];
    assert.match(skin,/\{\{ product.title \| escape \}\}/);
    assert.match(skin,/\{\{ product.src \| public_front_asset_url \| escape \}\}/);
    assert.match(skin,/\{\{ page.content \| html_content_filter \}\}/);
    assert.match(skin,/\{\{ product.body_html \| html_content_filter \}\}/);
    assert.match(skin,/\{% for vo in collection.products %\}<b>\{\{ vo.title \| escape \}\}<\/b>\{% endfor %\}/);
    assert.match(skin,/\{\{ 'lppeptide\/images\/x.png' \| public_asset_abs_dir_url \}\}/);
    assert.match(skin,/\{\{ product.id \}\}/);assert.doesNotMatch(skin,/<header>/);
    assert.match(r.native.get('layout/theme.liquid')!,/\{% template %\}/);assert.equal(r.native.get('snippets/header.liquid'),'<header>Shared</header>');
    assert.match(html,/<header>Shared<\/header>/);assert.match(html,/<h1>A &amp; B<\/h1>/);
    assert.match(html,/<p>Rich <strong>text<\/strong><\/p>/);assert.doesNotMatch(html,/onclick|bad\(\)|product.id|html_content_filter/);
    assert.match(html,/<b>One<\/b><b>Two<\/b>/);assert.match(html,/\/assets\/lppeptide\/images\/x.png/);
    assert.ok(r.inputFiles.includes('layout.htm')&&r.inputFiles.includes('header.htm'));
    f.project.shopyy.variableMap.title='$product.title';await assert.rejects(renderFamilies(f.root,f.project,f.plan),/Unknown native field/);
  }finally{await rm(f.root,{recursive:true,force:true})}
});

test('Legacy htm profile preserves escaped fields, foreach and asset root',async()=>{
  const f=await fixture();try{
    f.project.shopyy.templateProfile='legacy';Object.assign(f.project.shopyy,{assetRootExpression:'<{$asset_root}>',variableMap:{title:'$goods.title',products:'$goods_list',item:'$vo.title'}});
    f.config.nativeFiles=[];f.config.families.product.nativeFile='product/detail.htm';await writeJson(join(f.root,'families.json'),f.config);
    await writeFile(join(f.root,'product.htm'),'<link href="{{asset:styles/page-contracts.css}}"><h1>{{field:title}}</h1>{{#each:products}}<b>{{field:item}}</b>{{/each}}');
    const r=await renderFamilies(f.root,f.project,f.plan),skin=r.native.get('product/detail.htm')!;
    assert.match(skin,/<\{\$goods.title\|escape\}>/);assert.match(skin,/<\{foreach from=\$goods_list item=vo\}>/);assert.match(skin,/<\{\$asset_root\}>\/styles\/page-contracts.css/);
    f.config.families.product.nativeFile='templates/product.liquid';await writeJson(join(f.root,'families.json'),f.config);await assert.rejects(renderFamilies(f.root,f.project,f.plan),/Unsafe native family output/);
  }finally{await rm(f.root,{recursive:true,force:true})}
});

test('Liquid adapter packages assets under matching filter prefix',async()=>{
  const f=await fixture();try{
    await writeJson(join(f.root,'project.json'),f.project);await writeJson(join(f.root,'plan.json'),f.plan);
    await writeJson(join(f.root,'content.json'),{source:f.project.sourceUrl});await writeJson(join(f.root,'design.json'),{source:f.project.sourceUrl});await writeJson(join(f.root,'contracts.json'),{});
    await writeFile(join(f.root,'style.css'),'body{color:black}');await mkdir(join(f.root,'images'));await writeFile(join(f.root,'images/x.png'),'fixture-image');
    const r=await shopyyAdapter.build({projectFile:join(f.root,'project.json'),prototype:true}as any);
    assert.equal(await readFile(join(r.outputDirectory,'theme/assets/lppeptide/images/x.png'),'utf8'),'fixture-image');
    assert.match(await readFile(join(r.outputDirectory,'theme/layout/theme.liquid'),'utf8'),/lppeptide\/styles\/page-contracts.css/);
    assert.ok(r.files.includes('templates/product_detail.liquid'));assert.ok(r.files.includes('snippets/header.liquid'));
  }finally{await rm(f.root,{recursive:true,force:true})}
});

test('Liquid tree assets preserve scoped CSS/media and hash the declared media map',async()=>{
  const f=await fixture();try{
    Object.assign(f.project.shopyy,{assetDirectoryLayout:'tree'});
    Object.assign(f.project,{workflow:{mediaAssetMapFile:'asset-map.json'}});
    await writeJson(join(f.root,'asset-map.json'),{'https://source.invalid/image.png':{relativePath:'images/x.png'}});
    await writeJson(join(f.root,'project.json'),f.project);await writeJson(join(f.root,'plan.json'),f.plan);
    await writeJson(join(f.root,'content.json'),{source:f.project.sourceUrl});await writeJson(join(f.root,'design.json'),{source:f.project.sourceUrl});await writeJson(join(f.root,'contracts.json'),{});
    await writeFile(join(f.root,'style.css'),'body{color:black}');
    for(const folder of ['images','styles','videos'])await mkdir(join(f.root,'images',folder),{recursive:true});
    await writeFile(join(f.root,'images/images/x.png'),'image');await writeFile(join(f.root,'images/styles/source.css'),'.scoped[data-v-abcd]{display:grid}');await writeFile(join(f.root,'images/videos/source.mp4'),'video');
    const r=await shopyyAdapter.build({projectFile:join(f.root,'project.json'),prototype:true}as any);
    assert.equal(await readFile(join(r.outputDirectory,'theme/assets/lppeptide/images/x.png'),'utf8'),'image');
    assert.equal(await readFile(join(r.outputDirectory,'theme/assets/lppeptide/styles/source.css'),'utf8'),'.scoped[data-v-abcd]{display:grid}');
    assert.equal(await readFile(join(r.outputDirectory,'theme/assets/lppeptide/videos/source.mp4'),'utf8'),'video');
    assert.ok(!r.files.includes('assets/lppeptide/images/images/x.png'));
    const manifest=JSON.parse(await readFile(r.manifestFile,'utf8')),mapRef=manifest.inputs.files.find((ref:any)=>ref.path==='asset-map.json');
    assert.equal(mapRef.sha256,digest(await readFile(join(f.root,'asset-map.json'))));
    await writeJson(join(f.root,'asset-map.json'),{});
    await assert.rejects(readRef(f.root,mapRef),/Changed evidence/);
  }finally{await rm(f.root,{recursive:true,force:true})}
});

test('Liquid native JSON resources preserve exact config/locale bytes in theme, manifest and ZIP with build-bound inputs',async()=>{
 const f=await fixture();try{
  Object.assign(f.project.shopyy,{nativeResourcesFile:'native-resources.json'});
  await writeJson(join(f.root,'project.json'),f.project);await writeJson(join(f.root,'plan.json'),f.plan);
  await writeJson(join(f.root,'content.json'),{source:f.project.sourceUrl});await writeJson(join(f.root,'design.json'),{source:f.project.sourceUrl});await writeJson(join(f.root,'contracts.json'),{});
  await writeFile(join(f.root,'style.css'),'body{color:black}');await mkdir(join(f.root,'images'));await writeFile(join(f.root,'images/x.png'),'fixture-image');
  const data=[['schema.json','config/settings_schema.json','[ { "name": "Official settings" }, { "name": "LP" } ]\n'],['settings.json','config/settings_data.json','{"current":{"lp_cnfc_collection":null}}\n'],['en.json','locales/en.json','{"label":"{{ unchanged composer token }}"}\n'],['es.json','locales/es.json','{"label":"Español"}\n'],['pt.json','locales/pt.json','{"label":"Português"}\n']];
  for(const[input,,bytes]of data)await writeFile(join(f.root,input),bytes);
  const spec={themeFiles:data.map(([input,output,bytes])=>({input,output,sha256:digest(bytes)}))};await writeJson(join(f.root,'native-resources.json'),spec);
  const r=await shopyyAdapter.build({projectFile:join(f.root,'project.json'),prototype:true}as any),manifest=JSON.parse(await readFile(r.manifestFile,'utf8'));
  const {unzipSync}=await import('fflate'),archive=unzipSync(await readFile(r.packageFile));
  for(const[input,output,bytes]of data){assert.deepEqual(await readFile(join(r.outputDirectory,'theme',output)),Buffer.from(bytes));assert.deepEqual(Buffer.from(archive[output]),Buffer.from(bytes));assert.ok(manifest.integrity.some((ref:any)=>ref.path==='theme/'+output&&ref.sha256===digest(bytes)));const ref=manifest.inputs.files.find((ref:any)=>ref.path===input);assert.equal(ref.sha256,digest(bytes));await writeFile(join(f.root,input),'{}');await assert.rejects(readRef(f.root,ref),/Changed evidence/);await writeFile(join(f.root,input),bytes);}
  const metadataRef=manifest.inputs.files.find((ref:any)=>ref.path==='native-resources.json');assert.ok(metadataRef);await writeJson(join(f.root,'native-resources.json'),{themeFiles:[]});await assert.rejects(readRef(f.root,metadataRef),/Changed evidence/);
  const build=()=>shopyyAdapter.build({projectFile:join(f.root,'project.json'),prototype:true}as any),entry=spec.themeFiles[0];
  for(const themeFiles of [[{...entry,output:'config/../settings_schema.json'}],[{...entry,output:'assets/script.js'}],[{...entry,output:'locales/../en.json'}],[{...entry,input:'../outside.json'}],[entry,entry],[{...entry,output:'locales/en.json'},{...spec.themeFiles[1],output:'locales/EN.json'}],[{...entry,sha256:'0'.repeat(64)}]]){await writeJson(join(f.root,'native-resources.json'),{themeFiles});await assert.rejects(build());}
  for(const invalid of ['null','"scalar"','23']){await writeFile(join(f.root,'schema.json'),invalid);await writeJson(join(f.root,'native-resources.json'),{themeFiles:[{...entry,sha256:digest(invalid)}]});await assert.rejects(build(),/object or array/);}
 }finally{await rm(f.root,{recursive:true,force:true});}
});


test('mapped media composer reuses the HTML owner and hashes upload, GET and raw-byte evidence in builds',async()=>{
 const f=await fixture();try{
  await mkdir(join(f.root,'images'));const media=Buffer.from('isolated PNG fixture'),sha256=digest(media),sourceUrl='https://source.invalid/certificate.png',targetUrl='https://merchant.invalid/media/certificate.png';await writeFile(join(f.root,'images/x.png'),media);
  const bytes=await saveArtifact(f.root,media,'bin'),uploadEvidence=await saveArtifact(f.root,{storeId:'240667',relativePath:'x.png',sourceSha256:sha256,params:{url:targetUrl}}),readback=await saveArtifact(f.root,{url:targetUrl,status:200,contentType:'image/png',sha256,bytes});
  await writeJson(join(f.root,'readback.json'),{schemaVersion:1,storeId:'240667',entries:[{storeId:'240667',relativePath:'x.png',sourceSha256:sha256,uploadEvidence,readback}]});await writeJson(join(f.root,'asset-map.json'),{[sourceUrl]:{relativePath:'x.png',sha256,contentType:'image/png'}});
  Object.assign(f.project,{workflow:{mediaAssetMapFile:'asset-map.json',mediaAssetReadbackFile:'readback.json',mediaAssetStoreId:'240667'}});
  const inventory=JSON.parse((await readRef(f.root,f.plan.inventory)).toString());inventory.routes['/certificate.png']={disposition:'mapped-media',media:{sourceUrl,sha256},rationale:'Explicit actual media identity'};f.plan.inventory=await saveArtifact(f.root,inventory);await writeFile(join(f.root,'product.htm'),'<link href="{{asset:styles/page-contracts.css}}"><h1>{{field:title}}</h1><a target="_blank" href="{{route:/certificate.png}}">Certificate</a>');
  const rendered=await renderFamilies(f.root,f.project,f.plan);assert.equal(rendered.preview.size,1);assert.match([...rendered.preview.values()][0],/href="\/assets\/lppeptide\/images\/x.png"/);assert.match(rendered.native.get('templates/product_detail.liquid')!,/href="https:\/\/merchant.invalid\/media\/certificate.png"/);assert.equal(rendered.native.size,3);
  await writeJson(join(f.root,'project.json'),f.project);await writeJson(join(f.root,'plan.json'),f.plan);await writeJson(join(f.root,'content.json'),{source:f.project.sourceUrl});await writeJson(join(f.root,'design.json'),{source:f.project.sourceUrl});await writeJson(join(f.root,'contracts.json'),{});await writeFile(join(f.root,'style.css'),'body{color:black}');
  const built=await shopyyAdapter.build({projectFile:join(f.root,'project.json'),prototype:true}as any),manifest=JSON.parse(await readFile(built.manifestFile,'utf8'));
  for(const file of ['readback.json','asset-map.json',uploadEvidence.path,readback.path,bytes.path,'images/x.png'])assert.ok(manifest.inputs.files.some((ref:any)=>ref.path===file),'Missing hashed input '+file);
  await writeFile(join(f.root,bytes.path),'changed raw response');await assert.rejects(readRef(f.root,manifest.inputs.files.find((ref:any)=>ref.path===bytes.path)),/Changed evidence/);await assert.rejects(shopyyAdapter.build({projectFile:join(f.root,'project.json'),prototype:true}as any),/Changed evidence/);
 }finally{await rm(f.root,{recursive:true,force:true})}
});


test('initial COA PNG build uses the standard SHOPYY skin asset filter without inventing a native CDN URL',async()=>{
 const f=await fixture();try{await mkdir(join(f.root,'images'));const bytes=Buffer.from('source PNG'),sha256=digest(bytes),sourceUrl='https://source.invalid/certificate.png';await writeFile(join(f.root,'images/x.png'),bytes);await writeJson(join(f.root,'asset-map.json'),{[sourceUrl]:{relativePath:'x.png',sha256,contentType:'image/png'}});Object.assign(f.project,{workflow:{mediaAssetMapFile:'asset-map.json'}});const inventory=JSON.parse((await readRef(f.root,f.plan.inventory)).toString());inventory.routes['/certificate.png']={disposition:'mapped-media',media:{sourceUrl,sha256}};f.plan.inventory=await saveArtifact(f.root,inventory);await writeFile(join(f.root,'product.htm'),'<link href="{{asset:styles/page-contracts.css}}"><h1>{{field:title}}</h1><a href="{{route:/certificate.png}}">COA</a>');const rendered=await renderFamilies(f.root,f.project,f.plan);assert.match(rendered.native.get('templates/product_detail.liquid')!,/\{\{ 'lppeptide\/images\/x.png' \| public_asset_abs_dir_url \}\}/);assert.doesNotMatch(rendered.native.get('templates/product_detail.liquid')!,/source.invalid|merchant.invalid/);assert.match([...rendered.preview.values()][0],/href="\/assets\/lppeptide\/images\/x.png"/);}finally{await rm(f.root,{recursive:true,force:true})}
});
