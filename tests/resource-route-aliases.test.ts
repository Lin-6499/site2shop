import{test}from'node:test';import assert from'node:assert/strict';import{rewriteCollectionRoutes}from'../src/resource-route-aliases.js';
test('collection isolation rewrites owned route destinations only and is idempotent',()=>{
 const aliases={'quote-signs':'harold-quote-signs'},source='https://haroldhome.co',target='https://azhiip-13.myshopify.com';
 const raw='<a href="/collections/quote-signs/products/a">A</a><a href="https://haroldhome.co/collections/quote-signs?sort_by=manual">B</a><a href="/collections/quote-signs-new">C</a><a href="/products/quote-signs">D</a>';
 const actual=rewriteCollectionRoutes(raw,aliases,source,target);assert(actual.includes('/collections/harold-quote-signs/products/a'));assert(actual.includes('/collections/harold-quote-signs?sort_by=manual'));assert(actual.includes('/collections/quote-signs-new'));assert(actual.includes('/products/quote-signs'));assert.equal(rewriteCollectionRoutes(actual,aliases,source,target),actual);
});
