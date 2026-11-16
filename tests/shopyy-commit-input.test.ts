import test from 'node:test';import assert from 'node:assert/strict';import {actionInputMatches} from '../src/shopyy/contracts.js';
test('Enter commits a preceding business fill only on the same side/control, with strict key and value',()=>{
 const fill={op:'fill',selector:'#quantity',value:'3'},enter={op:'press',selector:'#quantity',value:'Enter'},valid=[fill,enter];assert.equal(actionInputMatches(valid,fill,'3'),true);assert.equal(actionInputMatches(valid,enter,'3'),true);
 const wrongFill=[{...fill,value:'2'},enter];assert.equal(actionInputMatches(wrongFill,wrongFill[0],'3'),false);assert.equal(actionInputMatches(wrongFill,enter,'3'),false);
 const wrongKey=[fill,{...enter,value:'Space'}];assert.equal(actionInputMatches(wrongKey,wrongKey[1],'3'),false);
 const unrelated=[fill,{...enter,selector:'#other'}];assert.equal(actionInputMatches(unrelated,unrelated[1],'3'),false);assert.equal(actionInputMatches([enter,fill],enter,'3'),false);
 assert.equal(actionInputMatches([enter],enter,'Enter'),true);assert.equal(actionInputMatches([enter],enter,'3'),false);assert.equal(actionInputMatches([],enter,'3'),false);
});
