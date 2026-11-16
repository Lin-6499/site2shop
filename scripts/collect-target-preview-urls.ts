import { resolve, join } from "node:path";
import { execute } from "../src/catalog.js";
import { json, readJson } from "../src/util.js";

const out = resolve(process.argv[2] || "../haroldhome-replication-20261022-v2");
const binding = await readJson<any>(join(out, "phase3-product-binding.json"));
const deployment = await readJson<any>(join(out, "deployment.json"));
const urls: Record<string, string> = {};

for (const product of binding.products || []) {
  const result = await execute(binding.store, "phase3-product-preview", { id: product.id });
  const preview = result.product?.onlineStorePreviewUrl;
  if (!preview) throw new Error(`No draft preview URL returned for ${product.handle}.`);
  const providerUrl = new URL(preview);
  const previewKey = providerUrl.searchParams.get("preview_key");
  if (!previewKey) throw new Error(`Draft preview URL has no preview_key for ${product.handle}.`);
  // shopifypreview.com always renders the store's published theme and silently
  // discards preview_theme_id. Rebuild the URL on the target storefront so the
  // draft product preview key and unpublished theme cookie can be applied in the
  // same origin. Without this, acceptance captures the right product data using
  // the wrong theme and produces misleading form/layout failures.
  const url = new URL(`/products/${product.handle}`, `https://${binding.store}`);
  url.searchParams.set("preview_key", previewKey);
  url.searchParams.set("preview_theme_id", String(deployment.themeId));
  urls[product.handle] = url.href;
}

await json(join(out, "target-product-preview-urls.json"), {
  schemaVersion: 1,
  store: binding.store,
  themeId: deployment.themeId,
  generatedAt: new Date().toISOString(),
  urls,
});
console.log(`${Object.keys(urls).length} draft product preview URLs collected.`);
