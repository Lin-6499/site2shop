import { join } from "node:path";
import { readJson, json } from "./util.js";

export const stateProductTranslations = {
  share: "Share", tweet: "Tweet", email: "Email",
  share_label: "Share on social media", facebook_label: "Share on Facebook",
  twitter_label: "Share on Twitter", email_label: "Send via email",
  payment_label: "Accepted payment methods", payment_checkout: "Payment options are shown at checkout.",
  delivery: "Shipping times and costs",
  delivery_checkout: "Shipping options are shown at checkout.",
};

const support = String.raw`<div class="s2s-state-payments" data-s2s-state-payments>
{% if shop.enabled_payment_types != empty %}<ul class="list-unstyled d-inline-flex flex-wrap mb-0" aria-label="{{ 's2s.state_product.payment_label' | t }}">{% for type in shop.enabled_payment_types %}<li class="pe-1 pb-1">{{ type | payment_type_svg_tag: class: 'icon' }}</li>{% endfor %}</ul>{% else %}<small>{{ 's2s.state_product.payment_checkout' | t }}</small>{% endif %}
</div><div class="s2s-state-delivery" data-s2s-state-delivery>{% if section.settings.delivery_message != blank %}{{ section.settings.delivery_message }}{% elsif shop.shipping_policy != blank %}<a href="{{ shop.shipping_policy.url }}">{{ 's2s.state_product.delivery' | t }}</a>{% else %}{{ 's2s.state_product.delivery_checkout' | t }}{% endif %}</div>`;

const social = String.raw`{% assign s2s_share_url = shop.url | append: product.url | url_encode %}{% assign s2s_share_title = product.title | url_encode %}
<div class="product-social-sharing"><ul class="social-sharing list-unstyled d-flex flex-wrap my-5" aria-label="{{ 's2s.state_product.share_label' | t }}">
<li class="p-2"><a class="btn btn-light btn-sm d-flex align-items-center" target="_blank" rel="noopener noreferrer" href="https://www.facebook.com/sharer/sharer.php?u={{ s2s_share_url }}" aria-label="{{ 's2s.state_product.facebook_label' | t }}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M24 12.07C24 5.41 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.32l-.53 3.5h-2.8V24C19.62 23.1 24 18.1 24 12.07Z"/></svg><span class="ms-3">{{ 's2s.state_product.share' | t }}</span></a></li>
<li class="p-2"><a class="btn btn-light btn-sm d-flex align-items-center" target="_blank" rel="noopener noreferrer" href="https://twitter.com/intent/tweet?text={{ s2s_share_title }}&amp;url={{ s2s_share_url }}" aria-label="{{ 's2s.state_product.twitter_label' | t }}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M24 4.37a9.6 9.6 0 0 1-2.83.8 5.04 5.04 0 0 0 2.17-2.8c-.95.58-2 1-3.13 1.22A4.86 4.86 0 0 0 16.61 2a4.99 4.99 0 0 0-4.79 6.2A13.87 13.87 0 0 1 1.67 2.92 5.12 5.12 0 0 0 3.2 9.67a4.82 4.82 0 0 1-2.23-.64v.07c0 2.44 1.7 4.48 3.95 4.95a4.84 4.84 0 0 1-2.22.08c.63 2.01 2.45 3.47 4.6 3.51A9.72 9.72 0 0 1 0 19.74 13.68 13.68 0 0 0 7.55 22c9.06 0 14-7.7 14-14.37v-.65c.96-.71 1.79-1.6 2.45-2.61Z"/></svg><span class="ms-3">{{ 's2s.state_product.tweet' | t }}</span></a></li>
<li class="p-2"><a class="btn btn-light btn-sm d-flex align-items-center" href="mailto:?subject={{ s2s_share_title }}&amp;body={{ s2s_share_url }}" aria-label="{{ 's2s.state_product.email_label' | t }}"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V4Zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1H2Zm13 2.383-4.758 2.855L15 11.114v-5.73ZM1 11.114l4.758-2.876L1 5.383v5.73ZM2 13h12l-5-3-1 .583L7 10l-5 3Z"/></svg><span class="ms-3">{{ 's2s.state_product.email' | t }}</span></a></li>
</ul></div>`;

export const stateProductStyles = String.raw`
.shopify-section:has(> [data-s2s-state-product]){padding-top:40px}
[data-s2s-state-product] .s2s-harold-details h1{font-size:min(3rem,calc(1.425rem + 2.1vw));font-weight:500;line-height:1.2;margin-bottom:4px}
[data-s2s-state-product] .s2s-harold-price{font-size:min(1.5rem,calc(1.275rem + .3vw));font-weight:400;line-height:1.5;margin-bottom:24px;color:#0d1c1c}
[data-s2s-state-product] .s2s-harold-price strong{font-weight:400;display:inline}
[data-s2s-state-product] .s2s-harold-rating{min-height:0;margin:0 0 16px}
[data-s2s-state-product] .s2s-harold-option{margin-bottom:16px}
[data-s2s-state-product] .s2s-harold-option>label,[data-s2s-state-product] .s2s-harold-option legend{font-size:16px;font-weight:500;line-height:1.2;margin:0 0 8px}
[data-s2s-state-product] .s2s-harold-option select{min-height:0;height:38px;margin:0 0 16px;padding:6px 36px 6px 12px;border:1px solid #ececec;border-radius:0;font-size:16px;line-height:24px}
[data-s2s-state-product] .s2s-harold-image-values--columns-2{grid-template-columns:repeat(2,calc((100% - 24px)/4))!important;gap:8px}
[data-s2s-state-product] .s2s-harold-image-option legend{font-weight:500}
[data-s2s-state-product] .s2s-harold-swatch{border-radius:0;box-shadow:none}
[data-s2s-state-product] .s2s-harold-image-values label>span:last-child{font-size:14px;line-height:21px;opacity:.6}
[data-s2s-state-product] .s2s-harold-purchase .s2s-harold-next{min-width:0;margin-left:0;font-weight:700;letter-spacing:1.5px;text-transform:uppercase}
[data-s2s-state-product] .s2s-state-payments{text-align:center;margin-top:8px;font-size:12px;line-height:18px}
[data-s2s-state-product] .s2s-state-payments svg{width:38px;height:24px}
[data-s2s-state-product] .s2s-state-delivery{text-align:center;min-height:24px;margin-top:8px;padding:0 8px;font-size:16px;line-height:24px}
[data-s2s-state-product] .s2s-state-delivery p{margin:0}
[data-s2s-state-product] .product-social-sharing a{font-size:14px;font-weight:700;line-height:21px;padding:4px 8px;min-height:31px;border-radius:800px;white-space:nowrap}
[data-s2s-state-product] .product-social-sharing svg{flex:none}
[data-s2s-state-product][data-s2s-gallery-count="3"] .s2s-harold-thumb-nav>.s2s-family-arrow{display:none!important}
[data-s2s-state-product] .s2s-family-thumb:focus-visible{outline:3px solid #0dcaf0;outline-offset:-3px}
@media(max-width:575.98px){.shopify-section:has(> [data-s2s-state-product]){padding-top:12px}[data-s2s-state-product] .s2s-harold-thumb-nav>.s2s-family-arrow{display:none!important}}
`;

const stateGalleryScript = String.raw`<script>(()=>{const init=()=>document.querySelectorAll('[data-s2s-state-product]').forEach(root=>{if(root.dataset.s2sStateTrackReady)return;root.dataset.s2sStateTrackReady='true';const viewport=root.querySelector('[data-family-thumbs-viewport]'),track=root.querySelector('[data-family-thumbs-track]'),thumbs=[...root.querySelectorAll('[data-family-thumb]')];if(!viewport||!track||!thumbs.length)return;let frame;const sync=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const size=thumbs[0].getBoundingClientRect().width;if(!size)return;const count=Math.max(1,Math.round((viewport.clientWidth+12)/(size+12))),current=Math.max(0,thumbs.findIndex(n=>n.getAttribute('aria-current')==='true')),start=Math.min(current,Math.max(0,thumbs.length-count));track.style.transform='translate3d(-'+start*(size+12)+'px,0,0)';});};new MutationObserver(sync).observe(track,{subtree:true,attributes:true,attributeFilter:['aria-current']});new ResizeObserver(sync).observe(viewport);root.addEventListener('click',sync);root.addEventListener('keydown',sync);root.addEventListener('s2s:media:show',sync);sync();});if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();})();</script>`;

export function repairStateProductSection(contents: string, marker: string) {
  if (!["harold-hat", "harold-wine-glass"].includes(marker)) return contents;
  let result = contents.replace('data-s2s-family-product data-s2s-harold-family=', 'data-s2s-family-product data-s2s-state-product data-s2s-gallery-count="{{ product.images.size }}" data-s2s-harold-family=');
  result = result.replace("image_tag: loading: 'lazy', widths: '390,640,900,1200,1600'", "image_tag: loading: 'eager', widths: '390,640,900,1200,1600'");
  result = result.replace('<p class="s2s-form-status"', support + '<p class="s2s-form-status"');
  result = result.replace('{% endform %}', '{% endform %}' + social);
  result = result.replace('<h1>', '<h1 class="h1">');
  result = result.replace('</section><script', '</section><style>' + stateProductStyles + '</style><script');
  result = result.replace('{% schema %}', stateGalleryScript + '{% schema %}');
  result = result.replace(/\{% schema %\}([\s\S]*?)\{% endschema %\}/, (_, body) => {
    const schema = JSON.parse(body);
    schema.settings.push({type:"richtext",id:"delivery_message",label:"Delivery information",info:"Use delivery times verified for this store. Leave empty to link to its shipping policy."});
    return `{% schema %}${JSON.stringify(schema)}{% endschema %}`;
  });
  return result;
}

export async function writeStateProductLocales(out: string) {
  const file = join(out,"theme/locales/en.default.json");
  const locale = await readJson<any>(file);
  locale.s2s ||= {}; locale.s2s.state_product = stateProductTranslations;
  await json(file,locale);
}
