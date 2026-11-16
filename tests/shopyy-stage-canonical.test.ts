import test from 'node:test';
import assert from 'node:assert/strict';
import {stateCanonicalRejection} from '../src/shopyy/contracts.js';
test('explicit stage canonical preserves real source absence and requires native canonical identity',()=>{
 const state={canonical:{source:null,target:null},targetCanonicalByStage:{preflight:null,online:{mode:'same-origin-path' as const,queryKeys:['q','page']}}};
 assert.equal(stateCanonicalRejection(state,'source',null,'https://source.test/es/search?q=RT10','source'),null);
 assert.equal(stateCanonicalRejection(state,'target',null,'http://localhost/es/search?q=RT10','preflight'),null);
 assert.equal(stateCanonicalRejection(state,'target','https://store.test/search?q=RT10','https://store.test/search?lp_lang=es&q=RT10','online'),null);
 for(const canonical of [null,'https://other.test/search?q=RT10','https://store.test/other?q=RT10','https://store.test/search?q=WRONG','https://store.test/search?q=RT10&lp_lang=es'])assert.ok(stateCanonicalRejection(state,'target',canonical,'https://store.test/search?lp_lang=es&q=RT10','online'));
 assert.ok(stateCanonicalRejection(state,'source','https://source.test/es/search?q=RT10','https://source.test/es/search?q=RT10','source'));
 assert.ok(stateCanonicalRejection(state,'target','http://localhost/es/search?q=RT10','http://localhost/es/search?q=RT10','preflight'));
 const product={...state,targetCanonicalByStage:{online:{mode:'same-origin-path' as const,queryKeys:[]}}};
 assert.equal(stateCanonicalRejection(product,'target','https://store.test/products/rt10','https://store.test/products/rt10?lp_lang=pt','online'),null);
 // No opt-in retains the original explicit null contract.
 assert.ok(stateCanonicalRejection({canonical:{target:null}},'target','https://store.test/products/rt10','https://store.test/products/rt10','online'));
});
