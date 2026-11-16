import { load } from "cheerio";

type PageRecord = { handle: string; input?: { body?: string } };
type ProductRecord = { kind?: string; handle: string; sourceSnapshot?: { id?: string | number } };
type ProductPlan = { handle: string; input?: { handle?: string } };

export function buildPageReviewAdapter(pages: PageRecord[], products: ProductRecord[], plan: ProductPlan[]) {
  const targets = new Map(plan.map(product => [product.handle, product.input?.handle || product.handle]));
  const sourceProducts = new Map(products.filter(product => product.kind === "product")
    .map(product => [String(product.sourceSnapshot?.id || ""), targets.get(product.handle)]));
  const mappings = new Map<string, string>();
  const coverage: Array<{ handle: string; summaries: number; targetHandles: string[] }> = [];
  for (const page of pages) {
    const body = page.input?.body || "";
    if (body.split('<a').length > 2500) throw new Error(`Page content adapter exceeds safe anchor budget: ${page.handle}`);
    const $ = load(body, null, false);
    const nodes = $(".loox-rating");
    const handles = new Set<string>();
    nodes.each((_, node) => {
      const sourceId = $(node).attr("data-id") || "";
      const handle = sourceProducts.get(sourceId);
      if (node.tagName !== "a" || !handle || !/^[a-z0-9-]+$/.test(handle))
        throw new Error(`Page review binding blocked: ${page.handle}, unsupported or unmapped summary ${sourceId}`);
      mappings.set(sourceId, handle);
      handles.add(handle);
    });
    if (handles.size > 20) throw new Error(`Page review binding exceeds all_products limit: ${page.handle}`);
    if (nodes.length) coverage.push({ handle: page.handle, summaries: nodes.length, targetHandles: [...handles] });
  }
  const mapping = `{% doc %}
@param {string} source_id - Imported review reference, resolved only to a target product handle.
{% enddoc %}
{%- case source_id -%}
${[...mappings].map(([id, handle]) => `{%- when '${id}' -%}${handle}`).join("\n")}
{%- endcase -%}`;
  return { mapping, content: pageReviewContentSnippet, coverage };
}

export const pageReviewContentSnippet = String.raw`{% doc %}
@param {page} page - Page whose stored body is retained except for imported review summaries.
{% enddoc %}
{%- assign s2s_parts = page.content | split: '<a' -%}
{%- assign s2s_last_batch = s2s_parts.size | minus: 1 | divided_by: 50 -%}
{%- for s2s_batch in (0..s2s_last_batch) -%}
{%- assign s2s_offset = s2s_batch | times: 50 -%}
{%- for s2s_part in s2s_parts limit: 50 offset: s2s_offset -%}
  {%- if forloop.first and s2s_batch == 0 -%}{{ s2s_part }}
  {%- else -%}
    {%- assign s2s_open = s2s_part | split: '>' | first | replace: "'", '"' -%}
    {%- assign s2s_classes = s2s_open | split: 'class="' | last | split: '"' | first | split: ' ' -%}
    {%- if s2s_classes contains 'loox-rating' -%}
      {%- assign s2s_source_id = s2s_open | split: 'data-id="' | last | split: '"' | first -%}
      {%- capture s2s_handle -%}{%- render 's2s-page-rating-product', source_id: s2s_source_id -%}{%- endcapture -%}
      {%- assign s2s_handle = s2s_handle | strip -%}
      {%- if s2s_handle != blank -%}
        {%- assign s2s_review_product = all_products[s2s_handle] -%}
        {%- capture s2s_rating_html -%}{%- render 's2s-product-rating', product: s2s_review_product, card: true, link_to_reviews: true -%}{%- endcapture -%}
        {%- assign s2s_rating_html = s2s_rating_html | strip -%}
        {%- if s2s_rating_html != blank -%}<span class="s2s-page-rating mb-2" data-s2s-page-rating data-product-handle="{{ s2s_handle | escape }}">{{ s2s_rating_html }}</span>{%- endif -%}
      {%- else -%}<span hidden data-s2s-review-unresolved></span>{%- endif -%}
      {%- assign s2s_tail = s2s_part | split: '</a>' -%}
      {%- for s2s_after in s2s_tail offset: 1 -%}{{ s2s_after }}{%- unless forloop.last -%}{{ '</a>' }}{%- endunless -%}{%- endfor -%}
    {%- else -%}{{ '<a' }}{{ s2s_part }}{%- endif -%}
  {%- endif -%}
{%- endfor -%}
{%- endfor -%}`;
