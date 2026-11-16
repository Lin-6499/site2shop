import { basename, extname, join } from "node:path";
import { load } from "cheerio";
import { execute, validateStore } from "./catalog.js";
import { hash, json, readJson } from "./util.js";

const IMAGE = /\.(?:avif|gif|jpe?g|png|svg|webp)(?:$|\?)/i;

function normalize(input: string, base: string) {
  try {
    const url = new URL(input, base);
    if (!/^https?:$/.test(url.protocol) || !IMAGE.test(url.href)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function htmlAssets(html: string, base: string) {
  const $ = load(html || "", null, false);
  const assets: Array<{ sourceUrl: string; alt: string }> = [];
  $("img,source,video").each((_, node) => {
    const alt = ($(node).attr("alt") || "Site content image").slice(0, 512);
    for (const attr of ["src", "data-src", "poster"]) {
      const sourceUrl = normalize($(node).attr(attr) || "", base);
      if (sourceUrl) assets.push({ sourceUrl, alt });
    }
    for (const value of ($(node).attr("srcset") || "").split(",")) {
      const sourceUrl = normalize(value.trim().split(/\s+/)[0] || "", base);
      if (sourceUrl) assets.push({ sourceUrl, alt });
    }
  });
  return assets;
}

export async function planPhase4Assets(out: string) {
  const content = await readJson<any>(join(out, "phase3-content-plan.json"));
  const byUrl = new Map<string, { sourceUrl: string; alt: string }>();
  for (const record of content.records) {
    const source = record.sourceSnapshot || {};
    for (const html of [source.bodyHtml, source.descriptionHtml]) {
      if (!html) continue;
      for (const asset of htmlAssets(html, record.sourceUrl || content.source))
        if (!byUrl.has(asset.sourceUrl)) byUrl.set(asset.sourceUrl, asset);
    }
  }
  const assets = [...byUrl.values()].map((asset) => {
    const url = new URL(asset.sourceUrl);
    const extension = extname(url.pathname).toLowerCase() || ".jpg";
    const stem = basename(url.pathname, extension)
      .replace(/[^a-z0-9-]+/gi, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "image";
    return {
      ...asset,
      filename: `s2s-${hash(asset.sourceUrl).slice(0, 12)}-${stem}${extension}`,
      input: {
        originalSource: asset.sourceUrl,
        contentType: "IMAGE",
        alt: asset.alt,
        filename: `s2s-${hash(asset.sourceUrl).slice(0, 12)}-${stem}${extension}`,
      },
    };
  });
  const plan = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "copy-inline-images-to-shopify-files",
    assets,
    counts: { uniqueImages: assets.length },
  };
  await json(join(out, "phase4-asset-plan.json"), plan);
  return plan;
}

export async function syncPhase4Assets(out: string, store: string) {
  validateStore(store);
  const plan = await planPhase4Assets(out);
  const previous = await readJson<any>(
    join(out, "phase4-asset-binding.json"),
  ).catch(() => null);
  if (previous && previous.store !== store)
    throw new Error(`Asset binding belongs to ${previous.store}.`);
  const binding: any = previous || {
    schemaVersion: 1,
    store,
    syncedAt: new Date().toISOString(),
    mode: "shopify-files",
    assets: [],
    completed: false,
  };
  const bound = new Set(binding.assets.map((asset: any) => asset.sourceUrl));
  const pending = plan.assets.filter((asset) => !bound.has(asset.sourceUrl));
  for (let index = 0; index < pending.length; index += 25) {
    const batch = pending.slice(index, index + 25);
    const result = await execute(
      store,
      "phase4-file-create",
      { files: batch.map((asset) => asset.input) },
      true,
    );
    if (result.fileCreate.files.length !== batch.length)
      throw new Error("Shopify returned an incomplete file batch.");
    result.fileCreate.files.forEach((file: any, offset: number) =>
      binding.assets.push({
        sourceUrl: batch[offset].sourceUrl,
        filename: batch[offset].filename,
        ...file,
        targetUrl: file.image?.url || null,
      }),
    );
    await json(join(out, "phase4-asset-binding.json"), binding);
  }
  binding.completed = binding.assets.length === plan.assets.length;
  await json(join(out, "phase4-asset-binding.json"), binding);
  return binding;
}

export async function resolvePhase4Assets(out: string, store: string) {
  validateStore(store);
  const binding = await readJson<any>(join(out, "phase4-asset-binding.json"));
  if (binding.store !== store) throw new Error(`Asset binding belongs to ${binding.store}.`);
  for (let index = 0; index < binding.assets.length; index += 100) {
    const batch = binding.assets.slice(index, index + 100);
    const result = await execute(store, "phase4-file-nodes", {
      ids: batch.map((asset: any) => asset.id),
    });
    result.nodes.forEach((file: any, offset: number) => {
      batch[offset].fileStatus = file?.fileStatus || "FAILED";
      batch[offset].targetUrl = file?.image?.url || null;
    });
  }
  binding.resolvedAt = new Date().toISOString();
  binding.ready = binding.assets.filter(
    (asset: any) => asset.fileStatus === "READY" && asset.targetUrl,
  ).length;
  await json(join(out, "phase4-asset-binding.json"), binding);
  return binding;
}

export async function localizePhase4Content(out: string) {
  const content = await readJson<any>(join(out, "phase3-content-plan.json"));
  const binding = await readJson<any>(join(out, "phase4-asset-binding.json"));
  const processing = binding.assets.filter(
    (asset: any) => asset.fileStatus !== "READY" && asset.fileStatus !== "FAILED",
  );
  if (processing.length)
    throw new Error(`${processing.length} Shopify files are still processing.`);
  const replacements = new Map(
    binding.assets
      .filter((asset: any) => asset.fileStatus === "READY" && asset.targetUrl)
      .map((asset: any) => [asset.sourceUrl, asset.targetUrl]),
  );
  const rewrite = (html: string, base: string) => {
    const $ = load(html || "", null, false);
    $("img,source,video").each((_, node) => {
      for (const attr of ["src", "data-src", "poster"]) {
        const raw = $(node).attr(attr);
        if (!raw) continue;
        const sourceUrl = normalize(raw, base);
        const target = sourceUrl ? replacements.get(sourceUrl) : null;
        if (target) $(node).attr(attr, target as string);
      }
      const srcset = $(node).attr("srcset");
      if (srcset)
        $(node).attr(
          "srcset",
          srcset
            .split(",")
            .map((value) => {
              const [raw, ...descriptor] = value.trim().split(/\s+/);
              const sourceUrl = normalize(raw, base);
              return `${(sourceUrl && replacements.get(sourceUrl)) || raw} ${descriptor.join(" ")}`.trim();
            })
            .join(", "),
        );
    });
    return $.html();
  };
  const localized = {
    ...content,
    localizedAt: new Date().toISOString(),
    inlineAssetsLocalized: replacements.size,
    preservedSourceAssets: binding.assets
      .filter((asset: any) => asset.fileStatus === "FAILED")
      .map((asset: any) => asset.sourceUrl),
    records: content.records.map((record: any) => {
      const source = { ...(record.sourceSnapshot || {}) };
      if (source.bodyHtml)
        source.bodyHtml = rewrite(source.bodyHtml, record.sourceUrl || content.source);
      if (source.descriptionHtml)
        source.descriptionHtml = rewrite(
          source.descriptionHtml,
          record.sourceUrl || content.source,
        );
      return { ...record, sourceSnapshot: source };
    }),
  };
  await json(join(out, "phase4-content-localized.json"), localized);
  return localized;
}
