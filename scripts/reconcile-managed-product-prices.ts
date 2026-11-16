import { join, resolve } from "node:path";
import { execute, validateStore } from "../src/catalog.js";
import { json, readJson } from "../src/util.js";

const [outArg, storeArg, handlesArg] = process.argv.slice(2);
if (!outArg || !storeArg) throw new Error("Usage: reconcile-managed-product-prices <output> <store.myshopify.com>");
const out = resolve(outArg);
const store = validateStore(storeArg);
const requestedHandles = new Set((handlesArg || "").split(",").map((value) => value.trim()).filter(Boolean));
const plan = await readJson<any>(join(out, "phase3-product-plan.json"));
const binding = await readJson<any>(join(out, "phase3-product-binding.json"));
const changes: any[] = [];

for (const bound of binding.products || []) {
  if (requestedHandles.size && !requestedHandles.has(bound.handle)) continue;
  const desired = (plan.products || []).find((item: any) => item.handle === bound.handle);
  if (!desired || !bound.id || !desired.fingerprint) continue;
  const remote = (await execute(store, "managed-product-variants", { id: bound.id })).product;
  if (!remote || remote.handle !== bound.handle || remote.metafield?.value !== desired.fingerprint)
    throw new Error(`Refusing unmanaged or fingerprint-mismatched product ${bound.handle}`);
  if (remote.variants.pageInfo.hasNextPage) throw new Error(`Variant pagination is unsupported for ${bound.handle}`);
  if (remote.variants.nodes.length !== desired.input.variants.length)
    throw new Error(`Variant count changed for ${bound.handle}`);
  const updates = remote.variants.nodes.flatMap((variant: any, index: number) => {
    const expected = desired.input.variants[index];
    const compareAtPrice = expected.compareAtPrice || null;
    if (String(variant.price) === String(expected.price) && String(variant.compareAtPrice || "") === String(compareAtPrice || "")) return [];
    return [{ id: variant.id, price: expected.price, compareAtPrice }];
  });
  if (!updates.length) continue;
  await execute(store, "managed-product-variant-update", { productId: bound.id, variants: updates }, true);
  changes.push({ handle: bound.handle, variants: updates.length });
}

await json(join(out, "managed-product-price-reconciliation.json"), {
  schemaVersion: 1, store, reconciledAt: new Date().toISOString(), changes,
});
console.log(JSON.stringify({ changedProducts: changes.length, changes }, null, 2));
