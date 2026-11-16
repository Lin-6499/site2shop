import { join } from "node:path";
import { load } from "cheerio";
import { execute, validateStore } from "./catalog.js";
import { hash, json, readJson } from "./util.js";
import { classifyPageBody } from "./page-family-contracts.js";

type ContentRecord = {
  kind: "page" | "collection" | "product";
  handle: string;
  fingerprint?: string;
  sourceUrl?: string;
  sourceSnapshot: { title?: string; bodyHtml?: string };
};

const readContent = async (out: string) => {
  const content = await readJson<{ records: ContentRecord[] }>(
    join(out, "phase4-content-localized.json"),
  ).catch(() =>
    readJson<{ records: ContentRecord[] }>(join(out, "phase3-content-plan.json")),
  );
  const supplements = await readJson<{ records: ContentRecord[] }>(
    join(out, "phase3-page-supplements.json"),
  ).catch(() => ({ records: [] }));
  const byKey = new Map(content.records.map(record => [`${record.kind}:${record.handle}`, record]));
  for (const record of supplements.records || []) {
    if (record.kind !== "page" || !record.handle || !record.sourceSnapshot?.bodyHtml)
      throw new Error("Invalid phase3 page supplement");
    const key = `${record.kind}:${record.handle}`;
    if (byKey.has(key)) throw new Error(`Page supplement conflicts with captured content: ${record.handle}`);
    byKey.set(key, { ...record, fingerprint: record.fingerprint || hash(record.sourceSnapshot.bodyHtml) });
  }
  return { records: [...byKey.values()] };
};

export function safePageBody(input: string) {
  const $ = load(input, null, false);
  // Source review widgets are merchant-account data, not portable page content.
  // Preserve their rendered position as a target-app mount point, then remove
  // every source-owned widget/feed node so reviews are never copied as HTML.
  const reviewWidgets = $("#looxReviews,#looxReviewsFrame");
  reviewWidgets.each((_, node) => {
    const widget = $(node);
    const root = widget.closest(".shopify-block.shopify-app-block").first();
    const replacement = '<div data-s2s-page-review-slot="loox" aria-live="polite"></div>';
    if (root.length) root.replaceWith(replacement);
    else widget.replaceWith(replacement);
  });
  $("#loox-reviews-feed,.loox-widget[data-product-id]").remove();
  $("script,iframe,object,embed,noscript,form").remove();
  $("*").each((_, node) => {
    for (const name of Object.keys((node as any).attribs || {})) {
      const value = $(node).attr(name) || "";
      if (/^on/i.test(name)) $(node).removeAttr(name);
      if (["href", "src"].includes(name) && /^\s*javascript:/i.test(value))
        $(node).removeAttr(name);
    }
  });
  return $.html().replace(
    /((?:src|href)=(['"]))\/\//gi,
    "$1https://",
  );
}

export async function planPhase3Pages(out: string) {
  const content = await readContent(out);
  const ir = await readJson<any>(join(out, "site-ir.json"));
  const sourceOrigin = new URL(ir.sourceUrl).origin;
  const pages = content.records
    .filter((record) => record.kind === "page" && record.sourceSnapshot.bodyHtml)
    .map((record) => {
      const body = safePageBody(record.sourceSnapshot.bodyHtml || "");
      const contract = classifyPageBody(body);
      const reviewWidgetSlots = load(body, null, false)("[data-s2s-page-review-slot]").length;
      return {
        handle: record.handle,
        fingerprint: record.fingerprint,
        sourceUrl: record.sourceUrl || `${sourceOrigin}/pages/${record.handle}`,
        family: contract.family,
        templateSuffix: contract.templateSuffix,
        marker: contract.marker,
        evidence: contract.evidence,
        reviewWidget: reviewWidgetSlots
          ? { provider: "loox", slots: reviewWidgetSlots, dataPolicy: "target-store-only" }
          : null,
        input: {
        title: record.sourceSnapshot.title || record.handle,
        handle: record.handle,
        body,
        isPublished: false,
        templateSuffix: contract.templateSuffix,
        metafields: [
          {
            namespace: "site2shop",
            key: "source_fingerprint",
            type: "single_line_text_field",
            value: record.fingerprint,
          },
        ],
        },
      };
    });
  const plan = {
    schemaVersion: 1,
    mode: "create-unpublished-no-overwrite",
    generatedAt: new Date().toISOString(),
    pages,
    remoteAssetDependency: `${sourceOrigin}/cdn/`,
    note: "Draft pages are created unpublished. Forms and executable embeds are removed; app-backed pages require replacement components before publishing.",
  };
  await json(join(out, "phase3-page-plan.json"), plan);
  await json(join(out, "page-family-contracts.json"), {
    schemaVersion: 1,
    generatedAt: plan.generatedAt,
    contracts: pages.map(({ handle, sourceUrl, family, templateSuffix, marker, evidence }) => ({
      handle,
      sourceUrl,
      family,
      templateSuffix,
      marker,
      evidence,
      status: "provisional",
    })),
  });
  return plan;
}

export async function auditPhase3(out: string, store: string) {
  validateStore(store);
  const content = await readContent(out);
  const pagePlan = await planPhase3Pages(out);
  const target = await execute(store, "phase3-audit");
  for (const connection of [target.pages, target.collections, target.menus]) {
    if (connection.pageInfo.hasNextPage)
      throw new Error(
        "Target audit exceeded a safe page limit. No writes were performed.",
      );
  }
  const desiredPages = pagePlan.pages;
  const desiredCollections = content.records.filter(
    (record) => record.kind === "collection",
  );
  const pages = desiredPages.map((record) => {
    const existing = target.pages.nodes.find(
      (node: any) => node.handle === record.handle,
    );
    return {
      handle: record.handle,
      sourceTitle: record.input.title,
      family: record.family,
      expectedTemplateSuffix: record.templateSuffix,
      status: existing ? "conflict" : "create",
      existing: existing || null,
    };
  });
  const collections = desiredCollections.map((record) => {
    const existing = target.collections.nodes.find(
      (node: any) => node.handle === record.handle,
    );
    return {
      handle: record.handle,
      sourceTitle: record.sourceSnapshot.title,
      status: existing ? "conflict" : "defer-until-products" ,
      existing: existing || null,
    };
  });
  const result = {
    schemaVersion: 1,
    store,
    auditedAt: new Date().toISOString(),
    mode: "read-only",
    writesPerformed: false,
    pages,
    collections,
    menus: target.menus.nodes,
    counts: {
      pagesCreate: pages.filter((item) => item.status === "create").length,
      pageConflicts: pages.filter((item) => item.status === "conflict").length,
      collectionConflicts: collections.filter(
        (item) => item.status === "conflict",
      ).length,
    },
  };
  await json(join(out, "phase3-target-audit.json"), result);
  return result;
}

export async function syncPhase3Pages(
  out: string,
  store: string,
  handles?: string[],
  adoptHandles: string[] = [],
) {
  validateStore(store);
  const plan = await planPhase3Pages(out);
  const audit = await auditPhase3(out, store);
  const selected = handles?.length
    ? plan.pages.filter((page) => handles.includes(page.handle))
    : plan.pages;
  const adopted = new Set(adoptHandles);
  if ([...adopted].some((handle) => !selected.some((page) => page.handle === handle)))
    throw new Error("Adopted page handles must also be present in the selected generated plan");
  if (handles?.length && selected.length !== new Set(handles).size)
    throw new Error("One or more requested page handles are not present in the generated plan");
  const conflicts = audit.pages.filter((item: any) => {
    if (!selected.some((page) => page.handle === item.handle)) return false;
    if (item.status !== "conflict") return false;
    // A changed fingerprint is expected when the generator repairs or refreshes
    // its own page. The namespaced ownership metafield, not equality with the new
    // payload, distinguishes a managed page from merchant-authored content.
    return !item.existing?.metafield?.value && !adopted.has(item.handle);
  });
  if (conflicts.length)
    throw new Error(
      `Refusing to overwrite ${conflicts.length} existing page handle(s): ${conflicts.map((item: any) => item.handle).join(", ")}`,
    );
  const previous = handles?.length
    ? await readJson<any>(join(out, "phase3-page-binding.json")).catch(() => null)
    : null;
  const binding: any = {
    schemaVersion: 1,
    store,
    syncedAt: new Date().toISOString(),
    mode: "unpublished-drafts",
    pages: Array.isArray(previous?.pages) ? [...previous.pages] : [],
    completed: false,
  };
  if (adopted.size) {
    const backups = audit.pages
      .filter((item: any) => adopted.has(item.handle) && item.existing)
      .map((item: any) => ({
        backedUpAt: new Date().toISOString(),
        handle: item.handle,
        existing: item.existing,
      }));
    await json(join(out, "phase3-page-adoption-backup.json"), {
      schemaVersion: 1,
      store,
      reason: "Explicit adoption of pre-existing page handles before generator-owned synchronization",
      pages: backups,
    });
  }
  const bind = (record: any) => {
    const index = binding.pages.findIndex((page: any) => page.handle === record.handle);
    if (index >= 0) binding.pages[index] = record;
    else binding.pages.push(record);
  };
  for (const page of selected) {
    const existing = audit.pages.find(
      (item: any) => item.handle === page.handle,
    )?.existing;
    if (existing) {
      const result = await execute(
        store,
        "phase3-page-template-update",
        {
          id: existing.id,
          page: {
            title: page.input.title,
            body: page.input.body,
            templateSuffix: page.templateSuffix,
            metafields: page.input.metafields,
          },
        },
        true,
      );
      bind({
        ...result.pageUpdate.page,
        family: page.family,
        expectedTemplateSuffix: page.templateSuffix,
        action: (existing.templateSuffix || null) !== page.templateSuffix
          ? "content-and-template-updated"
          : "content-updated",
      });
    } else {
      const result = await execute(
        store,
        "phase3-page-create",
        { page: page.input },
        true,
      );
      bind({
        ...result.pageCreate.page,
        family: page.family,
        expectedTemplateSuffix: page.templateSuffix,
        action: "created",
      });
    }
    await json(join(out, "phase3-page-binding.json"), binding);
  }
  const verified = await auditPhase3(out, store);
  const selectedHandles = new Set(selected.map((page) => page.handle));
  const verifiedSelection = verified.pages.filter((page: any) =>
    selectedHandles.has(page.handle),
  );
  const mismatches = verifiedSelection.filter(
    (page: any) =>
      (page.existing?.templateSuffix || null) !== page.expectedTemplateSuffix,
  );
  if (mismatches.length)
    throw new Error(
      `Page template read-back failed for: ${mismatches.map((page: any) => page.handle).join(", ")}`,
    );
  binding.verification = {
    auditedAt: verified.auditedAt,
    scope: handles?.length ? "selected-handles" : "all-pages",
    handles: [...selectedHandles],
    routes: verifiedSelection.length,
    mismatches: 0,
  };
  binding.completed = true;
  await json(join(out, "phase3-page-binding.json"), binding);
  return binding;
}

export async function auditPhase3Products(out: string, store: string) {
  validateStore(store);
  const plan = await planPhase3Products(out);
  const target = await execute(store, "phase3-product-audit");
  if (target.products.pageInfo.hasNextPage)
    throw new Error(
      "Target product audit exceeded 250 products. No writes were performed.",
    );
  const products = plan.products.map((record: any) => {
      const existing = target.products.nodes.find(
        (node: any) => node.handle === record.handle,
      );
      return {
        handle: record.handle,
        sourceHandle: record.sourceHandle || record.handle,
        sourceTitle: record.title,
        fingerprint: record.fingerprint,
        status: existing ? "conflict" : "create-draft",
        existing: existing || null,
      };
    });
  const result = {
    schemaVersion: 1,
    store,
    auditedAt: new Date().toISOString(),
    mode: "read-only",
    writesPerformed: false,
    products,
    counts: {
      createDraft: products.filter((item) => item.status === "create-draft")
        .length,
      conflicts: products.filter((item) => item.status === "conflict").length,
    },
  };
  await json(join(out, "phase3-product-audit.json"), result);
  return result;
}

function productFamily(handle: string) {
  if (handle === "gift-card") return "gift-card";
  if (["add-a-santa-hat", "bundle-save", "digital-download"].includes(handle))
    return "addon";
  if (/phone-cases/.test(handle)) return "phone-case";
  if (/custom-pet-embroidery/.test(handle)) return "embroidered-apparel";
  if (/custom-pet-face-pajama|custom-pet-portrait-pajama|pet-inspired.*pajama/.test(handle))
    return "custom-apparel";
  if (/mug/.test(handle)) return "portrait-mug";
  if (/necklace|ring|keychain/.test(handle)) return "engraved-jewelry";
  if (/collar|leash/.test(handle)) return "personalized-accessory";
  if (/blanket|pillows|candle|greeting-cards|wrapping-paper/.test(handle))
    return "custom-home-gift";
  if (/portrait/.test(handle)) return "portrait";
  if (/^custom-/.test(handle)) return "custom";
  return "standard";
}

export function productTemplate(family: string, handle = "") {
  if (family === "addon" || handle === "skip-the-line") return "s2s-addon";
  if (family === "gift-card") return "s2s-gift-card";
  if (family === "portrait") return "s2s-portrait";
  if (family === "portrait-mug") return "s2s-mug";
  if (family === "phone-case") return "s2s-phone";
  if (family === "custom-home-gift") return "s2s-home";
  if (family === "custom-apparel") return "s2s-custom-apparel";
  if (family === "embroidered-apparel") return "s2s-embroidered";
  if (family === "engraved-jewelry") return "s2s-jewelry";
  if (family === "personalized-accessory") return "s2s-accessory";
  if (family === "standard") {
    if (/^(the-baroness|the-decorated-lords-lady|the-protectors|the-royal-court|the-royal-family|their-highness|their-majesties)$/.test(handle))
      return "s2s-royal";
    if (/^(be-the-person-your-dog-things-you-are|cats-people|dogs-people|home-is-where-the-dogs-(are|is)|live-laugh-woof|you-me-(and-the-dogs|the-dog))$/.test(handle))
      return "s2s-quote";
    if (/hat/.test(handle)) return "s2s-hat";
    return "s2s-apparel";
  }
  return "s2s-custom";
}

export async function planPhase3Products(out: string) {
  const content = await readContent(out);
  const ir = await readJson<any>(join(out, "site-ir.json"));
  const sourceBase = new URL(ir.sourceUrl).origin;
  const familyOverrides: Record<string, { family: string; templateSuffix: string; targetHandle?: string }> = await readJson<Record<string, { family: string; templateSuffix: string; targetHandle?: string }>>(
    join(out, "product-family-overrides.json"),
  ).catch((): Record<string, { family: string; templateSuffix: string; targetHandle?: string }> => ({}));
  const deferred: any[] = [];
  const toProduct = (source: any, handle: string, fingerprint: string) => {
    const override = familyOverrides[handle];
    const targetHandle = override?.targetHandle || handle;
    const family = override?.family || productFamily(handle);
    const options = (source.options || []).map((option: any, optionIndex: number) => ({
      name: typeof option === "string" ? option.replace(/:\s*$/, "") : option.name,
      position: typeof option === "string" ? optionIndex + 1 : option.position,
      values: typeof option === "string"
        ? [...new Set((source.variants || []).map((variant: any) => variant.options?.[optionIndex]).filter(Boolean))]
        : option.values,
    }));
    const tags = Array.isArray(source.tags)
      ? source.tags
      : String(source.tags || "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean);
    const input = {
      title: source.title,
      handle: targetHandle,
      vendor: source.vendor || new URL(sourceBase).hostname,
      status: "DRAFT",
      templateSuffix: override?.templateSuffix || productTemplate(family, handle),
      descriptionHtml: source.description || "",
      tags: [
        ...new Set([
          ...tags,
          "site2shop-managed",
          "site2shop-phase3",
          `site2shop-family-${family}`,
          `site2shop-snapshot-${fingerprint}`,
        ]),
      ],
      metafields: [{ namespace: "site2shop", key: "source_fingerprint", type: "single_line_text_field", value: fingerprint }],
      productOptions: options.map((option: any) => ({
        name: option.name,
        position: option.position,
        values: option.values.map((name: string) => ({ name })),
      })),
      files: source.images.slice(0, 50).map((url: string, index: number) => ({
        originalSource: new URL(url, sourceBase).href,
        contentType: "IMAGE",
        alt: `${source.title} ${index + 1}`,
      })),
      variants: source.variants.map((variant: any, index: number) => ({
        optionValues: variant.options.map((name: string, optionIndex: number) => ({ optionName: options[optionIndex].name, name })),
        price: (variant.price / 100).toFixed(2),
        compareAtPrice: variant.compare_at_price ? (variant.compare_at_price / 100).toFixed(2) : null,
        sku: variant.sku || `s2s-p3-${variant.id}`,
        position: index + 1,
        taxable: variant.taxable,
        inventoryPolicy: "DENY",
        inventoryItem: { tracked: false, requiresShipping: variant.requires_shipping },
      })),
    };
    return { handle: targetHandle, sourceHandle: handle, title: source.title, family, fingerprint, variantCount: source.variants.length, imageCount: Math.min(source.images.length, 50), input };
  };
  const products: any[] = content.records
    .filter(
      (record: any) =>
        record.kind === "product" &&
        (record as any).status !== "failed" &&
        record.sourceSnapshot,
    )
    .flatMap((record) => {
      const source: any = record.sourceSnapshot;
      return [toProduct(source, record.handle, record.fingerprint || hash(JSON.stringify(source)))];
    });
  if (ir.product?.handle && ir.product?.variants?.length && !products.some((product) => product.handle === ir.product.handle)) {
    products.unshift(toProduct(ir.product, ir.product.handle, hash(JSON.stringify(ir.product))));
  }
  const families = Object.fromEntries(
    [...new Set(products.map((product) => product.family))].map((family) => [
      family,
      products.filter((product) => product.family === family).length,
    ]),
  );
  const plan = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "create-drafts-no-publication",
    products,
    deferred,
    counts: {
      products: products.length,
      variants: products.reduce((sum, product) => sum + product.variantCount, 0),
      images: products.reduce((sum, product) => sum + product.imageCount, 0),
      deferred: deferred.length,
      families,
    },
    note: "Draft catalog data only. Custom families use the verified s2s-custom upload/name/variant adapter; standard, add-on and gift-card snapshot products use s2s-standard. The gift-card snapshot remains a non-sellable draft until native Shopify gift-card behavior is configured.",
  };
  await json(join(out, "phase3-product-plan.json"), plan);
  return plan;
}

export async function syncPhase3Products(out: string, store: string) {
  validateStore(store);
  const plan = await planPhase3Products(out);
  const audit = await auditPhase3Products(out, store);
  const conflicts = audit.products.filter((item: any) => {
    if (item.status !== "conflict") return false;
    const desired = plan.products.find(
      (product) => product.handle === item.handle,
    );
    return (
      !desired ||
      item.existing?.metafield?.value !== desired.fingerprint
    );
  });
  if (conflicts.length)
    throw new Error(
      `Refusing to overwrite ${conflicts.length} existing product handle(s): ${conflicts.map((item: any) => item.handle).join(", ")}`,
    );
  const binding: any = {
    schemaVersion: 1,
    store,
    syncedAt: new Date().toISOString(),
    mode: "draft-products-no-publication",
    products: [],
    deferred: plan.deferred,
    completed: false,
  };
  for (const product of plan.products) {
    const existing = audit.products.find(
      (item: any) => item.handle === product.handle,
    )?.existing;
    if (existing) {
      binding.products.push({
        ...existing,
        family: product.family,
        variantCount: product.variantCount,
        action: "reused",
      });
    } else {
      const result = await execute(
        store,
        "create",
        { input: product.input },
        true,
      );
      binding.products.push({
        ...result.productSet.product,
        family: product.family,
        variantCount: product.variantCount,
        action: "created",
      });
    }
    await json(join(out, "phase3-product-binding.json"), binding);
  }
  binding.completed = true;
  await json(join(out, "phase3-product-binding.json"), binding);
  return binding;
}

export async function planPhase3ProductTemplates(out: string) {
  const binding = await readJson<any>(
    join(out, "phase3-product-binding.json"),
  );
  if (!binding.completed)
    throw new Error("Phase 3 product binding is incomplete.");
  const desiredPlan = await planPhase3Products(out);
  const products = binding.products.map((product: any) => {
    const desired = desiredPlan.products.find((item: any) => item.handle === product.handle);
    if (!desired?.input?.templateSuffix)
      throw new Error(`No project-owned template contract found for ${product.handle}.`);
    return {
      id: product.id,
      handle: product.handle,
      sourceHandle: desired.sourceHandle || desired.handle,
      family: desired.family,
      currentStatus: product.status,
      templateSuffix: desired.input.templateSuffix,
    };
  });
  const plan = {
    schemaVersion: 1,
    store: binding.store,
    generatedAt: new Date().toISOString(),
    mode: "template-suffix-only-no-publication",
    products,
    counts: {
      products: products.length,
      templates: Object.fromEntries(
        [...new Set(products.map((product: any) => product.templateSuffix))]
          .sort()
          .map((suffix) => [suffix, products.filter((product: any) => product.templateSuffix === suffix).length]),
      ),
    },
  };
  await json(join(out, "phase3-product-template-plan.json"), plan);
  return plan;
}

export async function syncPhase3ProductTemplates(out: string, store: string) {
  validateStore(store);
  const plan = await planPhase3ProductTemplates(out);
  if (plan.store !== store)
    throw new Error(
      `Product binding belongs to ${plan.store}; refusing to write to ${store}.`,
    );
  const binding: any = {
    schemaVersion: 1,
    store,
    syncedAt: new Date().toISOString(),
    mode: "template-suffix-only-no-publication",
    products: [],
    completed: false,
  };
  for (const product of plan.products) {
    const result = await execute(
      store,
      "phase3-product-template-update",
      {
        product: {
          id: product.id,
          templateSuffix: product.templateSuffix,
        },
      },
      true,
    );
    const updated = result.productUpdate.product;
    if (updated.handle !== product.handle)
      throw new Error(
        `Unexpected product state after template update: ${updated.handle} (${updated.status}).`,
      );
    binding.products.push({
      ...updated,
      family: product.family,
      action: "template-updated",
    });
    await json(join(out, "phase3-product-template-binding.json"), binding);
  }
  binding.completed = true;
  await json(join(out, "phase3-product-template-binding.json"), binding);
  return binding;
}
