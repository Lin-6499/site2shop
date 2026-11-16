import {dirname,join,resolve} from 'node:path';
import {readdir,mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {jsonFile,readRef,writeJson,digest} from '../src/shopyy/artifacts.js';

// Review aids only. Raw screenshots and their hashes remain authoritative; never auto-pass images.
const root=dirname(resolve(process.argv[2]||'')),evidence=join(root,'verification/recon-current');
const output=join(evidence,'review-pairs');await mkdir(output,{recursive:true});
const rows:any[]=[];
const only=process.argv.find(v=>v.startsWith('--only='))?.slice(7).split(',');
for(const file of (await readdir(evidence)).filter(f=>/^home-development-comparison(?:-[a-z]+)?\.json$/.test(f)).sort()){
 const report=await jsonFile(join(evidence,file));
 if(only&&!only.includes(report.scenario))continue;
 for(const row of report.comparisons){
  if(row.errors?.length){rows.push({scenario:report.scenario,viewport:row.viewport,verdict:'blocked',errors:row.errors});continue;}
  const a=await readRef(join(evidence,'inspections',report.sourceId),row.sourceScreenshot);
  const b=await readRef(join(evidence,'inspections',report.targetId),row.targetScreenshot);
  const meta=await sharp(a).metadata(),width=Math.min(720,meta.width!),height=Math.round(meta.height!*width/meta.width!);
  const label=Buffer.from(`<svg width="${width*2}" height="32"><rect width="100%" height="100%" fill="#ffffff"/><g font-family="Arial" font-size="14" fill="#151515"><text x="12" y="21">SOURCE / ${report.scenario} / ${row.viewport}</text><text x="${width+12}" y="21">LOCAL DEVELOPMENT / ${report.scenario} / ${row.viewport}</text></g></svg>`);
  const jpg=await sharp({create:{width:width*2,height:height+32,channels:3,background:'#fff'}}).composite([
   {input:label,left:0,top:0},{input:await sharp(a).resize(width,height).toBuffer(),left:0,top:32},{input:await sharp(b).resize(width,height).toBuffer(),left:width,top:32},
  ]).jpeg({quality:95}).toBuffer();
  const name=`${report.scenario.toLowerCase()}-${row.viewport}-${digest(jpg).slice(0,12)}.jpg`;
  await writeFile(join(output,name),jpg);
  const fullPageTiles:any[]=[];
  let fullPageOverview:any=null;
  if(process.argv.includes('--overview')){
   const source=await readRef(join(evidence,'inspections',report.sourceId),row.sourceFullPage);
   const target=await readRef(join(evidence,'inspections',report.targetId),row.targetFullPage);
   const sm=await sharp(source).metadata(),tm=await sharp(target).metadata();
   const w=Math.max(1,Math.floor(Math.min(360,2400*sm.width!/Math.max(sm.height!,tm.height!))));
   const sh=Math.round(sm.height!*w/sm.width!),th=Math.round(tm.height!*w/tm.width!);
   const buffer=await sharp({create:{width:w*2,height:Math.max(sh,th)+32,channels:3,background:'#f0f0f0'}}).composite([
    {input:Buffer.from(`<svg width="${w*2}" height="32"><rect width="100%" height="100%" fill="white"/><text x="4" y="13" font-family="Arial" font-size="10">${report.scenario} / ${row.viewport} / SOURCE | LOCAL</text></svg>`),left:0,top:0},
    {input:await sharp(source).resize(w,sh).toBuffer(),left:0,top:32},
    {input:await sharp(target).resize(w,th).toBuffer(),left:w,top:32},
   ]).jpeg({quality:95}).toBuffer();
   const overviewName=`${report.scenario.toLowerCase()}-${row.viewport}-overview-${digest(buffer).slice(0,12)}.jpg`;
   await writeFile(join(output,overviewName),buffer);
   fullPageOverview={path:`review-pairs/${overviewName}`,sha256:digest(buffer),role:'whole-page-composition-overview; detailed typography requires viewport images or full-page tiles'};
  }
  if(process.argv.includes('--full-page')){
   const source=await readRef(join(evidence,'inspections',report.sourceId),row.sourceFullPage);
   const target=await readRef(join(evidence,'inspections',report.targetId),row.targetFullPage);
   const sm=await sharp(source).metadata(),tm=await sharp(target).metadata();
   if(sm.width!==tm.width)throw Error('Full-page review requires equivalent viewport widths');
   const maxHeight=Math.max(sm.height!,tm.height!),tileHeight=1000;
   for(let y=0;y<maxHeight;y+=tileHeight){
    const h=Math.min(tileHeight,maxHeight-y),scaledHeight=Math.round(h*width/sm.width!);
    const parts:any[]=[{input:label,left:0,top:0}];
    for(const [bytes,metadata,left]of [[source,sm,0],[target,tm,width]] as const){
     if(y>=metadata.height!)continue;
     const cropHeight=Math.min(h,metadata.height!-y);
     parts.push({input:await sharp(bytes).extract({left:0,top:y,width:metadata.width!,height:cropHeight}).resize(width,Math.round(cropHeight*width/metadata.width!)).toBuffer(),left,top:32});
    }
    const tile=await sharp({create:{width:width*2,height:scaledHeight+32,channels:3,background:'#f0f0f0'}}).composite(parts).jpeg({quality:95}).toBuffer();
    const tileName=`${report.scenario.toLowerCase()}-${row.viewport}-full-y${y}-${digest(tile).slice(0,12)}.jpg`;
    await writeFile(join(output,tileName),tile);
    fullPageTiles.push({y,height:h,path:`review-pairs/${tileName}`,sha256:digest(tile)});
   }
  }
  rows.push({scenario:report.scenario,viewport:row.viewport,verdict:'pending',rationale:'',report:file,developmentRenderSha256:report.developmentRenderSha256||null,source:row.sourceScreenshot,target:row.targetScreenshot,reviewImage:{path:`review-pairs/${name}`,sha256:digest(jpg)},sourceFullPage:row.sourceFullPage,targetFullPage:row.targetFullPage,fullPageOverview,fullPageTiles,structuredDifferences:row.differences,pixelDiagnostic:row.pixelDiagnostic});
 }
}
await writeJson(join(evidence,only?'development-visual-review-subset.pending.json':'development-visual-review.pending.json'),{kind:'development-review-aid-not-build-acceptance',reviewer:'',reviewedAt:'',rows});
console.log(JSON.stringify({reviewImages:rows.filter(r=>r.reviewImage).length,blocked:rows.filter(r=>r.verdict==='blocked').length,output},null,2));
