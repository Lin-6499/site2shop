import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeJson,saveArtifact} from '../src/shopyy/artifacts.js';
import {prepareComposerInputs} from '../src/shopyy/composer-inputs.js';
import {sourceSessionPolicy} from '../src/shopyy/source-session.js';

test('public query inputs require exact hashed field/route evidence; unrelated private values stay removed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'shopyy-public-input-')),origin='https://fixture.invalid/';
 try{
  await mkdir(join(root,'assets/source-current'),{recursive:true});
  await writeJson(join(root,'assets/source-current/manifest.json'),{schemaVersion:2,sourceUrl:origin,assets:[],failures:[]});
  const project=join(root,'project.json');await writeJson(project,{sourceUrl:origin,assetsDirectory:'assets'});
  const raw=await saveArtifact(root,{kind:'reconnaissance-not-acceptance',requestedPath:'/shop?q=GHK',url:origin+'shop?q=GHK',images:[],structure:'<section><h1>Products</h1><input placeholder="Search" value="GHK"><input type="email" value="private@example.invalid"></section>'});
  const observed={kind:'planning-observation-not-acceptance',sourceUrl:origin,finalUrl:origin+'shop?q=GHK',selectors:{query:'input[placeholder="Search"]'},components:{query:{value:'GHK'}}};
  const evidence=await saveArtifact(root,observed);
  const recipe:any={schemaVersion:2,sourcePath:'/shop?q=GHK',fragments:[{id:'body',selector:'section',observation:raw}],publicQueryInputs:[{selector:'input[placeholder="Search"]',parameter:'q',component:'query',observation:evidence}]};
  await writeJson(join(root,'recipe.json'),recipe);await prepareComposerInputs(project,'recipe.json');
  const html=await readFile(join(root,'staging/composers/body.htm'),'utf8');assert.match(html,/value="GHK"/);assert.ok(!html.includes('private@example.invalid'));
  recipe.publicQueryInputs[0].observation=await saveArtifact(root,{...observed,components:{query:{value:'OTHER'}}});
  await writeJson(join(root,'recipe.json'),recipe);await assert.rejects(prepareComposerInputs(project,'recipe.json'),/not backed/);
  recipe.publicQueryInputs[0].observation=evidence;recipe.publicQueryInputs[0].parameter='session_token';
  await writeJson(join(root,'recipe.json'),recipe);await assert.rejects(prepareComposerInputs(project,'recipe.json'),/Sensitive/);
  recipe.publicQueryInputs[0]={selector:'input[type="email"]',parameter:'q',component:'query',observation:await saveArtifact(root,{...observed,selectors:{query:'input[type="email"]'}})};
  await writeJson(join(root,'recipe.json'),recipe);await assert.rejects(prepareComposerInputs(project,'recipe.json'),/ordinary search/);
  delete recipe.publicQueryInputs;await writeJson(join(root,'recipe.json'),recipe);await prepareComposerInputs(project,'recipe.json');
  assert.ok(!(await readFile(join(root,'staging/composers/body.htm'),'utf8')).includes('value='));
  const authenticated={sourceUrl:origin,assetsDirectory:'assets',workflow:{sourceSession:{enabled:true,sessionStorageKey:'sb-fixture-auth-token'}}};
  await writeJson(project,authenticated);
  recipe.publicQueryInputs=[{selector:'input[placeholder="Search"]',parameter:'q',component:'query',observation:evidence}];
  await writeJson(join(root,'recipe.json'),recipe);await assert.rejects(prepareComposerInputs(project,'recipe.json'),/freshness policy/);
  recipe.publicQueryInputs[0].observation=await saveArtifact(root,{...observed,captureEnvironment:{sourceSessionCurrent:true,sourceSessionPolicySha256:sourceSessionPolicy(authenticated)}});
  await writeJson(join(root,'recipe.json'),recipe);await prepareComposerInputs(project,'recipe.json');
 }finally{await rm(root,{recursive:true,force:true});}
});
