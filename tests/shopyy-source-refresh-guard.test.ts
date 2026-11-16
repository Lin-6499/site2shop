import test from 'node:test';
import assert from 'node:assert/strict';
import type {BrowserContext} from 'playwright';
import {guardContext} from '../src/shopyy/browser.js';

test('source capture admits only the existing SDK refresh policy and preserves the source write boundary',async()=>{
 const project={sourceUrl:'https://store.example.test/',workflow:{sourceSession:{enabled:true,refreshOrigins:['https://auth.example.test']}}};
 let handler:any;
 const context={route:async(_pattern:string,callback:any)=>{handler=callback;}} as unknown as BrowserContext;
 const blocked:any[]=[];
 await guardContext(context,'https://store.example.test','source',blocked,project);
 const run=async(overrides:any={})=>{
  let result='';
  const request={method:()=>overrides.method||'POST',url:()=>overrides.url||'https://auth.example.test/auth/v1/token?grant_type=refresh_token',isNavigationRequest:()=>!!overrides.navigation,resourceType:()=>overrides.resourceType||'fetch',frame:()=>({url:()=>overrides.frameUrl||'https://store.example.test/coa'}),postData:()=>''};
  await handler({request:()=>request,continue:async()=>{result='continue';},abort:async()=>{result='abort';}});
  return result;
 };
 assert.equal(await run(),'continue');
 assert.equal(await run({resourceType:'xhr'}),'continue');
 for(const overrides of [
  {url:'https://auth.example.test/auth/v1/token?grant_type=password'},
  {url:'https://auth.example.test/auth/v1/signup'},
  {url:'https://attacker.example.test/auth/v1/token?grant_type=refresh_token'},
  {url:'https://auth.example.test/auth/v1/token?grant_type=refresh_token&scope=admin'},
  {url:'https://store.example.test/cart/add'},
  {navigation:true},{resourceType:'document'},
  {frameUrl:'https://other.example.test/'},
  {method:'PUT'},
 ])assert.equal(await run(overrides),'abort',JSON.stringify(overrides));
 assert.equal(blocked.length,9);
});
