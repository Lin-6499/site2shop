export type ChoiceRoutePageContract = {
  kind: "choice-route";
  rootSelector: string;
  buttonSelector: string;
  selections: Array<{ name: string; defaultValue?: string }>;
  routes: Record<string, string>;
  gallerySync?: {
    selector: string;
    selectionName: string;
    slideByValue: Record<string, number>;
    stickyTopPx?: number;
    stickyMinWidthPx?: number;
  };
};

export type PageInteractionContracts = {
  schemaVersion: 1;
  pages: Record<string, ChoiceRoutePageContract>;
};

const HANDLE = /^[a-z0-9][a-z0-9-]*$/;
const SAFE_SELECTOR = /^[#.\[\]="'a-zA-Z0-9 _:-]+$/;

export function validatePageInteractionContracts(value: PageInteractionContracts) {
  if (!value || value.schemaVersion !== 1 || !value.pages || typeof value.pages !== "object")
    throw new Error("Invalid page-interaction-contracts.json");
  for (const [handle, contract] of Object.entries(value.pages)) {
    if (!HANDLE.test(handle)) throw new Error(`Invalid interaction page handle: ${handle}`);
    if (contract.kind !== "choice-route")
      throw new Error(`${handle}: unsupported page interaction kind`);
    if (!SAFE_SELECTOR.test(contract.rootSelector) || !SAFE_SELECTOR.test(contract.buttonSelector))
      throw new Error(`${handle}: unsafe or unsupported interaction selector`);
    if (!Array.isArray(contract.selections) || !contract.selections.length)
      throw new Error(`${handle}: interaction selections are missing`);
    for (const selection of contract.selections) {
      if (!selection || !/^[a-zA-Z0-9_-]+$/.test(selection.name))
        throw new Error(`${handle}: invalid interaction selection name`);
    }
    if (!contract.routes || !Object.keys(contract.routes).length)
      throw new Error(`${handle}: interaction route map is empty`);
    for (const destination of Object.values(contract.routes)) {
      if (!/^\/[a-zA-Z0-9/_-]+$/.test(destination) || destination.startsWith("//"))
        throw new Error(`${handle}: interaction destination must be a target-store relative path`);
    }
    if (contract.gallerySync) {
      if (!SAFE_SELECTOR.test(contract.gallerySync.selector))
        throw new Error(`${handle}: unsafe or unsupported gallery selector`);
      if (!contract.selections.some((selection) => selection.name === contract.gallerySync?.selectionName))
        throw new Error(`${handle}: gallery selection name is not declared`);
      if (!contract.gallerySync.slideByValue || !Object.keys(contract.gallerySync.slideByValue).length)
        throw new Error(`${handle}: gallery slide map is empty`);
      for (const index of Object.values(contract.gallerySync.slideByValue)) {
        if (!Number.isInteger(index) || index < 0)
          throw new Error(`${handle}: gallery slide indexes must be non-negative integers`);
      }
      if (contract.gallerySync.stickyTopPx !== undefined &&
          (!Number.isFinite(contract.gallerySync.stickyTopPx) || contract.gallerySync.stickyTopPx < 0))
        throw new Error(`${handle}: invalid gallery sticky offset`);
      if (contract.gallerySync.stickyMinWidthPx !== undefined &&
          (!Number.isFinite(contract.gallerySync.stickyMinWidthPx) || contract.gallerySync.stickyMinWidthPx < 0))
        throw new Error(`${handle}: invalid gallery sticky minimum width`);
    }
  }
  return value;
}

export function buildPageInteractionScript(contracts: PageInteractionContracts) {
  const safe = JSON.stringify(validatePageInteractionContracts(contracts)).replace(/</g, "\\u003c");
  return String.raw`(()=>{const plan=${safe};const mountPageReviews=()=>{const slot=document.querySelector('[data-s2s-page-review-slot]');const widget=document.querySelector('#looxReviews');const section=widget?.closest('.shopify-section');if(!slot){if(section?.id.endsWith('__page_loox_reviews'))section.remove();return}if(!section){slot.dataset.s2sPageReviewError='widget-missing';return}slot.replaceWith(section);section.style.display='block';section.dataset.s2sPageReviewMounted='true'};const init=()=>{mountPageReviews();document.querySelectorAll('[data-s2s-page-handle]').forEach(page=>{if(page.dataset.s2sPageInteractionsReady)return;const handle=page.dataset.s2sPageHandle,contract=plan.pages[handle];if(!contract)return;page.dataset.s2sPageInteractionsReady='true';const root=page.querySelector(contract.rootSelector);if(!root){page.dataset.s2sPageInteractionsError='root-missing';return}const selectionNames=new Set(contract.selections.map(selection=>selection.name));let galleryActivated=false;const syncSticky=()=>{const sync=contract.gallerySync;if(!sync||sync.stickyTopPx===undefined||!galleryActivated)return;const gallery=page.querySelector(sync.selector);if(!gallery)return;const min=sync.stickyMinWidthPx||0;if(window.innerWidth>=min){gallery.style.position='sticky';gallery.style.top=sync.stickyTopPx+'px'}else{gallery.style.removeProperty('position');gallery.style.removeProperty('top')}};const syncGallery=input=>{const sync=contract.gallerySync;if(!sync||input.name!==sync.selectionName)return;const gallery=page.querySelector(sync.selector),index=sync.slideByValue[String(input.value).trim()];if(!gallery||!Number.isInteger(index)){page.dataset.s2sPageInteractionsError='gallery-sync-missing';return}const slide=gallery.querySelectorAll('.thumbs-splide .splide__slide')[index];if(!slide){page.dataset.s2sPageInteractionsError='gallery-slide-missing';return}slide.click();galleryActivated=true;syncSticky();page.dataset.s2sPageInteractionSlide=String(index)};window.addEventListener('resize',syncSticky,{passive:true});root.addEventListener('change',event=>{const input=event.target;if(input instanceof HTMLInputElement&&input.type==='radio'&&selectionNames.has(input.name))syncGallery(input)});root.addEventListener('click',event=>{const label=event.target.closest?.('label[for]');if(!label||!root.contains(label))return;const id=label.getAttribute('for'),input=id?root.querySelector('#'+CSS.escape(id)):null;if(!input||input.type!=='radio'||!selectionNames.has(input.name))return;event.preventDefault();if(!input.checked){input.checked=true;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))}else syncGallery(input);input.focus({preventScroll:true})});const button=root.querySelector(contract.buttonSelector);if(!button){page.dataset.s2sPageInteractionsError='button-missing';return}button.addEventListener('click',event=>{event.preventDefault();const values=contract.selections.map(selection=>{const checked=root.querySelector('input[name="'+CSS.escape(selection.name)+'"]:checked');const select=root.querySelector('select[name="'+CSS.escape(selection.name)+'"]');return String(checked?.value||select?.value||selection.defaultValue||'').trim()});const key=values.join('|'),destination=contract.routes[key];page.dataset.s2sPageInteractionKey=key;if(!destination||!destination.startsWith('/')||destination.startsWith('//')){page.dataset.s2sPageInteractionsError='route-missing';return}page.dataset.s2sPageInteractionDestination=destination;window.location.assign(destination)})})};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init()})();`;
}
