import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { familyProductScript, familyProductSections } from '../src/family-product-theme.js';
import { optionMediaScript, validateOptionMediaContracts, mediaIdentity, type OptionMediaContract } from '../src/option-media-theme.js';

function fixture():OptionMediaContract {
 const groups=[{name:'size',values:[{value:'S',kind:'text' as const,asset:null,color:null},{value:'M',kind:'text' as const,asset:null,color:null}]},{name:'style',values:[{value:'Line',kind:'image' as const,asset:'https://source.test/line.jpg',color:null}]}];
 return {schemaVersion:1,planSha256:'test-plan',products:{sample:{source:'https://source.test/products/sample',options:['Size','Style'],groups,images:['https://source.test/shirt.jpg'],variantMedia:{'S\u001fLine':0,'M\u001fLine':0},observations:[1440,768,390].flatMap(width=>['S','M','S'].map(size=>({viewport:{width},selected:[size,'Line'],main:'https://source.test/shirt.jpg'})))}}};
}
test('source contract rejects missing consumer, group, viewport, asset and incorrect semantic media',()=>{
 validateOptionMediaContracts(fixture(),['sample']);
 for(const mutate of [
  (c:OptionMediaContract)=>{delete c.products.sample},
  (c:OptionMediaContract)=>{c.products.sample.groups.pop()},
  (c:OptionMediaContract)=>{c.products.sample.observations=c.products.sample.observations.filter(o=>o.viewport.width!==390)},
  (c:OptionMediaContract)=>{c.products.sample.groups[1].values[0].asset=null},
  (c:OptionMediaContract)=>{c.products.sample.observations[1].main='https://source.test/wrong-but-valid.jpg'},
 ]){const c=fixture();mutate(c);assert.throws(()=>validateOptionMediaContracts(c,['sample']))}
});
test('source option images are not taken from product gallery ordinal positions',()=>{
 const section=familyProductSections['s2s-embroidered-product'];
 assert.doesNotMatch(section,/product\.images\[forloop\.index0\]/);
 assert.match(section,/s2s-option-visual/);
 assert.match(section,/aria-label="\{\{ value \| escape \}\}"/);
 assert.equal(mediaIdentity('//source.test/cdn/shop/files/blue_160x160_crop_center.png?v=1'),'blue.png');
});

test('real browser keeps size media stable and synchronizes color/style, variant, price and deep links',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const options=[['S','M'],['Black','White'],['Full','Line']];
  const variants=options[0].flatMap((size,i)=>options[1].flatMap((color,j)=>options[2].map((style,k)=>({id:100+i*4+j*2+k,options:[size,color,style],price:5000+k*1000,available:true}))));
  const media=Object.fromEntries(variants.map(v=>[v.options.join('\u001f'),v.options[1].toLowerCase()+'-'+v.options[2].toLowerCase()+'.png']));
  const gallery=['black-full.png','white-full.png','black-line.png','white-line.png'];
  const html=`<section data-s2s-family-product data-s2s-option-contract-required><span data-s2s-price></span><form class="s2s-family-form"><input name="id" data-s2s-variant-id>${options.map((values,i)=>`<fieldset data-s2s-option-group="${i}"><span data-option-label></span>${values.map((value,j)=>`<input id="g${i}v${j}" type="radio" name="g${i}" value="${value}" data-s2s-option="${i}" ${j===0?'checked':''}><label for="g${i}v${j}">${value}</label>`).join('')}</fieldset>`).join('')}<button data-s2s-submit type="submit">Add</button><p data-s2s-status></p><script type="application/json" data-s2s-variants>${JSON.stringify(variants)}</script><script type="application/json" data-s2s-option-contract>${JSON.stringify({media})}</script></form>${gallery.map((src,i)=>`<figure data-family-slide="${i}" ${i?'hidden':''}><img src="/${src}"></figure>`).join('')}</section>`;
  await page.route('https://target.test/**',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.goto('https://target.test/product');
  await page.addScriptTag({content:`document.querySelector('section').addEventListener('s2s:media:show',e=>document.querySelectorAll('figure').forEach((f,i)=>f.hidden=i!==e.detail.index));`});
  await page.addScriptTag({content:familyProductScript});await page.addScriptTag({content:optionMediaScript});
  await page.locator('label[for=g0v1]').click();
  assert.equal(await page.locator('figure:not([hidden]) img').getAttribute('src'),'/black-full.png');
  await page.locator('label[for=g1v1]').click();
  assert.equal(await page.locator('figure:not([hidden]) img').getAttribute('src'),'/white-full.png');
  await page.locator('label[for=g2v1]').click();
  assert.equal(await page.locator('figure:not([hidden]) img').getAttribute('src'),'/white-line.png');
  assert.equal(await page.locator('[data-s2s-variant-id]').inputValue(),'107');
  assert.equal(await page.locator('[data-s2s-price]').innerText(),'$60.00');
  assert.equal(new URL(page.url()).searchParams.get('variant'),'107');
  await page.reload();
  await page.addScriptTag({content:`document.querySelector('section').addEventListener('s2s:media:show',e=>document.querySelectorAll('figure').forEach((f,i)=>f.hidden=i!==e.detail.index));`});
  await page.addScriptTag({content:familyProductScript});await page.addScriptTag({content:optionMediaScript});
  assert.equal(await page.locator('[data-s2s-variant-id]').inputValue(),'107');
  assert.equal(await page.locator('figure:not([hidden]) img').getAttribute('src'),'/white-line.png');
  assert.deepEqual(await page.locator('input[data-s2s-option]:checked').evaluateAll(inputs=>inputs.map(i=>(i as HTMLInputElement).value)),['M','White','Line']);
  await page.locator('label[for=g2v0]').click();
  assert.equal(await page.locator('figure:not([hidden]) img').getAttribute('src'),'/white-full.png');
  // Missing media is an explicit failure, not a silent ordinal substitute.
  await page.locator('figure').last().evaluate(e=>e.remove());
  await page.locator('label[for=g2v1]').click();
  assert.match(await page.locator('section').getAttribute('data-option-media-error')||'',/missing-media/);
 }finally{await browser.close()}
});
