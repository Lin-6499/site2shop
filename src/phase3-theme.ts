import { basename, join } from "node:path";
import { access, readFile } from "node:fs/promises";
import { json, readJson, write, hash } from "./util.js";
import { buildPageReviewAdapter } from "./page-review-theme.js";
import { haroldCollectionSnippet, haroldCollectionCardSnippet } from './harold-collection-theme.js';
import { haroldSharePaymentsSnippet } from './harold-share-payments-theme.js';
import { haroldUploadDependencies, haroldUploadScript } from './harold-upload-theme.js';
import { buildPageInteractionScript, validatePageInteractionContracts, type PageInteractionContracts } from "./page-interaction-theme.js";
import { buildPortraitSection, buildPortraitVariantMediaSnippet, portraitFrameStyleSnippet, portraitStyles, type PortraitWorkflowContracts } from "./portrait-theme.js";
import { portraitProductScript, productGalleryScript, productGalleryStyles } from "./product-gallery-theme.js";
import { collectionProductCardSnippet, collectionSection, collectionStyles } from "./collection-theme.js";
import {
  customProductSection,
  familyProductScript,
  familyProductSections,
  familyProductSnippets,
  familyProductStyles,
  familyVariantSyncScript,
  standardProductSection,
} from "./family-product-theme.js";
import { looxRatingSnippet, looxReviewsSection, looxStarRatingBlockType } from "./loox-theme.js";
import { writeStateProductLocales } from "./harold-state-product-repair.js";
import { applyProductScrollOverrides, type ProductScrollOverrides } from "./product-scroll-theme.js";
import { buildOptionMediaArtifacts, optionMediaScript, optionMediaStyles, type OptionMediaContract } from "./option-media-theme.js";
import {
  haroldProductContractStyles,
  haroldProductEnhancementScript,
  haroldProductScript,
  haroldStepScrollScript,
  haroldSourceSwitchValueScript,
  haroldProductSections,
  haroldProductStyles,
  haroldProductTemplates,
} from "./harold-product-theme.js";

const schema = (name: string) =>
  `{% schema %}${JSON.stringify({ name, settings: [], presets: [{ name }] })}{% endschema %}`;

const productRecommendationsSection = String.raw`<section class="container s2s-product-recommendations" data-s2s-product-recommendations>
  <h2>{{ section.settings.heading | default: 'You may also like' | escape }}</h2>
  {% assign s2s_recommendation_products = product.collections.first.products %}
  <div class="s2s-product-recommendations__viewport"><ul class="s2s-product-recommendations__track">
    {% for card_product in s2s_recommendation_products limit: 11 %}{% unless card_product.id == product.id %}
      <li class="product-list-item s2s-product-recommendation-card" data-product-card>
        <a href="{{ card_product.url }}">{% if card_product.featured_image %}{{ card_product.featured_image | image_url: width: 720 | image_tag: loading: 'lazy', widths: '240,360,540,720', sizes: '(min-width: 1200px) 408px, 80vw', alt: card_product.title }}{% endif %}</a>
        <div class="s2s-product-recommendation-card__body"><a href="{{ card_product.url }}">{{ card_product.title | escape }}</a>
          {% render 's2s-product-rating', product: card_product, card: true, link_to_reviews: true %}
        </div>
      </li>
    {% endunless %}{% endfor %}
  </ul></div>
</section>
{% schema %}{"name":"Product recommendations","settings":[{"type":"text","id":"heading","label":"Heading","default":"You may also like"}],"presets":[{"name":"Product recommendations"}]}{% endschema %}`;

const productRecommendationsStyles = String.raw`.s2s-product-recommendations{padding-block:2rem 4rem}.s2s-product-recommendations h2{text-align:center}.s2s-product-recommendations__viewport{width:100%;overflow:hidden}.s2s-product-recommendations__track{display:flex;gap:0;width:max-content;margin:0;padding:0;list-style:none}.s2s-product-recommendation-card{box-sizing:border-box;flex:0 0 432px;width:432px;padding:12px;overflow:hidden}.s2s-product-recommendation-card>a{display:block}.s2s-product-recommendation-card img{display:block;width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:.5rem}.s2s-product-recommendation-card__body{display:grid;gap:.45rem;padding-top:.8rem}.s2s-product-recommendation-card__body>a{color:inherit;text-decoration:none}.s2s-product-recommendation-card .loox-rating{display:block;width:120px;height:19px;min-width:120px;min-height:19px}@media(min-width:801px) and (max-width:1200px){.s2s-product-recommendation-card{flex-basis:522px;width:522px}}@media(max-width:800px){.s2s-product-recommendation-card{flex-basis:calc(100vw + 72px);width:calc(100vw + 72px)}}`;

// Harold Home's product shell is a Bootstrap-style container/row/7+5-column
// composition. Keep this structural contract after the shared component CSS so
// a rebuild cannot silently replace it with the earlier generic two-column grid.
export const haroldSourceLayoutStyles = String.raw`
.shopify-section:has(> .s2s-harold-product){padding-top:4.5rem;padding-bottom:40px}
.s2s-harold-product{display:block;margin-top:0;padding-top:0;padding-bottom:0}
.s2s-harold-layout{display:flex;flex-wrap:wrap;margin-right:-.75rem;margin-left:-.75rem}
.s2s-harold-gallery-col{display:block;flex:0 0 auto;width:58.33333333%;padding-right:.75rem;padding-left:.75rem}
.s2s-harold-info-col{display:block;flex:0 0 auto;width:41.66666667%;padding-right:.75rem;padding-left:.75rem}
.s2s-harold-gallery-col,.s2s-harold-info-col,.s2s-harold-gallery,.s2s-harold-details{min-width:0}
.s2s-harold-details{position:static;top:auto;align-self:flex-start;padding:12px 20px 0;scroll-margin-top:7.25rem}
@media(max-width:991.98px){
  .s2s-harold-product{width:720px;max-width:100%;margin-top:0;padding:0 .75rem}
  .s2s-harold-gallery-col,.s2s-harold-info-col{width:100%}
  .s2s-harold-details{position:static;top:auto;padding:2rem 0 0}
}
@media(max-width:575.98px){.shopify-section:has(> .s2s-harold-product){padding-top:2.75rem}.s2s-harold-product{width:100%}}
@media(max-width:575.98px){[data-s2s-harold-workflow] .s2s-harold-thumb-nav>.s2s-family-arrow{display:none}}
.shopify-section:has(#looxReviews){padding:0;min-height:24px}
[data-s2s-harold-house] .s2s-harold-upload h4{font-family:Petrona,serif;font-size:20px;line-height:24px;margin:0 0 16px}
[data-s2s-harold-house] .s2s-harold-upload-guidance{display:flex;margin:0;text-align:start;font-style:normal;line-height:24px;color:inherit}
[data-s2s-harold-house] .s2s-harold-upload-guidance p{font-size:16px;line-height:24px;margin:0 0 16px;color:inherit}
[data-s2s-harold-house] .s2s-harold-personalization input[type=text]{min-height:0;height:38px;margin:0 0 8px;padding:6px 12px;border-color:#ececec;border-radius:800px}
[data-s2s-harold-house] .s2s-harold-upload .filepond--root{margin-bottom:12px}
`;

async function exists(path: string) {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function capturedDetailsComposition(theme: string, suffix: string) {
  const base = `s2s-details-${suffix.replace(/^s2s-/, "")}`;
  const before = `${base}-before`;
  const after = `${base}-after`;
  if (await exists(join(theme, `sections/${before}.liquid`))) {
    return {
      sections: {
        details_before: { type: before, settings: {} },
        loox_reviews: looxReviewsSection,
        details_after: { type: after, settings: {} },
      },
      order: ["details_before", "loox_reviews", "details_after"],
    };
  }
  return {
    sections: {
      details: {
        type: (await exists(join(theme, `sections/${base}.liquid`)))
          ? base
          : "s2s-product-details",
        settings: {},
      },
      loox_reviews: looxReviewsSection,
    },
    order: ["details", "loox_reviews"],
  };
}

const optionToken = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .replace(/poster[-_\s]*only/g, "poster")
    .replace(/[^a-z0-9]+/g, "");

export function inferPortraitVariantMedia(input: any) {
  const files = Array.isArray(input?.files) ? input.files : [];
  const variants = Array.isArray(input?.variants) ? input.variants : [];
  const fileNames = files.map((file: any) =>
    decodeURIComponent(String(file?.originalSource || "").split("?")[0].split("/").pop() || "").toLowerCase(),
  );
  const fileTokens = fileNames.map(optionToken);
  const exactSuffix = (file: string, token: string) => {
    if (token === "poster") return /(?:^|[-_])poster(?:[-_]?only)?(?:[._-]|$)/.test(file);
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[-_])${escaped}(?:[._-]|$)`).test(file);
  };
  const result: Record<string, number> = {};
  for (const variant of variants) {
    const options = Array.isArray(variant?.optionValues)
      ? variant.optionValues.map((item: any) => String(item?.name || ""))
      : [];
    if (!options.length) continue;
    const descriptive = options
      .map(optionToken)
      .filter((token: string) => token && !/^\d+(x\d+)?$/.test(token));
    if (!descriptive.length) continue;
    const last = descriptive.at(-1)!;
    let index = fileTokens.findIndex((file: string, candidate: number) =>
      exactSuffix(fileNames[candidate], last) && descriptive.slice(0, -1).every((token: string) => file.includes(token)),
    );
    if (index < 0) {
      index = fileNames.findIndex((file: string) => exactSuffix(file, last));
    }
    if (index >= 0) result[options.join("\u001f")] = index;
  }
  return result;
}

export async function writePhase3Theme(out: string) {
  await writeStateProductLocales(out);
  const theme = join(out, "theme");
  const editorialPlan = await readJson<any>(join(out, "phase4-editorial-plan.json")).catch(() => ({ blogs: [], articles: [] }));
  const sourceBlog = editorialPlan.blogs?.[0];
  const sourceBlogTitle = String(sourceBlog?.input?.title || "");
  const sourceBlogArticleCount = Array.isArray(editorialPlan.articles)
    ? editorialPlan.articles.filter((article: any) => article.blogHandle === sourceBlog?.handle).length
    : 0;
  await write(join(theme, "sections/s2s-product-recommendations.liquid"), productRecommendationsSection);
  const sourceFamilyEvidence = await readJson<any>(join(out, "product-family-source-evidence.json")).catch(() => null);
  const familyHasRecommendations = (suffix: string) => Boolean(
    sourceFamilyEvidence?.families?.find((family: any) => family.suffix === suffix)?.viewports?.some((viewport: any) =>
      viewport.states?.some((state: any) => state.state === "initial" && Number(state.data?.layout?.reviews?.cards?.count || 0) > 0),
    ),
  );
  const scrollContractPath = join(out, "product-scroll-contracts.json");
  const scrollContracts = await exists(scrollContractPath)
    ? await readJson<{ schemaVersion: number; overrides: Record<string, ProductScrollOverrides> }>(scrollContractPath)
    : { schemaVersion: 1, overrides: {} };
  if (scrollContracts.schemaVersion !== 1 || !scrollContracts.overrides)
    throw new Error("Invalid project product-scroll-contracts.json");
  const productSection = (name: string, contents: string) =>
    applyProductScrollOverrides(contents, scrollContracts.overrides[name]);
  const portraitWorkflowPath = join(out, "portrait-workflow-contracts.json");
  const portraitWorkflows = await exists(portraitWorkflowPath)
    ? await readJson<PortraitWorkflowContracts>(portraitWorkflowPath)
    : { schemaVersion: 1 as const, products: {} };
  if (portraitWorkflows.schemaVersion !== 1 || !portraitWorkflows.products)
    throw new Error("Invalid project portrait-workflow-contracts.json");
  const catalogBinding = await readJson<any>(join(out, "catalog-binding.json")).catch(() => ({ products: [] }));
  const catalogPlan = await readJson<any>(join(out, "catalog-plan.json")).catch(() => ({ products: [] }));
  const phase3Binding = await readJson<any>(join(out, "phase3-product-binding.json")).catch(() => ({ products: [] }));
  const phase3Plan = await readJson<any>(join(out, "phase3-product-plan.json")).catch(() => ({ products: [] }));
  const portraitBindings = new Map<string, any>();
  for (const bound of [...(catalogBinding.products || []), ...(phase3Binding.products || [])]) {
    if (bound.kind !== "portrait" && bound.family !== "portrait") continue;
    const sourceHandle = String(bound.sourceHandle || bound.handle || "");
    if (sourceHandle)
      portraitBindings.set(sourceHandle, { ...portraitBindings.get(sourceHandle), ...bound, sourceHandle });
  }
  for (const bound of portraitBindings.values()) {
    const planned = [...(catalogPlan.products || []), ...(phase3Plan.products || [])].find((item: any) =>
      String(item.sourceHandle || item.handle || "") === bound.sourceHandle,
    );
    const base = portraitWorkflows.products[bound.sourceHandle] || { petCount: 1 };
    const boundVariantMedia = Object.fromEntries((bound.variants || []).filter((variant: any) => Array.isArray(variant.options) && variant.options.length > 0 && Number.isInteger(variant.galleryPosition) && variant.galleryPosition > 0).map((variant: any) => [variant.options.map(String).join("\u001f"), variant.galleryPosition - 1]));
    const variantMedia = Object.keys(boundVariantMedia).length
      ? boundVariantMedia
      : inferPortraitVariantMedia(planned?.input);
    const swatches: Record<string, number> = {};
    const files = planned?.input?.files || [];
    files.forEach((file: any, index: number) => {
      const name = decodeURIComponent(String(file.originalSource || "").split("?")[0].split("/").pop() || "").toLowerCase();
      for (const value of ["black", "white", "walnut", "birch"])
        if (new RegExp(`(?:^|[_-])${value}\\.[a-z0-9]+$`).test(name)) swatches[value] = index;
    });
    const contract = { ...base, variantMedia, frameSwatches: Object.keys(base.frameSwatches || {}).length ? base.frameSwatches : swatches };
    portraitWorkflows.products[bound.sourceHandle] = contract;
    if (bound.handle) portraitWorkflows.products[bound.handle] = contract;
  }
  const generatorAssetsPath = join(out, "generator-assets.json");
  const generatorAssets = await exists(generatorAssetsPath)
    ? await readJson<{ schemaVersion: number; assets: Array<{ file: string; source: string }> }>(generatorAssetsPath)
    : { schemaVersion: 1, assets: [] };
  if (generatorAssets.schemaVersion !== 1 || !Array.isArray(generatorAssets.assets))
    throw new Error("Invalid project generator-assets.json");
  for (const asset of generatorAssets.assets) {
    if (!asset.file || asset.file !== basename(asset.file) || !asset.source.startsWith("generator-assets/") || asset.source.includes(".."))
      throw new Error(`Unsafe generator asset mapping: ${JSON.stringify(asset)}`);
    await write(join(theme, "assets", asset.file), await readFile(join(out, asset.source)));
  }
  const pagePlan = await readJson<any>(join(out, "phase3-page-plan.json")).catch(
    () => ({ pages: [] }),
  );
  const renderedPageHandles = (pagePlan.pages || [])
    .filter((page: any) => page.family === "rendered-layout")
    .map((page: any) => String(page.handle))
    .filter(Boolean)
    .sort();
  const renderedHandleList = renderedPageHandles.join("|");
  const pageContentPlan = await readJson<any>(join(out, "phase3-content-plan.json")).catch(() => ({ records: [] }));
  const pageProductPlan = await readJson<any>(join(out, "phase3-product-plan.json")).catch(() => ({ products: [] }));
  const pageReviews = buildPageReviewAdapter(pagePlan.pages || [], pageContentPlan.records || [], pageProductPlan.products || []);
  const pageInteractionPath = join(out, "page-interaction-contracts.json");
  const pageInteractions = await exists(pageInteractionPath)
    ? validatePageInteractionContracts(await readJson<PageInteractionContracts>(pageInteractionPath))
    : { schemaVersion: 1 as const, pages: {} };
  await write(join(theme, "snippets/s2s-page-content.liquid"), pageReviews.content);
  await write(join(theme,'snippets/s2s-harold-collection.liquid'),haroldCollectionSnippet);
  await write(join(theme,'snippets/s2s-harold-collection-card.liquid'),haroldCollectionCardSnippet);
  await write(join(theme,'snippets/s2s-harold-share-payments.liquid'),haroldSharePaymentsSnippet);
  await write(join(theme,'assets/s2s-harold-upload.js'),haroldUploadScript);
  for(const[from,to]of haroldUploadDependencies)await write(join(theme,'assets',to),await readFile(join(process.cwd(),'node_modules',from)));
  await write(join(theme, "snippets/s2s-page-rating-product.liquid"), pageReviews.mapping);
  await write(join(theme, "assets/s2s-page-interactions.js"), buildPageInteractionScript(pageInteractions));
  await json(join(out, "page-review-bindings.json"), { schemaVersion: 1, dataPolicy: "target-product-only", pages: pageReviews.coverage });
  await write(
    join(theme, "sections/s2s-page.liquid"),
    `{% assign s2s_rendered_page_handles = '${renderedHandleList}' | split: '|' %}{% if s2s_rendered_page_handles contains page.handle %}<div class="s2s-rendered-page" data-s2s-page-family="rendered-layout" data-s2s-template-fallback="true" data-s2s-page-handle="{{ page.handle | escape }}">{% render 's2s-page-content', page: page %}</div>{% else %}<section class="container s2s-content-page" data-s2s-page-family="prose" data-s2s-page-handle="{{ page.handle | escape }}"><h1>{{ page.title | escape }}</h1><div class="s2s-rte">{% render 's2s-page-content', page: page %}</div></section>{% endif %}<script src="{{ 's2s-page-interactions.js' | asset_url }}" defer></script>${schema("Reference page router")}`,
  );
  await write(
    join(theme, "sections/s2s-rendered-page.liquid"),
    `<div class="s2s-rendered-page" data-s2s-page-family="rendered-layout" data-s2s-page-handle="{{ page.handle | escape }}">{% render 's2s-page-content', page: page %}</div><script src="{{ 's2s-page-interactions.js' | asset_url }}" defer></script>${schema("Rendered layout page")}`,
  );
  await write(
    join(theme, "sections/s2s-page-reviews.liquid"),
    `{% if page.content contains 'data-s2s-page-review-slot' %}<div id="looxReviews" class="loox-widget" data-loox-aggregate data-limit="20" style="margin:0 auto;max-width:1080px"></div>{% endif %}${schema("Landing page reviews")}`,
  );
  await write(
    join(theme, "sections/s2s-collection.liquid"),
    collectionSection,
  );
  await write(
    join(theme, "snippets/s2s-collection-product-card.liquid"),
    collectionProductCardSnippet,
  );
  await write(
    join(theme, "snippets/s2s-product-rating.liquid"),
    looxRatingSnippet,
  );
  await write(
    join(theme, "sections/s2s-blog.liquid"),
    `<section class="container s2s-blog"><header><h1>{{ section.settings.source_heading | default: blog.title | escape }}</h1></header>{% if section.settings.show_articles %}{% paginate blog.articles by 24 %}<div class="s2s-article-grid">{% for article in blog.articles %}<article class="s2s-article-card"><a href="{{ article.url }}">{% if article.image %}{{ article.image | image_url: width: 1000 | image_tag: loading: 'lazy', widths: '400,700,1000', alt: article.image.alt | default: article.title }}{% endif %}<p>{{ article.published_at | date: '%B %d, %Y' }}</p><h2>{{ article.title | escape }}</h2>{% if article.excerpt != blank %}<div>{{ article.excerpt | strip_html | truncatewords: 28 }}</div>{% endif %}<span class="s2s-article-more">Read more</span></a></article>{% endfor %}</div>{{ paginate | default_pagination }}{% endpaginate %}{% endif %}</section>{% schema %}{"name":"Reference blog","settings":[{"type":"text","id":"source_heading","label":"Source heading"},{"type":"checkbox","id":"show_articles","label":"Show source articles","default":true}],"presets":[{"name":"Reference blog"}]}{% endschema %}`,
  );
  await write(
    join(theme, "sections/s2s-article.liquid"),
    `<article class="s2s-article">{% if article.image %}<div class="s2s-article-hero">{{ article.image | image_url: width: 1800 | image_tag: loading: 'eager', widths: '720,1200,1800', alt: article.image.alt | default: article.title }}</div>{% endif %}<div class="s2s-article-inner"><header><h1>{{ article.title | escape }}</h1><p>{% if article.author != blank %}{{ article.author | escape }} @ {% endif %}{{ article.published_at | date: '%b %d, %Y' }}</p></header><div class="s2s-rte">{{ article.content }}</div></div></article>${schema("Reference article")}`,
  );
  await write(
    join(theme, "sections/s2s-standard-product.liquid"),
    productSection("s2s-standard-product", standardProductSection),
  );
  await write(
    join(theme, "sections/s2s-custom-product.liquid"),
    productSection("s2s-custom-product", customProductSection),
  );
  for (const [name, contents] of Object.entries(familyProductSections))
    await write(join(theme, `sections/${name}.liquid`), productSection(name, contents));
  for (const [name, contents] of Object.entries(haroldProductSections))
    await write(join(theme, `sections/${name}.liquid`), productSection(name, contents));
  for (const [name, contents] of Object.entries(familyProductSnippets))
    await write(join(theme, `snippets/${name}.liquid`), contents);
  const templateBinding = await readJson<any>(join(out, "phase3-product-template-binding.json")).catch(() => ({ products: [] }));
  const optionConsumers = templateBinding.products.filter((p: any) => p.templateSuffix === "s2s-embroidered").map((p: any) => p.handle);
  const optionContract = optionConsumers.length
    ? await readJson<OptionMediaContract>(join(out, "option-media-contracts.json"))
    : { schemaVersion: 1 as const, planSha256: "no-bound-consumers", products: {} };
  const optionArtifacts = await buildOptionMediaArtifacts(out, optionContract, optionConsumers);
  await write(join(theme, "snippets/s2s-option-visual.liquid"), optionArtifacts.visual);
  await write(join(theme, "snippets/s2s-option-media-data.liquid"), optionArtifacts.data);
  await write(join(theme, "assets/s2s-option-media.js"), optionMediaScript);
  await write(join(theme, "assets/s2s-option-media.css"), optionMediaStyles);
  await write(join(theme, "assets/s2s-family-product-v3.js"), familyProductScript);
  for (const [name, bytes] of Object.entries(optionArtifacts.assets)) await write(join(theme, "assets", name), bytes);
  if (optionConsumers.length) {
    const optionFiles = ["sections/s2s-embroidered-product.liquid", "snippets/s2s-option-visual.liquid", "snippets/s2s-option-media-data.liquid", "assets/s2s-option-media.js", "assets/s2s-option-media.css", "assets/s2s-family-product-v3.js", ...Object.keys(optionArtifacts.assets).map(name => "assets/" + name)];
    await json(join(out, "option-media-build.json"), {
      schemaVersion: 1,
      consumers: optionConsumers,
      assetNames: optionArtifacts.assetNames,
      contractHash: hash(await readFile(join(out, "option-media-contracts.json"))),
      files: await Promise.all(
        optionFiles.map(async (name) => ({
          name,
          sha256: hash(await readFile(join(theme, name))),
        })),
      ),
    });
  }
  await write(
    join(theme, "sections/s2s-portrait-product.liquid"),
    productSection("s2s-portrait-product", buildPortraitSection(portraitWorkflows)),
  );
  await write(
    join(theme, "snippets/s2s-portrait-variant-media-map.liquid"),
    buildPortraitVariantMediaSnippet(portraitWorkflows),
  );
  await write(
    join(theme, "snippets/s2s-portrait-frame-style.liquid"),
    portraitFrameStyleSnippet,
  );
  await write(
    join(theme, "templates/page.json"),
    JSON.stringify({
      sections: { main: { type: "s2s-page", settings: {} } },
      order: ["main"],
    }),
  );
  await write(
    join(theme, "templates/page.s2s-rendered.json"),
    JSON.stringify({
      sections: {
        main: { type: "s2s-rendered-page", settings: {} },
        page_loox_reviews: { type: "s2s-page-reviews", settings: {} },
      },
      order: ["main", "page_loox_reviews"],
    }),
  );
  await write(
    join(theme, "templates/collection.json"),
    JSON.stringify({
      sections: { main: { type: "s2s-collection", settings: {} } },
      order: ["main"],
    }),
  );
  await write(
    join(theme, "templates/blog.json"),
    JSON.stringify({
      sections: { main: { type: "s2s-blog", settings: { source_heading: sourceBlogTitle, show_articles: sourceBlogArticleCount > 0 } } },
      order: ["main"],
    }),
  );
  await write(
    join(theme, "templates/article.json"),
    JSON.stringify({
      sections: { main: { type: "s2s-article", settings: {} } },
      order: ["main"],
    }),
  );
  await write(
    join(theme, "templates/product.json"),
    JSON.stringify({
      sections: {
        main: { type: "s2s-product", settings: {} },
        loox_reviews: looxReviewsSection,
      },
      order: ["main", "loox_reviews"],
    }),
  );
  const productTemplates = [
    ["s2s-standard", "s2s-standard-product", {}],
    ["s2s-custom", "s2s-custom-product", {}],
    ["s2s-accessory", "s2s-accessory-product", {}],
    ["s2s-apparel", "s2s-apparel-product", { show_priority: true }],
    ["s2s-custom-apparel", "s2s-custom-apparel-product", {}],
    ["s2s-embroidered", "s2s-embroidered-product", {}],
    ["s2s-gift-card", "s2s-gift-card-product", { show_priority: false }],
    ["s2s-hat", "s2s-hat-product", {}],
    ["s2s-home", "s2s-home-product", {}],
    ["s2s-jewelry", "s2s-jewelry-product", {}],
    ["s2s-mug", "s2s-mug-product", {}],
    ["s2s-phone", "s2s-phone-product", {}],
    ["s2s-portrait", "s2s-portrait-product", {}],
    ["s2s-quote", "s2s-quote-product", { show_priority: false }],
    ["s2s-royal", "s2s-portrait-product", {}],
    ["s2s-addon", "s2s-standard-product", {}],
  ] as const;
  for (const [suffix, section, settings] of productTemplates) {
    if (!(await exists(join(theme, `sections/${section}.liquid`)))) continue;
    const details = await capturedDetailsComposition(theme, suffix);
    const recommendations = familyHasRecommendations(suffix);
    const detailOrder = [...details.order];
    if (recommendations) {
      const reviewIndex = detailOrder.indexOf("loox_reviews");
      detailOrder.splice(reviewIndex < 0 ? detailOrder.length : reviewIndex, 0, "recommendations");
    }
    await write(
      join(theme, `templates/product.${suffix}.json`),
      JSON.stringify({
        sections: {
          main: {
            type: section,
            blocks: {
              loox_star_rating: { type: looxStarRatingBlockType, settings: {} },
            },
            block_order: ["loox_star_rating"],
            settings,
          },
          ...details.sections,
          ...(recommendations ? { recommendations: { type: "s2s-product-recommendations", settings: {} } } : {}),
        },
        order: ["main", ...detailOrder],
      }),
    );
  }
  for (const { suffix, section } of haroldProductTemplates) {
    const details = await capturedDetailsComposition(theme, suffix);
    await write(
      join(theme, `templates/product.${suffix}.json`),
      JSON.stringify({
        sections: {
          main: {
            type: section,
            blocks: {
              loox_star_rating: { type: looxStarRatingBlockType, settings: {} },
            },
            block_order: ["loox_star_rating"],
            settings: {},
          },
          ...details.sections,
        },
        order: ["main", ...details.order],
      }),
    );
  }
  await write(
    join(theme, "assets/s2s-family-product.js"),
    familyProductScript,
  );
  await write(
    join(theme, "assets/s2s-family-product.css"),
    `${familyProductStyles}\n${productGalleryStyles}`,
  );
  await write(join(theme, "assets/s2s-harold-product.js"), `${haroldProductScript}\n${haroldProductEnhancementScript}\n${haroldStepScrollScript}\n${haroldSourceSwitchValueScript}`);
  await write(
    join(theme, "assets/s2s-harold-product.css"),
    `${haroldProductStyles}\n${haroldProductContractStyles}\n${productGalleryStyles}\n${haroldSourceLayoutStyles}`,
  );
  await write(
    join(theme, "assets/s2s-product-gallery.js"),
    productGalleryScript,
  );
  await write(
    join(theme, "assets/s2s-variant-sync.js"),
    familyVariantSyncScript,
  );
  await write(
    join(theme, "assets/s2s-portrait-product.js"),
    portraitProductScript,
  );
  await write(
    join(theme, "assets/s2s-portrait-product-v2.js"),
    portraitProductScript,
  );
  await write(
    join(theme, "assets/s2s-portrait-product.css"),
    `${portraitStyles}\n${productGalleryStyles}`,
  );
  await write(
    join(theme, "assets/s2s-phase3.css"),
    `${collectionStyles}\n${productRecommendationsStyles}\n.s2s-rendered-page{display:block;width:100%;min-width:0}[id$="__page_loox_reviews"]{display:none}.s2s-rating-link{display:inline-flex;align-items:center;color:inherit;text-decoration:none}.s2s-product-rating{display:inline-flex;align-items:center;gap:.3rem;white-space:nowrap}.s2s-product-rating .loox-rating-content{display:inline-flex;align-items:center}.s2s-product-rating .loox-icon{color:#1a2829!important}.s2s-product-rating:has(.loox-rating-content)>.s2s-rating-fallback,.s2s-product-rating:has(.loox-rating-content)>.s2s-rating-count{display:none}.s2s-rating-fallback{position:relative;display:inline-block;letter-spacing:.02em;color:#d8d8d8}.s2s-rating-fallback::after{content:'★★★★★';position:absolute;inset:0;width:var(--s2s-rating-percent,0%);overflow:hidden;color:#172728}.s2s-rating-count{font-size:.78em}.s2s-home-card-rating{margin:-.1rem 0 .45rem}.s2s-home-card-rating:empty{display:none}.shopify-section:has(#looxReviews){min-height:24px;padding:2.25rem 0 5rem}.s2s-content-page,.s2s-blog{padding-block:clamp(2.5rem,5vw,5rem)}.s2s-content-page>h1,.s2s-blog>header{text-align:center}.s2s-content-page>h1{margin:0 0 2rem}.s2s-blog h1{margin:0 0 1.5rem}.s2s-rte{max-width:74ch;margin-inline:auto}.s2s-rte img{max-width:100%;height:auto}.s2s-article-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(1rem,2vw,2rem);margin-top:0}.s2s-article-card a{color:inherit;text-decoration:none}.s2s-article-card img{width:100%;aspect-ratio:5/4;object-fit:cover;border-radius:1rem}.s2s-article-card p{font-size:.8rem;opacity:.7;margin:.8rem 0 .35rem}.s2s-article-card h2{font-size:1.25rem;margin:.25rem 0 .6rem}.s2s-article-more{display:inline-flex;margin-top:.9rem;padding:.48rem .9rem;border-radius:999px;background:#d2a287;color:#fff;font-size:.78rem}.s2s-article{width:100%}.s2s-article-hero{width:100%;height:40vh;min-height:20rem;overflow:hidden}.s2s-article-hero img{width:100%;height:100%;object-fit:cover}.s2s-article-inner{max-width:720px;margin-inline:auto;padding:0 12px clamp(3rem,7vw,7rem)}.s2s-article-inner>header{text-align:left;margin:1.5rem 0 2rem}.s2s-article-inner>header h1{margin:0 0 .5rem}.s2s-standard-product{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(20rem,.8fr);gap:clamp(2rem,5vw,6rem);padding-block:clamp(2rem,6vw,6rem)}.s2s-standard-media{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.s2s-standard-media img{width:100%;height:auto;border-radius:1rem}.s2s-standard-details{position:sticky;top:2rem;align-self:start}.s2s-standard-details select,.s2s-standard-details input{display:block;width:100%;margin:.4rem 0 1rem;padding:.75rem;border:1px solid #1a2829;border-radius:.25rem}.s2s-standard-details button{width:100%;margin-top:.5rem}.s2s-family-eyebrow{margin:0 0 .5rem;text-transform:uppercase;letter-spacing:.08em;font-size:.78rem;color:#a77e65}.s2s-family-price{display:flex;gap:.75rem;align-items:center;margin:.5rem 0 1.5rem;font-weight:700}.s2s-family-price s{opacity:.55}.s2s-personalization{margin:1.5rem 0;padding:1.25rem;border-radius:1rem;background:#f7f1ed}.s2s-personalization p{font-size:.82rem;margin:.25rem 0 0}.s2s-photo-preview{display:flex;align-items:center;gap:.75rem;margin:-.35rem 0 1rem}.s2s-photo-preview img{width:64px;height:64px;object-fit:cover;border-radius:.6rem}.s2s-form-status{min-height:1.5em;margin:.75rem 0 0;color:#8b322c}@media(max-width:1024px){.s2s-article-grid{grid-template-columns:1fr}}@media(max-width:767px){.s2s-standard-product{grid-template-columns:1fr}.s2s-standard-details{position:static}}@media(max-width:420px){.s2s-blog{padding-top:2.5rem}.s2s-article-hero{min-height:0;height:40vh}}`,
  );
  const phase3Css = join(theme, "assets/s2s-phase3.css");
  await write(
    phase3Css,
    `${await readFile(phase3Css, "utf8")}\n.overflow-hidden,.instagram-gallery{overflow:hidden!important}.instagram-gallery-list{max-width:none}.s2s-portrait-gallery,.s2s-portrait-details{min-width:0}.image-compare{position:relative;aspect-ratio:1200/950;overflow:hidden}body:has([data-s2s-harold-pop-art]) .image-compare,body:has([data-s2s-harold-watercolor]) .image-compare{aspect-ratio:1/1}.image-compare>img{display:block;width:100%;height:100%;object-fit:cover}.image-compare>img+img{position:absolute;inset:0 0 0 50%;width:50%;object-position:right}.s2s-captured-card-rating{min-height:25px}@media(max-width:800px){.s2s-portrait-pdp{grid-template-columns:minmax(0,1fr)}}`,
  );
  await write(
    phase3Css,
    `${await readFile(phase3Css, "utf8")}\n.s2s-page-type-collection #footer{margin-top:16px}.s2s-page-type-policy #header{margin-bottom:32px}.s2s-page-type-policy #footer{margin-top:32px}`,
  );
}
