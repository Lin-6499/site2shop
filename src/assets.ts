import { load } from "cheerio";
import { extname, join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import valueParser from "postcss-value-parser";
import sharp from "sharp";
import { safeFetch } from "./network.js";
import { hash, json, pool, write } from "./util.js";
import type { SiteIR, Asset } from "./types.js";

const rasterExtensions: Record<string, string> = {
  avif: ".avif",
  gif: ".gif",
  jpeg: ".jpeg",
  jpg: ".jpeg",
  png: ".png",
  webp: ".webp",
};
const stableRasterExtensions = new Set([
  ".avif",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
]);

async function convertRasterAsset(body: Buffer, extension: string) {
  const image = sharp(body, { animated: extension === ".gif" });
  switch (extension) {
    case ".avif":
      return image.avif().toBuffer();
    case ".gif":
      return image.gif().toBuffer();
    case ".jpeg":
    case ".jpg":
      return image.jpeg().toBuffer();
    case ".png":
      return image.png().toBuffer();
    case ".webp":
      return image.webp().toBuffer();
    default:
      throw new Error(`Unsupported raster output extension: ${extension}`);
  }
}

export async function inspectRasterAsset(body: Buffer) {
  const metadata = await sharp(body).metadata();
  const extension = metadata.format
    ? rasterExtensions[metadata.format.toLowerCase()]
    : undefined;
  if (!metadata.width || !metadata.height || !extension)
    throw new Error("Unsupported or undecodable raster image format");
  return {
    width: metadata.width,
    height: metadata.height,
    extension,
  };
}

export function resolveAsset(value: string, base: string) {
  if (!value || /^(data:|blob:|#|javascript:)/i.test(value)) return null;
  try {
    const u = new URL(value, base);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

export function canonicalShopifyAssetUrl(
  value: string,
  canonicalStoreRoot: string | null,
) {
  if (!canonicalStoreRoot) return null;
  try {
    const url = new URL(value);
    const marker = "/cdn/shop/";
    if (!url.pathname.startsWith(marker)) return null;
    const root = canonicalStoreRoot.replace(/\/$/, "");
    return `${root}/${url.pathname.slice(marker.length)}${url.search}`;
  } catch {
    return null;
  }
}

async function fetchAssetWithRetries(
  candidates: string[],
  headers: Record<string, string> = {},
) {
  const errors: string[] = [];
  const uniqueCandidates = [...new Set(candidates.filter(Boolean))];
  for (let attempt = 1; attempt <= 3; attempt++) {
    for (const candidate of uniqueCandidates) {
      try {
        const response = await safeFetch(candidate, headers);
        if (response.ok) return response;
        errors.push(`${candidate} returned HTTP ${response.status} (attempt ${attempt})`);
      } catch (error) {
        errors.push(`${candidate} failed (attempt ${attempt}): ${String(error)}`);
      }
    }
  }
  throw new Error(`Asset fetch exhausted retries: ${errors.join("; ")}`);
}
export function cssUrls(css: string, base: string): string[] {
  const urls: string[] = [];
  const ast = valueParser(css);
  ast.walk((node) => {
    if (node.type === "function" && node.value.toLowerCase() === "url") {
      const u = resolveAsset(
        valueParser.stringify(node.nodes).replace(/^['"]|['"]$/g, ""),
        base,
      );
      if (u) urls.push(u);
    }
  });
  return urls;
}
export function rewriteCss(
  css: string,
  base: string,
  map: Map<string, Asset>,
): string {
  const ast = valueParser(css);
  ast.walk((node) => {
    if (node.type === "function" && node.value.toLowerCase() === "url") {
      const u = resolveAsset(
        valueParser.stringify(node.nodes).replace(/^['"]|['"]$/g, ""),
        base,
      );
      const asset = u ? map.get(u) : null;
      if (asset?.status === "ready")
        node.nodes = [
          {
            type: "string",
            quote: '"',
            value: asset.file,
            sourceIndex: 0,
            sourceEndIndex: 0,
          },
        ];
    }
  });
  return ast.toString();
}

export async function collectAssets(
  ir: SiteIR,
  out: string,
  additionalDocuments: Array<{ htmlPath: string; baseUrl: string }> = [],
) {
  const urls = new Set<string>();
  let canonicalStoreRoot: string | null = null;
  const observeCanonicalStoreRoot = (html: string) => {
    const match = html.match(
      /(?:https?:)?\/\/cdn\.shopify\.com\/s\/files\/(1\/\d{4}\/\d{4}\/\d{4})(?:\/|$)/i,
    );
    if (match) canonicalStoreRoot = `https://cdn.shopify.com/s/files/${match[1]}`;
  };
  const network = new Map<string, { path: string; mime: string }>();
  for (const f of await readdir(join(out, "capture/network")).catch(() => [])) {
    if (!f.endsWith(".json")) continue;
    const meta = JSON.parse(
      await readFile(join(out, "capture/network", f), "utf8"),
    );
    network.set(meta.url, {
      path: join(out, "capture/network", f.slice(0, -5)),
      mime: meta.mime,
    });
  }
  for (const p of ir.pages) {
    const html = await readFile(join(out, p.rawHtml), "utf8");
    observeCanonicalStoreRoot(html);
    if (!canonicalStoreRoot && p.html) {
      const renderedHtml = await readFile(join(out, p.html), "utf8").catch(
        () => "",
      );
      observeCanonicalStoreRoot(renderedHtml);
    }
    const $ = load(html);
    $("img,source,video").each((_, el) => {
      for (const attr of ["src", "poster", "data-src"]) {
        const u = resolveAsset($(el).attr(attr) || "", p.url);
        if (u) urls.add(u);
      }
      for (const part of ($(el).attr("srcset") || "").split(",")) {
        const u = resolveAsset(part.trim().split(/\s+/)[0], p.url);
        if (u) urls.add(u);
      }
    });
    $('link[rel="stylesheet"]').each((_, el) => {
      const u = resolveAsset($(el).attr("href") || "", p.url);
      if (u && /\/cdn\/shop\/t\//.test(u)) urls.add(u);
    });
    $("style,[style]").each((_, el) => {
      cssUrls(
        el.tagName === "style" ? $(el).text() : $(el).attr("style") || "",
        p.url,
      ).forEach((u) => urls.add(u));
    });
    $("[data-bs-title]").each((_, el) => {
      const html = $(el).attr("data-bs-title") || "";
      for (const m of html.matchAll(/src=['"]([^'"]+)/g)) {
        const u = resolveAsset(m[1], p.url);
        if (u) urls.add(u);
      }
    });
  }
  // Family-detail sections are generated from independently rendered product
  // evidence, not from the two bootstrap IR pages. Their assets must enter the
  // same deterministic theme-asset pipeline or captured post-product content
  // will silently retain source-store hotlinks.
  for (const document of additionalDocuments) {
    const html = await readFile(document.htmlPath, "utf8");
    observeCanonicalStoreRoot(html);
    const $ = load(html);
    $("img,source,video").each((_, el) => {
      for (const attr of ["src", "poster", "data-src"]) {
        const u = resolveAsset($(el).attr(attr) || "", document.baseUrl);
        if (u) urls.add(u);
      }
      for (const part of ($(el).attr("srcset") || "").split(",")) {
        const u = resolveAsset(part.trim().split(/\s+/)[0], document.baseUrl);
        if (u) urls.add(u);
      }
    });
    $("style,[style]").each((_, el) => {
      cssUrls(
        el.tagName === "style" ? $(el).text() : $(el).attr("style") || "",
        document.baseUrl,
      ).forEach((u) => urls.add(u));
    });
    $("[data-bs-title]").each((_, el) => {
      const html = $(el).attr("data-bs-title") || "";
      for (const match of html.matchAll(/src=['"]([^'"]+)/g)) {
        const u = resolveAsset(match[1], document.baseUrl);
        if (u) urls.add(u);
      }
    });
  }
  if (ir.product)
    for (const u of ir.product.images || []) {
      const abs = resolveAsset(u, ir.sourceUrl);
      if (abs) urls.add(abs);
    }
  canonicalStoreRoot ||= [...urls]
    .map((url) =>
      url.match(
        /^(https:\/\/cdn\.shopify\.com\/s\/files\/1\/\d{4}\/\d{4}\/\d{4})(?:\/|$)/i,
      )?.[1],
    )
    .find(Boolean) || null;
  const map = new Map<string, Asset>();
  const bodies = new Map<string, Buffer>();
  async function fetchOne(url: string) {
    let body: Buffer;
    let mime: string;
    const canonicalUrl = canonicalShopifyAssetUrl(url, canonicalStoreRoot);
    try {
      const cached = network.get(url);
      if (cached) {
        body = await readFile(cached.path);
        mime = cached.mime;
      } else {
        const res = await fetchAssetWithRetries(
          canonicalUrl ? [canonicalUrl, url] : [url],
        );
        mime = res.headers.get("content-type") || "";
        if (Number(res.headers.get("content-length")) > 24000000)
          throw new Error("Asset exceeds 24 MB limit");
        body = Buffer.from(await res.arrayBuffer());
        if (body.length > 24000000)
          throw new Error("Asset exceeds 24 MB limit");
      }
      if (/text\/html/.test(mime)) throw new Error("Asset returned HTML");
      const pathname = new URL(url).pathname;
      const requestedExt = extname(pathname).toLowerCase();
      const rasterCandidate =
        /^image\/(?!svg)/i.test(mime) ||
        /\.(?:avif|gif|jpe?g|png|webp)$/i.test(pathname);
      let raster: Awaited<ReturnType<typeof inspectRasterAsset>> | null = null;
      if (rasterCandidate) {
        raster = await inspectRasterAsset(body).catch(() => null);
        if (!raster) {
          const fallback = await fetchAssetWithRetries(
            canonicalUrl ? [canonicalUrl, url] : [url],
            {
              Accept: "image/jpeg,image/png,image/gif,image/webp,*/*;q=0.8",
            },
          );
          const fallbackBody = Buffer.from(await fallback.arrayBuffer());
          if (fallbackBody.length > 24000000)
            throw new Error("Asset exceeds 24 MB limit");
          raster = await inspectRasterAsset(fallbackBody).catch(() => null);
          if (!raster)
            throw new Error(
              "Image bytes are not browser-compatible after fallback refetch",
            );
          body = fallbackBody;
          mime = fallback.headers.get("content-type") || mime;
        }
        const decodedExt = raster.extension === ".jpeg" ? ".jpg" : raster.extension;
        const normalizedRequestedExt =
          requestedExt === ".jpeg" ? ".jpg" : requestedExt;
        if (
          stableRasterExtensions.has(requestedExt) &&
          decodedExt !== normalizedRequestedExt
        ) {
          body = await convertRasterAsset(body, requestedExt);
          raster = await inspectRasterAsset(body);
          mime =
            requestedExt === ".jpg" || requestedExt === ".jpeg"
              ? "image/jpeg"
              : `image/${requestedExt.slice(1)}`;
        }
      }
      let ext = extname(pathname).replace(/[^.a-zA-Z0-9]/g, "");
      if (raster)
        ext = stableRasterExtensions.has(requestedExt)
          ? requestedExt
          : raster.extension;
      if (!ext || ext.length > 8)
        ext = /css/.test(mime)
          ? ".css"
          : /woff2/.test(mime)
            ? ".woff2"
            : /png/.test(mime)
              ? ".png"
              : /svg/.test(mime)
                ? ".svg"
                : ".bin";
      const a: Asset = {
        url,
        file: `s2s-${hash(url).slice(0, 16)}${ext}`,
        sha256: hash(body),
        bytes: body.length,
        mime,
        status: "ready",
      };
      if (raster) {
        a.width = raster.width;
        a.height = raster.height;
      }
      map.set(url, a);
      bodies.set(url, body);
    } catch (e) {
      map.set(url, {
        url,
        file: "s2s-missing.svg",
        sha256: "",
        bytes: 0,
        mime: "",
        status: "failed",
        error: String(e),
      });
    }
  }
  for (let depth = 0; depth < 5; depth++) {
    const pending = [...urls].filter((u) => !map.has(u));
    if (!pending.length) break;
    console.log(
      `Assets: fetching ${pending.length} resources (pass ${depth + 1})`,
    );
    await pool(pending, 8, fetchOne);
    for (const [url, asset] of map) {
      if (
        asset.status === "ready" &&
        (asset.file.endsWith(".css") || /css/.test(asset.mime))
      ) {
        const css = bodies.get(url)!.toString();
        cssUrls(css, url).forEach((u) => urls.add(u));
        for (const m of css.matchAll(/@import\s+["']([^"']+)["']/g)) {
          const u = resolveAsset(m[1], url);
          if (u) urls.add(u);
        }
      }
    }
  }
  for (const [url, asset] of map) {
    if (asset.status !== "ready") continue;
    let body = bodies.get(url)!;
    if (asset.file.endsWith(".css")) {
      let css = rewriteCss(body.toString(), url, map);
      css = css.replace(/@import\s+["']([^"']+)["']/g, (full, path) => {
        const a = map.get(resolveAsset(path, url) || "");
        return a?.status === "ready" ? `@import "${a.file}"` : full;
      });
      body = Buffer.from(css);
    }
    await write(join(out, "theme/assets", asset.file), body);
  }
  await write(
    join(out, "theme/assets/s2s-missing.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#eee"/><text x="30" y="200" font-size="20">Resource unavailable — see report</text></svg>',
  );
  ir.assets = [...map.values()];
  await json(join(out, "assets-manifest.json"), ir.assets);
  await json(join(out, "site-ir.json"), ir);
  return map;
}
