import { readFile, mkdtemp, unlink, rmdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { load } from "cheerio";
import { json, readJson, write } from "./util.js";
import { shopify, parseCliJson } from "./shopify.js";
import type { SiteIR } from "./types.js";

export const API_VERSION = "2026-10";
const sourceDir = dirname(fileURLToPath(import.meta.url));
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
const dollars = (cents: number) => (cents / 100).toFixed(2);
export const optionKey = (values: string[]) => JSON.stringify(values);
export function validateStore(store: string) {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(store))
    throw new Error("Use an xxx.myshopify.com domain.");
  return store;
}
export async function execute(
  store: string,
  operation: string,
  variables = {},
  mutation = false,
) {
  validateStore(store);
  const temp = await mkdtemp(join(tmpdir(), "site2shop-"));
  try {
    const variableFile = join(temp, "variables.json");
    await json(variableFile, variables);
    const args = [
      "store",
      "execute",
      "--store",
      store,
      "--query-file",
      join(sourceDir, "graphql", operation + ".graphql"),
      "--variable-file",
      variableFile,
      "--version",
      API_VERSION,
      "--json",
      "--no-input",
    ];
    if (mutation) args.push("--allow-mutations");
    const result = parseCliJson(await shopify(args));
    if (result.errors?.length) throw new Error(JSON.stringify(result.errors));
    const data = result.data ?? result;
    for (const value of Object.values(data) as any[])
      if (value?.userErrors?.length)
        throw new Error(JSON.stringify(value.userErrors));
    return data;
  } finally {
    await unlink(join(temp, "variables.json")).catch(() => {});
    await rmdir(temp);
  }
}

export async function planCatalog(out: string) {
  const ir = await readJson<SiteIR>(join(out, "site-ir.json"));
  const p = ir.product;
  if (!p?.variants?.length || p.variants.length > 250)
    throw new Error("This adapter supports 1–250 variants.");
  const evidence = ir.pages.find((p) => p.kind === "product")!;
  const raw = await readFile(join(out, evidence.rawHtml), "utf8");
  const $ = load(raw);
  const currency = raw.match(
    /Shopify\.currency\s*=\s*\{[^}]*["']active["']\s*:\s*["']([A-Z]{3})/,
  )?.[1];
  if (!currency)
    throw new Error(
      "Source currency was not captured. Cannot safely interpret prices.",
    );
  const ownerTag = "site2shop-source-" + digest(new URL(ir.sourceUrl).origin);
  const inputs: any[] = [
    {
      sourceId: String(p.id),
      sourceHandle: p.handle,
      kind: "portrait",
      input: {
        title: p.title,
        handle: "s2s-" + p.handle,
        vendor: "Site2Shop Test",
        status: "ACTIVE",
        descriptionHtml:
          "<p>Site2Shop test catalog. Custom portrait with photo and pet name.</p>",
        productOptions: p.options.map((o: any) => ({
          name: o.name,
          position: o.position,
          values: o.values.map((name: string) => ({ name })),
        })),
        files: p.images
          .slice(0, 50)
          .map((url: string, i: number) => ({
            originalSource: new URL(url, ir.sourceUrl).href,
            contentType: "IMAGE",
            alt: `${p.title} ${i + 1}`,
          })),
        variants: p.variants.map((v: any, i: number) => ({
          optionValues: v.options.map((name: string, j: number) => ({
            optionName: p.options[j].name,
            name,
          })),
          price: dollars(v.price),
          compareAtPrice: v.compare_at_price
            ? dollars(v.compare_at_price)
            : null,
          sku: `s2s-${v.id}`,
          position: i + 1,
          taxable: v.taxable,
          inventoryPolicy: "DENY",
          inventoryItem: {
            tracked: !v.available,
            requiresShipping: v.requires_shipping,
          },
        })),
      },
      sources: p.variants.map((v: any) => ({
        id: String(v.id),
        options: v.options,
        galleryPosition: v.featured_image?.position || 1,
      })),
    },
  ];
  const names: Record<string, string> = {
    "artwork-proof-checkbox": "Artwork Preview",
    "checkbox-skip-the-line": "Priority Artwork",
    "checkbox-digital-download": "Digital Download",
    "checkbox-santa-hat": "Santa Hat",
  };
  $("#form-custom-pet-portrait input[type=checkbox][data-price]").each(
    (_, e) => {
      const selector = $(e).attr("id")!;
      if (!names[selector])
        throw new Error(`Unrecognized paid add-on: ${selector}`);
      const cents = Number($(e).attr("data-price"));
      if (!Number.isInteger(cents) || cents <= 0)
        throw new Error("Invalid add-on price");
      const sourceId = $(e).attr("value")!;
      inputs.push({
        sourceId,
        selector,
        kind: "addon",
        input: {
          title: names[selector],
          handle: "s2s-" + selector,
          vendor: "Site2Shop Test",
          status: "ACTIVE",
          templateSuffix: "s2s-addon",
          descriptionHtml:
            "<p>Optional service for a custom portrait. Test product.</p>",
          productOptions: [
            { name: "Title", position: 1, values: [{ name: "Default Title" }] },
          ],
          variants: [
            {
              optionValues: [{ optionName: "Title", name: "Default Title" }],
              price: dollars(cents),
              sku: "s2s-addon-" + sourceId,
              inventoryPolicy: "DENY",
              inventoryItem: { tracked: false, requiresShipping: false },
              taxable: true,
            },
          ],
        },
        sources: [{ id: sourceId, options: ["Default Title"] }],
      });
    },
  );
  for (const entry of inputs) {
    entry.fingerprint = digest(entry.input);
    entry.input.tags = [
      "site2shop-managed",
      ownerTag,
      "site2shop-snapshot-" + entry.fingerprint,
    ];
  }
  const plan = {
    schemaVersion: 2,
    apiVersion: API_VERSION,
    source: ir.sourceUrl,
    currency,
    ownerTag,
    mode: "create-or-reuse-no-overwrite",
    products: inputs,
  };
  await json(join(out, "catalog-plan.json"), plan);
  return plan;
}

export function bindVariants(entry: any, target: any) {
  if (target.variants.pageInfo.hasNextPage)
    throw new Error("Target variant count exceeds supported limit.");
  const nodes = target.variants.nodes;
  return entry.sources.map((s: any) => {
    const v = nodes.find(
      (v: any) =>
        optionKey(v.selectedOptions.map((o: any) => o.value)) ===
        optionKey(s.options),
    );
    if (!v)
      throw new Error(`Missing target variant for ${optionKey(s.options)}`);
    return {
      sourceId: s.id,
      targetId: v.id,
      id: Number(v.id.split("/").pop()),
      options: s.options,
      price: Math.round(Number(v.price) * 100),
      galleryPosition: s.galleryPosition,
    };
  });
}
export async function syncCatalog(out: string, store: string) {
  validateStore(store);
  const plan = await planCatalog(out);
  const context = await execute(store, "context");
  if (context.shop.currencyCode !== plan.currency)
    throw new Error(
      `Currency mismatch: source ${plan.currency}, target ${context.shop.currencyCode}. No products written.`,
    );
  const publications = context.publications.nodes.filter((p: any) =>
    ["Online Store", "在线商店"].includes(p.name),
  );
  if (publications.length !== 1)
    throw new Error("Cannot unambiguously identify Online Store publication.");
  const binding: any = {
    schemaVersion: 2,
    store,
    source: plan.source,
    currency: plan.currency,
    syncedAt: new Date().toISOString(),
    products: [],
    completed: false,
  };
  const existingBinding = await readJson<any>(
    join(out, "catalog-binding.json"),
  ).catch(() => null);
  if (existingBinding && existingBinding.store !== store)
    throw new Error(
      "Output is already bound to another store. Use a fresh output directory.",
    );
  for (const entry of plan.products) {
    const identifier = { handle: entry.input.handle };
    let target = (await execute(store, "product", { identifier }))
      .productByIdentifier;
    if (
      target &&
      (!target.tags.includes(plan.ownerTag) ||
        !target.tags.includes("site2shop-snapshot-" + entry.fingerprint))
    )
      throw new Error(
        `Refusing to overwrite existing product ${entry.input.handle}. Snapshot/ownership differs.`,
      );
    if (!target) {
      console.log(
        `Creating ${entry.input.handle} (${entry.input.variants.length} variants)`,
      );
      await execute(store, "create", { input: entry.input }, true);
      target = (await execute(store, "product", { identifier }))
        .productByIdentifier;
    } else console.log(`Reusing ${entry.input.handle}`);
    const variants = bindVariants(entry, target);
    await execute(
      store,
      "publish",
      { id: target.id, input: [{ publicationId: publications[0].id }] },
      true,
    );
    binding.products.push({
      sourceId: entry.sourceId,
      sourceHandle: entry.sourceHandle,
      selector: entry.selector,
      kind: entry.kind,
      id: target.id,
      handle: target.handle,
      variants,
    });
    await json(join(out, "catalog-binding.json"), binding);
  }
  binding.completed = true;
  await json(join(out, "catalog-binding.json"), binding);
  console.log(
    `Catalog bound: ${binding.products.length} products. Theme remains unpublished.`,
  );
  return binding;
}
