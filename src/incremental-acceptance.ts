import { readFile, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, json, readJson } from './util.js';
import { assertGeneratedThemeIntegrity, normalizedThemeBuildBytes } from './theme-integrity.js';

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GENERATOR = basename(runtimeRoot) === '.codex-build' ? dirname(runtimeRoot) : runtimeRoot;
const BASE = 'incremental/baseline.json';
type Ref = { path: string; sha256: string };
type RouteDependencies = { template: string; generators: string[] };
type Config = { schemaVersion: 1; routes: Record<string, RouteDependencies>; bindingFiles: string[]; uncoveredResourcePaths?: string[] };
function requireScope(ok: unknown, message: string): asserts ok { if (!ok) throw new Error('Incremental acceptance blocked: ' + message); }
export async function boundArtifact(out: string, ref: Ref) {
  requireScope(ref && typeof ref.path === 'string' && !isAbsolute(ref.path), 'invalid artifact path');
  const root = await realpath(out), file = await realpath(resolve(root, ref.path));
  requireScope(!relative(root, file).startsWith('..') && !isAbsolute(relative(root, file)), 'artifact escapes project');
  const bytes = await readFile(file); requireScope(hash(bytes) === ref.sha256, 'artifact changed: ' + ref.path);
  return JSON.parse(bytes.toString());
}
async function snapshot(root: string, prefix = '', normalize = false): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const e of await readdir(join(root, prefix), { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const name = prefix + e.name;
    requireScope(!e.isSymbolicLink(), 'symlink cannot establish file isolation: ' + name);
    if (e.isDirectory()) Object.assign(result, await snapshot(root, name + '/', normalize));
    else { const bytes = await readFile(join(root, name)); result[name] = hash(Buffer.from(normalize ? normalizedThemeBuildBytes(name, bytes) : bytes)); }
  }
  return result;
}
const difference = (before: Record<string, string>, after: Record<string, string>) => [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(f => before[f] !== after[f]).sort();
async function sourceClosure(file: string, seen = new Set<string>()): Promise<Set<string>> {
  if (seen.has(file)) return seen; seen.add(file);
  const text = await readFile(join(GENERATOR, file), 'utf8');
  for (const m of text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
    const dependency = relative(GENERATOR, resolve(GENERATOR, dirname(file), m[1].replace(/\.js$/, '.ts'))).replaceAll('\\', '/');
    requireScope(!dependency.startsWith('../'), 'generator import outside source tree');
    await sourceClosure(dependency, seen);
  }
  return seen;
}

// Explicit resource bindings, not route-name heuristics, select product/page templates.
export async function initializeIncrementalAcceptance(out: string) {
  const plan = await readJson<any>(join(out, 'capture-plan.json'));
  const bindings = await readJson<any>(join(out, 'phase3-product-template-binding.json')).catch(() => ({ products: [] }));
  const pages = await readJson<any>(join(out, 'phase3-page-binding.json')).catch(() => ({ pages: [] }));
  const collections=await readJson<any>(join(out,'phase4-collection-binding.json')).catch(()=>({collections:[]}));
  const registry = await readJson<any>(join(out, 'generator-presentation-bindings.json'));
  const config: Config = { schemaVersion: 1, routes: {}, bindingFiles: ['phase3-product-template-binding.json', 'phase3-page-binding.json', 'phase4-collection-binding.json'] };
  config.bindingFiles = (await Promise.all(config.bindingFiles.map(async f => await readFile(join(out, f)).then(() => f).catch(() => null)))).filter((f): f is string => !!f);
  for (const [rid, rp] of Object.entries<any>(plan.routes)) {
    const parts = new URL(rp.target.url).pathname.split('/').filter(Boolean), handle = parts.at(-1);
    const type = !parts.length ? 'index' : ({ products: 'product', collections: 'collection', pages: 'page', blogs: 'blog', cart: 'cart' } as Record<string,string>)[parts[0]];
    requireScope(type, 'declare template binding for ' + rid);
    const binding = type === 'product' ? bindings.products.find((p: any) => p.handle === handle) : type === 'page' ? pages.pages.find((p: any) => p.handle === handle) : null;
    if (type === 'product' || type === 'page') requireScope(binding && typeof binding.templateSuffix === 'string', 'missing resource template readback: ' + rid);
    const suffix = binding?.templateSuffix;
    const template = `templates/${type}${suffix ? '.' + suffix : ''}.json`;
    await readFile(join(out, 'theme', template));
    const owners = registry.entries.filter((e: any) => e.routeId === rid).flatMap((e: any) => Object.values<any>(e.owners || {}).map(b => b.generator)).filter(Boolean);
    requireScope(owners.length, 'missing generator ownership: ' + rid);
    config.routes[rid] = { template, generators: [...new Set<string>(owners)] };
  }
  const plannedPaths=new Set(Object.values<any>(plan.routes).map(r=>new URL(r.target.url).pathname));
  const resourcePaths=[...bindings.products.map((p:any)=>'/products/'+p.handle),...pages.pages.map((p:any)=>'/pages/'+p.handle),...collections.collections.map((p:any)=>'/collections/'+p.handle)];
  if(await readFile(join(out,'theme/templates/cart.json')).catch(()=>null))resourcePaths.push('/cart');
  config.uncoveredResourcePaths=[...new Set<string>(resourcePaths)].filter(p=>!plannedPaths.has(p));
  await json(join(out, 'acceptance-dependencies.json'), config);
  return { routeCount: Object.keys(config.routes).length, uncoveredResourcePaths:config.uncoveredResourcePaths, config: 'acceptance-dependencies.json', baselineCreated: false };
}

async function dependencies(out: string, config: Config, files: Record<string,string>) {
  const routes: Record<string, { files: string[]; generators: string[]; unknown: string[] }> = {};
  for (const [rid, binding] of Object.entries(config.routes)) {
    const seen = new Set<string>(), unknown: string[] = [];
    async function visit(name: string) {
      if (seen.has(name)) return; seen.add(name);
      if (!files[name]) { unknown.push('missing dependency ' + name); return; }
      if (!/\.(?:json|liquid|js|css)$/.test(name)) return;
      const text = await readFile(join(out, 'theme', name), 'utf8');
      if (name.endsWith('.json')) {
        try { const data = JSON.parse(text.replace(/^\s*\/\*[\s\S]*?\*\//, '')); for (const section of Object.values<any>(data.sections || {})) if (section.type) await visit('sections/' + section.type + '.liquid'); }
        catch { unknown.push('unparsed JSON ' + name); }
      }
      for (const m of text.matchAll(/\{%[-]?\s*(render|include|section|sections)\s+([^%]+)%\}/g)) {
        const literal = m[2].match(/^['"]([^'"]+)['"]/);
        if (!literal) { unknown.push('dynamic Liquid dependency ' + name); continue; }
        await visit((m[1] === 'sections' ? 'sections/' : m[1] === 'section' ? 'sections/' : 'snippets/') + literal[1] + (m[1] === 'sections' ? '.json' : '.liquid'));
      }
      for (const m of text.matchAll(/['"]([^'"\s/]+\.(?:js|css|svg|png|jpe?g|webp|woff2?|gif))['"]\s*\|\s*asset_url/g)) await visit('assets/' + m[1]);
      for (const m of text.matchAll(/(?:url\(\s*['"]?|(?:src|href)=["'])(?:\/assets\/)([^'"\s)?]+)/g)) await visit('assets/' + m[1]);
      // Relative CSS/JS imports extend the graph. Dynamic asset expressions cannot prove isolation.
      if (/\.(?:css|js)$/.test(name)) for (const m of text.matchAll(/(?:url\(\s*['"]?|from\s*['"]|import\s*['"])(\.\.?\/[^'"\s)]+)/g)) await visit(relative(join(out,'theme'),resolve(out,'theme',dirname(name),m[1])).replaceAll('\\','/'));
      for (const expression of text.matchAll(/\{\{([^{}]+?)\|\s*asset_url/g)) if (!/^\s*['"][^'"]+['"]\s*$/.test(expression[1])) unknown.push('dynamic asset dependency ' + name);
    }
    await visit('layout/theme.liquid'); await visit(binding.template);
    const owners = new Set<string>(); for (const owner of binding.generators) for (const f of await sourceClosure(owner)) owners.add(f);
    routes[rid] = { files: [...seen].sort(), generators: [...owners].sort(), unknown };
  }
  return routes;
}
async function fileHashes(out: string, names: string[]) {
  return Object.fromEntries(await Promise.all(names.map(async name => [name, hash(await readFile(join(out,name)))])));
}
export async function currentAcceptanceInputs(out: string) {
  const plan = await readJson<any>(join(out, 'capture-plan.json')), config = await readJson<Config>(join(out,'acceptance-dependencies.json'));
  requireScope(config.schemaVersion === 1 && JSON.stringify(Object.keys(config.routes).sort()) === JSON.stringify(Object.keys(plan.routes).sort()), 'dependency route inventory differs from independent capture plan');
  const registry=await readJson<any>(join(out,'generator-presentation-bindings.json')).catch(()=>null);
  const products=await readJson<any>(join(out,'phase3-product-template-binding.json')).catch(()=>null);
  const pages=await readJson<any>(join(out,'phase3-page-binding.json')).catch(()=>null);
  for(const[rid,binding]of Object.entries(config.routes)){
    if(registry){const owners=[...new Set<string>(registry.entries.filter((e:any)=>e.routeId===rid).flatMap((e:any)=>Object.values<any>(e.owners||{}).map(o=>o.generator)))].sort();requireScope(JSON.stringify(owners)===JSON.stringify([...binding.generators].sort()),'generator ownership changed; reinitialize dependency configuration for '+rid);}
    const parts=new URL(plan.routes[rid].target.url).pathname.split('/').filter(Boolean),kind=parts[0]==='products'?'product':parts[0]==='pages'?'page':null;
    const resource=kind==='product'?products?.products?.find((p:any)=>p.handle===parts.at(-1)):kind==='page'?pages?.pages?.find((p:any)=>p.handle===parts.at(-1)):null;
    if(resource)requireScope(binding.template===`templates/${kind}${resource.templateSuffix?'.'+resource.templateSuffix:''}.json`,'resource template binding changed; reinitialize dependencies for '+rid);
  }
  const theme = await snapshot(join(out,'theme'), '', true), generator = await snapshot(join(GENERATOR,'src'));
  const sourceCheck=await readJson<any>(join(out,'source-precheck.json')).catch(()=>null);
  const sourceFingerprints=Object.fromEntries(Object.entries<any>(sourceCheck?.workflows||{}).map(([key,v])=>[key,{fingerprint:v.fingerprint,checkedAt:v.checkedAt,passed:v.passed}]));
  const sourceCoverage=await readJson<any>(join(out,'source-coverage.json')).catch(()=>null);
  const sourceCaptureFingerprints=Object.fromEntries(Object.entries<any>(sourceCoverage?.routes||{}).flatMap(([rid,r])=>Object.entries<any>(r.viewports||{}).map(([vp,v])=>[`${rid}/${vp}`,v.sourceFingerprint??null])));
  return { plan, theme, sourceFingerprints, sourceCaptureFingerprints, uncoveredResourcePaths:config.uncoveredResourcePaths||[], generator: Object.fromEntries(Object.entries(generator).map(([f,h]) => ['src/'+f,h])), routes: await dependencies(out,config,theme), contract: await fileHashes(out,['capture-plan.json','acceptance-dependencies.json',...config.bindingFiles]) };
}
async function archiveEvidence(out: string, filename: string, tree: Record<string,string>, visited=new Set<string>()) {
  const bytes = await readFile(join(out,filename)), digest=hash(bytes), saved=`incremental/artifacts/${digest}.json`;
  await json(join(out,saved),JSON.parse(bytes.toString())); tree[saved]=hash(await readFile(join(out,saved)));
  async function visit(value: any) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.path==='string' && typeof value.sha256==='string') {
      const identity=value.path+':'+value.sha256;if(visited.has(identity))return;visited.add(identity);
      const path=resolve(out,value.path); requireScope(!isAbsolute(value.path)&&!relative(resolve(out),path).startsWith('..'),'evidence escapes project');
      const raw=await readFile(path); requireScope(hash(raw)===value.sha256,'evidence hash mismatch '+value.path);
      const copy=`incremental/objects/${value.sha256}.bin`;
      await writeImmutable(out,copy,raw);tree[copy]=value.sha256;
      if (value.path.endsWith('.json')) await visit(JSON.parse(raw.toString()));
    }
    for(const [k,v]of Object.entries(value)) {
      if(['priorCoverage','generator','generated'].includes(k)) continue;
      if(Array.isArray(v)) for(const item of v) await visit(item);
      else if(v && typeof v==='object') await visit(v);
    }
  }
  await visit(JSON.parse(bytes.toString())); return {path:saved,sha256:tree[saved]};
}
async function writeImmutable(out:string,name:string,bytes:Buffer){const existing=await readFile(join(out,name)).catch(()=>null);requireScope(!existing||hash(existing)===hash(bytes),'immutable evidence object was corrupted');if(!existing){const{write}=await import('./util.js');await write(join(out,name),bytes);}}
// Caller must execute full objective + paired + visual gates first; never seal a partial report.
export async function sealAcceptanceBaseline(out: string, validateFull: () => Promise<void>) {
  await validateFull(); const inputs=await currentAcceptanceInputs(out),build=await assertGeneratedThemeIntegrity(out),deployment=await readJson<any>(join(out,'deployment.json'));
  requireScope(!inputs.uncoveredResourcePaths.length,'imported product routes are missing from independent plan: '+inputs.uncoveredResourcePaths.join(', '));
  for(const rid of Object.keys(inputs.routes))for(const vp of Object.keys(inputs.plan.viewports))requireScope(inputs.sourceFingerprints[`${rid}/${vp}`]?.passed&&inputs.sourceFingerprints[`${rid}/${vp}`]?.fingerprint,'full baseline lacks source fingerprint '+rid+'/'+vp);
  for(const[key,check]of Object.entries(inputs.sourceFingerprints))requireScope(inputs.sourceCaptureFingerprints[key]===check.fingerprint,'source captures are not bound to latest fingerprint: '+key);
  requireScope(deployment.themeBuild===build.actual&&deployment.role==='unpublished'&&!deployment.published,'baseline needs the tested unpublished deployment');
  for(const stage of ['preflight','online']){const coverage=await readJson<any>(join(out,`${stage}-coverage.json`));const paired=await readJson<any>(join(out,`paired-browser-review.${stage}.json`));const visual=await readJson<any>(join(out,`agent-visual-review.${stage}.json`));requireScope(coverage.buildId===build.actual&&paired.themeBuild===build.actual&&visual.themeBuild===build.actual,'full evidence changed build during baseline validation');}
  const tree:Record<string,string>={},evidence:Record<string,Ref>={};
  for(const f of ['source-coverage.json','preflight-coverage.json','online-coverage.json','paired-browser-review.preflight.json','paired-browser-review.online.json','agent-visual-review.preflight.json','agent-visual-review.online.json']) evidence[f]=await archiveEvidence(out,f,tree);
  const routeReceipts=Object.fromEntries(Object.keys(inputs.routes).map(id=>[id,{buildId:build.actual,evidence}]));
  const baseline={schemaVersion:1,buildId:build.actual,themeId:String(deployment.themeId),sealedAt:new Date().toISOString(),inputs,evidence,tree,routeReceipts};
  await json(join(out,BASE),baseline);return {buildId:build.actual,routeCount:Object.keys(inputs.routes).length,baseline:BASE};
}
export async function planIncrementalAcceptance(out: string, primaryRoutes: string[] = []) {
  const inputs=await currentAcceptanceInputs(out),build=(await assertGeneratedThemeIntegrity(out)).actual;
  const baseline=await readJson<any>(join(out,BASE)).catch(()=>null),all=Object.keys(inputs.routes).sort();
  const reasons:string[]=[],changed:string[]=[],owners:string[]=[],sourceRefreshRequired:string[]=[],sourceCaptureRequired:string[]=[];
  if(inputs.uncoveredResourcePaths.length)reasons.push('Imported routes missing from capture plan: '+inputs.uncoveredResourcePaths.join(', '));
  if(!baseline) reasons.push('No validated full acceptance baseline; first run requires all scoped routes.');
  else {
    requireScope(baseline.schemaVersion===1,'unsupported baseline');
    for(const[file,digest]of Object.entries<string>(baseline.tree)) requireScope(hash(await readFile(join(out,file)))===digest,'retained baseline evidence changed: '+file);
    changed.push(...difference(baseline.inputs.theme,inputs.theme)); owners.push(...difference(baseline.inputs.generator,inputs.generator));
    if(difference(baseline.inputs.contract,inputs.contract).length)reasons.push('Capture/route/resource/asset contracts changed; rebuild full baseline.');
    if(changed.some(f=>f.startsWith('layout/')||f.startsWith('config/')||f.startsWith('locales/')))reasons.push('Global layout/configuration/locales changed.');
    if(Object.values(inputs.routes).some(r=>r.unknown.length)||Object.values<any>(baseline.inputs.routes).some(r=>r.unknown.length))reasons.push('Dynamic/missing dependency prevents proof of route isolation.');
    if(owners.some(f=>!all.some(r=>inputs.routes[r].generators.includes(f))))reasons.push('Changed generator has no proven consumer ownership.');
    if(changed.some(f=>!all.some(r=>inputs.routes[r].files.includes(f)||baseline.inputs.routes[r]?.files.includes(f))))reasons.push('Changed generated output has no proven consumer.');
    for(const rid of all)for(const vp of Object.keys(inputs.plan.viewports)){const check=inputs.sourceFingerprints[`${rid}/${vp}`];if(!check?.passed||!check.fingerprint||!Number.isFinite(Date.parse(check.checkedAt))||Date.now()-Date.parse(check.checkedAt)>86400000||Date.parse(check.checkedAt)>Date.now()+60000)sourceRefreshRequired.push(`${rid}/${vp}`);}
    for(const rid of all)for(const vp of Object.keys(inputs.plan.viewports)){const key=`${rid}/${vp}`;if(inputs.sourceCaptureFingerprints[key]!==inputs.sourceFingerprints[key]?.fingerprint)sourceCaptureRequired.push(key);}
  }
  for(const r of primaryRoutes)requireScope(all.includes(r),'unknown primary route '+r);
  let affected=baseline?all.filter(r=>changed.some(f=>inputs.routes[r].files.includes(f)||baseline.inputs.routes[r]?.files.includes(f))||owners.some(f=>inputs.routes[r].generators.includes(f)||baseline.inputs.routes[r]?.generators.includes(f))||Object.keys(inputs.plan.viewports).some(vp=>inputs.sourceFingerprints[`${r}/${vp}`]?.fingerprint!==baseline.inputs.sourceFingerprints?.[`${r}/${vp}`]?.fingerprint)):all;
  if(!reasons.length&&affected.length===all.length&&affected.length)reasons.push('Changed dependency is consumed by all scoped routes.');
  if(reasons.length)affected=all;
  const impact={schemaVersion:2,mode:reasons.length?'full':'incremental',buildId:build,baselineBuildId:baseline?.buildId??null,baseline:baseline?{path:BASE,sha256:hash(await readFile(join(out,BASE)))}:null,inputsDigest:hash(JSON.stringify(inputs)),changedFiles:changed,changedGeneratorOwners:owners,requiredRouteIds:affected,replayRequired:affected.filter(r=>!primaryRoutes.length||primaryRoutes.includes(r)),boundedConsumerSmoke:affected.filter(r=>primaryRoutes.length&&!primaryRoutes.includes(r)),reusableUnchanged:all.filter(r=>!affected.includes(r)),viewports:Object.keys(inputs.plan.viewports),reasons,sourceRefreshRequired,sourceCaptureRequired,zeroChanges:!!baseline&&!affected.length&&!reasons.length};
  await json(join(out,'incremental/impact.json'),impact);return impact;
}
export async function incrementalContext(out:string) {
  const configured=await readFile(join(out,'acceptance-dependencies.json')).catch(()=>null);
  if(!configured)return null;
  const impact=await planIncrementalAcceptance(out);
  requireScope(!impact.sourceRefreshRequired.length,'refresh stale source fingerprints with evidence-capture --stage source --precheck-only before reusing evidence; no full-site interaction replay is implied');
  requireScope(!impact.sourceCaptureRequired.length,'changed source needs fresh source captures for: '+impact.sourceCaptureRequired.join(', '));
  if(impact.mode!=='incremental')return null;
  const baseline=await boundArtifact(out,impact.baseline!);
  return {impact,baseline,routeIds:impact.requiredRouteIds};
}
export async function promoteAcceptanceBaseline(out:string,validateDelta:()=>Promise<void>){
  const before=await incrementalContext(out);requireScope(before&&!before.impact.zeroChanges,'no uncommitted incremental acceptance to promote');
  await validateDelta();const current=await incrementalContext(out);requireScope(current?.impact.inputsDigest===before.impact.inputsDigest,'implementation changed during acceptance');
  const tree={...before.baseline.tree},evidence:Record<string,Ref>={};
  for(const stage of ['preflight','online'])for(const type of ['coverage','paired','visual']){const name=type==='coverage'?`${stage}-coverage.incremental.json`:`${type==='paired'?'paired-browser-review':'agent-visual-review'}.${stage}.incremental.json`;evidence[name]=await archiveEvidence(out,name,tree);}
  const routeReceipts={...before.baseline.routeReceipts};for(const rid of before.routeIds)routeReceipts[rid]={buildId:before.impact.buildId,evidence};
  const prior=await readFile(join(out,BASE));const priorPath=`incremental/artifacts/${hash(prior)}.baseline.json`;await writeImmutable(out,priorPath,prior);tree[priorPath]=hash(prior);
  const next={...before.baseline,buildId:before.impact.buildId,sealedAt:new Date().toISOString(),inputs:await currentAcceptanceInputs(out),tree,routeReceipts,latestEvidence:evidence,previousBaseline:{path:priorPath,sha256:hash(prior)}};
  await json(join(out,BASE),next);return{buildId:next.buildId,promotedRoutes:before.routeIds,retainedRoutes:before.impact.reusableUnchanged,baseline:BASE};
}
