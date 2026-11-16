import test from 'node:test';
import assert from 'node:assert/strict';
import {compareWorkflowState,inspectProductWorkflow,assessCapturedWorkflowPath} from '../src/product-workflow-evidence.js';
import {chromium} from 'playwright';

test('browser workflow capture includes labelled radios and ignores unrelated forms',async()=>{
  const browser=await chromium.launch({headless:true,channel:'chromium'});
  try {
    const page=await browser.newPage();
    await page.setContent('<form><input name="newsletter"></form><div id="product-content-area"><input hidden id="radio" type="radio" name="size" value="large"><label for="radio">Large</label><input type="hidden" name="id" value="123"><button>Next →</button></div>');
    const result=await inspectProductWorkflow(page);
    assert.equal(result.nextPresent,true);
    assert.equal(result.variantId,'123');
    assert.equal(result.fields.length,1);
    assert.equal(result.fields[0].value,'large');
  } finally {await browser.close();}
});

test('matching step names cannot hide one upload missing on a two-pet product',()=>{
  const state={fields:[{type:'file',name:'properties[Upload Pet Photo 1]',required:true},{type:'file',name:'properties[Upload Pet Photo 2]',required:true}],nextPresent:true,previousPresent:true,validationError:false};
  assert.equal(compareWorkflowState(state,state).passed,true);
  assert.equal(compareWorkflowState(state,{...state,fields:state.fields.slice(0,1)}).passed,false);
  assert.equal(compareWorkflowState(state,{...state,nextPresent:false,previousPresent:false}).passed,false);
  assert.equal(compareWorkflowState(undefined,state).passed,false);
});

test('workflow comparison uses customer-visible option structure and reports merchant-owned checkbox price differences separately',()=>{
  const source={fields:[
    {type:'radio',name:'source-option',label:'+$22\n12\"x16\"',value:'12\"x16\"',required:false},
    {type:'checkbox',name:'',label:'Artwork Preview\n$10',value:'111',required:false},
  ],nextPresent:true,previousPresent:false,validationError:false};
  const equivalent={fields:[
    {type:'radio',name:'s2s-option-2',label:'12\"x16\"',value:'12\"x16\"',required:false},
    {type:'checkbox',name:'',label:'Artwork Preview $10.00 Receive a proof by email.',value:'999',required:false},
  ],nextPresent:true,previousPresent:false,validationError:false};
  assert.equal(compareWorkflowState(source,equivalent).passed,true);
  const priceDifference=compareWorkflowState(source,{...equivalent,fields:[equivalent.fields[0],{...equivalent.fields[1],label:'Artwork Preview $20.00 Receive a proof by email.'}]});
  assert.equal(priceDifference.passed,true);
  assert.equal(priceDifference.businessDataDifferences?.length,1);
});

test('workflow comparison treats textarea property names as platform plumbing while preserving count and requiredness',()=>{
  const source={fields:[{type:'textarea',name:'properties[Notes for the designer (optional)]',required:false}],nextPresent:true,previousPresent:true,validationError:false};
  const target={fields:[{type:'textarea',name:'properties[Notes for the artist]',required:false}],nextPresent:true,previousPresent:true,validationError:false};
  assert.equal(compareWorkflowState(source,target).passed,true);
  assert.equal(compareWorkflowState(source,{...target,fields:[]}).passed,false);
});

test('an unvisited Next button or a validation rejection cannot pass path coverage',()=>{
  const initial={state:'initial',data:{workflow:{nextPresent:true,fields:[]}}};
  assert.equal(assessCapturedWorkflowPath([initial]).passed,false);
  assert.equal(assessCapturedWorkflowPath([initial,{...initial,state:'blocked-step-2'}]).passed,false);
  assert.equal(assessCapturedWorkflowPath([]).passed,false);
  assert.equal(assessCapturedWorkflowPath([{state:'initial',data:{}}]).passed,false);
  assert.equal(assessCapturedWorkflowPath([initial,{state:'step-2',data:{workflow:{nextPresent:false,fields:[]}}}]).passed,true);
});
