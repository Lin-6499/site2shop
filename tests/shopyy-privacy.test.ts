import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {projectSourcePrivacy,sourcePrivacyPolicy} from '../src/shopyy/source-privacy.js';
test('private-account projection removes all identity-bearing DOM while preserving the observed region geometry and policy',async()=>{
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.goto('about:blank');
 const project={workflow:{sourcePrivacyBoundaries:[{id:'account',sourcePath:'blank',selector:'#apply',kind:'private-account',reason:'Test account privacy'}]}};
 await page.setContent('<main><section id="apply" style="width:300px;height:180px"><p>Verified as <span>private-fixture@example.invalid</span></p><input value="private-fixture"/><a href="mailto:private-fixture@example.invalid">Private profile</a></section><footer>Public business contact</footer></main>');
 const before=await page.locator('#apply').boundingBox(),policy=sourcePrivacyPolicy(project,'blank'),result=await projectSourcePrivacy(page,project);
 assert.equal(result.sourcePrivacyPolicySha256,policy);assert.equal(result.privacyProjection.length,1);
 assert.ok(!(await page.content()).includes('private-fixture'));assert.ok((await page.content()).includes('Public business contact'));
 assert.deepEqual(await page.locator('#apply').boundingBox(),before);
 await projectSourcePrivacy(page,project);assert.deepEqual(await page.locator('#apply').boundingBox(),before);
 assert.notEqual(sourcePrivacyPolicy({workflow:{sourcePrivacyBoundaries:[]}},'blank'),policy);
 }finally{await browser.close();}
});
