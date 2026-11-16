import {verifyMediaDelivery} from './media-comparison.js';
import { Command } from "commander";
import { dirname, join, resolve } from "node:path";
import { readFile, cp, mkdir } from "node:fs/promises";
import { discover } from "./discovery.js";
import { collect, prepareReview, submitReview, inspectSourceComponents, collectSourceScope } from "./browser.js";
import { loadPlan, recordGate } from "./gates.js";
import { buildIdentity, digest, jsonFile, readRef, saveArtifact, writeJson } from "./artifacts.js";
import { buildPlatform } from "../platform.js";
import type { Capture, Evidence } from "./contracts.js";
import { checkSourceSession, openSourceSession, prepareSourcePreferences } from "./source-session.js";
import { collectSourceAssets } from "./source-assets.js";
import { prepareComposerInputs } from "./composer-inputs.js";
import { verifyScopedSource, exportScopedContracts } from './scoped-contracts.js';
import { loadScopedPlan, isSourceOnlyPlan, validateSourcePlan, verifySourceInventory } from './source-plan.js';

export async function exportContracts(projectFile:string) {
  if(isSourceOnlyPlan((await loadScopedPlan(projectFile)).plan))throw Error('Source-only plan cannot export global contracts; use contracts-scope');
  const check=await recordGate(projectFile,"source"); if(!check.passed)throw Error("Source gate failed; page contracts were not replaced");
  const ctx=await loadPlan(projectFile),evidence:Evidence=await jsonFile(join(ctx.evidenceRoot,"source.json"));
  const captures:unknown[]=[];
  for(const session of evidence.sessions)for(const node of session.checks)if(node.kind==="state"){
    const ref=node.before.source!,cap:Capture=JSON.parse((await readRef(ctx.evidenceRoot,ref)).toString());
    captures.push({route:session.route,viewport:session.viewport,state:cap.state,sourceCapture:ref,components:cap.components});
  }
  // Style bindings are an agent-authored, project-owned mapping. Preserve them only if source hashes still match.
  const path=resolve(ctx.projectRoot,ctx.project.pageContractsFile),old=await jsonFile(path).catch(()=>({bindings:[]}));
  const validHashes=new Set((captures as any[]).map(c=>c.sourceCapture.sha256));
  const bindings=(old.bindings||[]).filter((b:any)=>validHashes.has(b.sourceCapture?.sha256));
  await writeJson(path,{schemaVersion:2,sourceUrl:ctx.plan.sourceUrl,planSha256:ctx.planSha256,captures,bindings,status:bindings.length?"mapped":"captured-needs-generator-binding"});return path;
}

export async function packageForDraft(projectFile:string,destination:string){
  const preflight=await recordGate(projectFile,"preflight");if(!preflight.passed)throw Error(`Draft packaging blocked: ${preflight.findings.length} findings`);
  const ctx=await loadPlan(projectFile),build=await buildIdentity(ctx.output);await verifyMediaDelivery(ctx.projectRoot,ctx.project,build.manifest,true);
  // No platform upload API is assumed. Package only the exact validated build for a later authorized draft install.
  const target=resolve(destination);if(target===ctx.projectRoot||target===ctx.output)throw Error("Use a separate handoff directory");await mkdir(target,{recursive:true});
  await cp(join(ctx.output,build.manifest.package.file),join(target,build.manifest.package.file));
  const record={schemaVersion:2,buildId:build.id,packageSha256:build.manifest.package.sha256,role:"draft-handoff",onlineStatus:"not-verified",uploadPerformed:false};await writeJson(join(target,"handoff.json"),record);return record;
}

export function registerShopyyCommands(cli:Command){
  const report=(value:any)=>{console.log(JSON.stringify(value,null,2));if(value?.passed===false||value?.complete===false)process.exitCode=2;};
  const group=cli.command("shopyy-workflow").description("SHOPYY evidence-led replication: discover → plan → capture → contracts → build → pair → review → draft handoff");
  group.command("source-session").description("Open a project-owned browser for manual login, or validate its locally retained source session").requiredOption("--project <file>").option("--open","Open an interactive browser; sign in yourself then close its window").option("--prepare","Operate explicitly configured visible notice dismissal buttons in the dedicated local profile").action(async o=>{if(o.open&&o.prepare)throw Error('Choose either manual login or preference preparation');report(o.open ? await openSourceSession(resolve(o.project)) : o.prepare ? await prepareSourcePreferences(resolve(o.project)) : await checkSourceSession(resolve(o.project)))});
  group.command("source-assets").description("Copy observed public images and stylesheets with source hashes; no scripts").requiredOption("--project <file>").action(async o=>report(await collectSourceAssets(resolve(o.project))));
  group.command("inspect-source").description("Measure agent-selected source components at three real viewports to inform the plan; not acceptance").requiredOption("--project <file>").requiredOption("--selectors <relative-file>").action(async o=>report(await inspectSourceComponents(resolve(o.project),o.selectors)));
  group.command("prepare-composer").description("Prepare sanitized, asset-mapped HTML inputs from explicitly selected hashed source observations; no build or handoff").requiredOption("--project <file>").requiredOption("--recipe <relative-file>").action(async o=>report(await prepareComposerInputs(resolve(o.project),o.recipe)));
  group.command("discover").requiredOption("--project <file>").option("--max-routes <count>","Bounded read-only crawl","200").option("--resume","Resume hash-checked current reconnaissance; still requires independent navigation review").action(async o=>{const max=Number(o.maxRoutes);if(!Number.isInteger(max)||max<1||max>1000)throw Error("max-routes must be 1..1000");report(await discover(resolve(o.project),max,!!o.resume))});
  group.command("gate").requiredOption("--project <file>").requiredOption("--stage <stage>","plan | source | preflight | online").action(async o=>{if(!["plan","source","preflight","online"].includes(o.stage))throw Error("Invalid stage");report(await recordGate(resolve(o.project),o.stage))});
  group.command("capture").requiredOption("--project <file>").option("--stage <stage>","source | preflight | online","source").option("--source-baseline","Replay the current full verified source baseline; target stages only").action(async o=>{if(!["source","preflight","online"].includes(o.stage))throw Error("Invalid stage");report(await collect(resolve(o.project),o.stage,o.sourceBaseline?{sourceBaseline:true}:{}))});
  group.command('source-scope').description('Capture only an independently reviewed, hash-bound source subgraph; never whole-site acceptance').requiredOption('--project <file>').requiredOption('--scope <relative-file>').action(async o=>{const result=await collectSourceScope(resolve(o.project),o.scope);report(result);if(!result.scopeComplete)process.exitCode=2;});
  group.command('source-plan-validate').description('Read-only validation of an explicit source-only plan and full inventory; never build/target acceptance').requiredOption('--project <file>').action(async o=>{const ctx=await loadScopedPlan(resolve(o.project));if(!isSourceOnlyPlan(ctx.plan))throw Error('Explicit source-only-plan schema required');const findings=validateSourcePlan(ctx.plan);if(!findings.length)await verifySourceInventory(ctx,Object.keys(ctx.plan.routes));report({kind:'source-only-plan-validation',passed:!findings.length,findings,planMode:'source-only-v1',planSha256:ctx.planSha256,globalAccepted:false,formalBuildAllowed:false,published:false});});
  group.command("contracts").requiredOption("--project <file>").action(async o=>report({file:await exportContracts(resolve(o.project))}));
  group.command('source-scope-verify').description('Offline, read-only revalidation of current reviewed source scope; not global acceptance').requiredOption('--project <file>').requiredOption('--scope <relative-file>').requiredOption('--evidence-root <relative-directory>').requiredOption('--index <relative-file>').action(async o=>report(await verifyScopedSource(resolve(o.project),{scope:o.scope,evidenceRoot:o.evidenceRoot,index:o.index})));
  group.command('contracts-scope').description('Export independently verified source-only observations to a fresh scope-only directory; no build/publish permission').requiredOption('--project <file>').requiredOption('--scope <relative-file>').requiredOption('--evidence-root <relative-directory>').requiredOption('--index <relative-file>').requiredOption('--output <relative-directory>').action(async o=>report(await exportScopedContracts(resolve(o.project),{scope:o.scope,evidenceRoot:o.evidenceRoot,index:o.index,output:o.output})));
  group.command("review-prepare").requiredOption("--project <file>").option("--stage <stage>","preflight | online","preflight").action(async o=>{if(!["preflight","online"].includes(o.stage))throw Error("Invalid stage");report({file:await prepareReview(resolve(o.project),o.stage)})});
  group.command("review-submit").requiredOption("--project <file>").requiredOption("--input <file>").option("--stage <stage>","preflight | online","preflight").action(async o=>{if(!["preflight","online"].includes(o.stage))throw Error("Invalid stage");report(await submitReview(resolve(o.project),o.stage,resolve(o.input)))});
  group.command("repair-status").requiredOption("--project <file>").action(async o=>{const ctx=await loadPlan(resolve(o.project));report(await jsonFile(join(ctx.evidenceRoot,"repair-ledger.json")))});
  group.command("retest").requiredOption("--project <file>").action(async o=>{const file=resolve(o.project);await buildPlatform("shopyy",{projectFile:file});report(await collect(file,"preflight"))});
  group.command("draft-package").requiredOption("--project <file>").requiredOption("--output <directory>").action(async o=>report(await packageForDraft(resolve(o.project),o.output)));
}
