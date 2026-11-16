import { haroldOptionMediaContracts } from './harold-option-media-contract.js';

/** Only these source-observed families share the tuple-to-gallery primitive. */
export function repairHaroldOptionMedia(contents: string, marker: string): string {
  const handles: Record<string, string[]> = {
    'harold-house': ['custom-house-portrait'],
    'harold-watercolor': ['custom-watercolor-art-canvas'],
    'harold-print': Object.keys(haroldOptionMediaContracts).filter(h => h.endsWith('-print') || h.endsWith('-print-copy')),
    'harold-wine-glass': ['home-state-wine-glass'],
    'harold-homeowner': ['in-my-homeowner-era-1-print-copy'],
  };
  const consumers = handles[marker];
  if (!consumers) return contents;
  const contracts = Object.fromEntries(consumers.map(h => [h, haroldOptionMediaContracts[h].tuples]));
  const data = '<script type="application/json" data-s2s-verified-option-media data-product-handle="{{ product.handle | escape }}">' + JSON.stringify(contracts).replaceAll('<', '\\u003c') + '</script>';
  const script = String.raw`<script>(()=>{const init=()=>{document.querySelectorAll('[data-s2s-verified-option-media]').forEach(data=>{const root=data.closest('[data-s2s-harold-workflow]');if(!root||root.dataset.s2sVerifiedMediaReady)return;const map=JSON.parse(data.textContent)[data.dataset.productHandle];if(!map)return;root.dataset.s2sVerifiedMediaReady='true';const form=root.querySelector('form'),groups=[...form.querySelectorAll('[data-s2s-option-group]')].sort((a,b)=>Number(a.dataset.s2sOptionGroup)-Number(b.dataset.s2sOptionGroup)),slides=[...root.querySelectorAll('[data-family-slide]')];const filename=url=>decodeURIComponent(new URL(url,location.href).pathname.split('/').pop());const sync=()=>{const tuple=groups.map(g=>g.querySelector('input[type=radio]:checked:not([name="form-option-framing-swicher"])')?.value||g.querySelector('select')?.value||'').join('|');if(!Object.hasOwn(map,tuple)){root.dataset.s2sMediaError='Unmapped option tuple: '+tuple;return;}const expected=map[tuple];if(expected===null){delete root.dataset.s2sMediaError;return;}const index=slides.findIndex(n=>{const im=n.querySelector('img');return im&&filename(im.currentSrc||im.src)===expected});if(index<0){root.dataset.s2sMediaError='Missing target media: '+expected;return;}delete root.dataset.s2sMediaError;root.dispatchEvent(new CustomEvent('s2s:media:show',{detail:{index}}));};form.addEventListener('change',e=>{if(e.target.closest('[data-s2s-option-group]'))queueMicrotask(sync)});
// Source watercolor frame toggles reveal the alternatives without selecting them.
if(root.matches('[data-s2s-harold-watercolor]'))root.addEventListener('change',e=>{if(!e.target.matches('[data-s2s-frame-switch] input'))return;e.stopImmediatePropagation();const group=e.target.closest('[data-s2s-framing-group]'),off=e.target===group.querySelectorAll('[data-s2s-frame-switch] input')[1];group.querySelectorAll('[data-s2s-frame-values],[data-s2s-frame-heading]').forEach(n=>n.hidden=off);group.querySelectorAll('[data-s2s-unframed-values]').forEach(n=>n.hidden=!off)},true);
// Preserve the source's editorial initial image (not always the selected variant).
});};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init()})();</script>`;
  return contents.replace('</section>', data + '</section>').replace('{% schema %}', script + '{% schema %}');
}
