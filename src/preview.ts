import { Liquid } from "liquidjs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve, extname, sep } from "node:path";
import { json, readJson, write } from "./util.js";
import type { SiteIR } from "./types.js";
import { assertGeneratedThemeIntegrity } from "./theme-integrity.js";
export async function renderPreview(out: string, productHandles: string[] = []) {
  const build = await assertGeneratedThemeIntegrity(out);
  const ir = await readJson<SiteIR>(join(out, "site-ir.json"));
  const plan = await readJson<any>(join(out, "catalog-plan.json")).catch(
    () => null,
  );
  const localProducts: Record<string, any> = Object.fromEntries(
    (plan?.products || [])
      .filter((p: any) => p.kind === "addon")
      .map((p: any) => [
        p.input.handle,
        (() => {
          const variant = {
            id: p.input.variants[0].legacyResourceId || p.input.variants[0].id || 0,
            available: true,
            price: Math.round(Number(p.input.variants[0].price) * 100),
          };
          return { variants: [variant], selected_or_first_available_variant: variant };
        })(),
      ]),
  );
  const engine = new Liquid({
    root: [join(out, "theme/snippets")],
    extname: ".liquid",
  });
  // LiquidDoc is understood by Shopify's runtime but not yet by LiquidJS.
  // Consume it as a non-rendering block so local previews can load the exact
  // production snippets instead of maintaining a second, preview-only copy.
  engine.registerTag("doc", {
    parse(_token, remainingTokens) {
      while (remainingTokens.length) {
        const token = remainingTokens.shift() as { name?: string } | undefined;
        if (token?.name === "enddoc") return;
      }
      throw new Error("tag doc not closed");
    },
    render() {
      return "";
    },
  });
  // Shopify renders theme app blocks through this Online Store 2.0 tag.
  // LiquidJS does not implement it, so local previews intentionally leave the
  // slot empty while the uploaded draft renders the installed app block.
  engine.registerTag("content_for", {
    parse() {},
    render() {
      return "";
    },
  });
  engine.registerFilter("asset_url", (v: string) => "/assets/" + v);
  engine.registerFilter(
    "stylesheet_tag",
    (v: string) => `<link rel="stylesheet" href="${v}">`,
  );
  engine.registerFilter("json", (v: unknown) => JSON.stringify(v));
  const locale = await readJson<any>(
    join(out, "theme/locales/en.default.json"),
  );
  engine.registerFilter(
    "t",
    (key: string) =>
      key.split(".").reduce((v, part) => v?.[part], locale) || key,
  );
  engine.registerFilter(
    "money",
    (v: number) => "$" + (Number(v || 0) / 100).toFixed(2),
  );
  engine.registerFilter("date", (value: unknown, format: string) => {
    const parsed = new Date(String(value || ""));
    if (Number.isNaN(parsed.getTime())) return String(value || "");
    if (format === "%b %d, %Y")
      return parsed.toLocaleDateString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
        timeZone: "UTC",
      });
    if (format === "%B %d, %Y")
      return parsed.toLocaleDateString("en-US", {
        month: "long",
        day: "2-digit",
        year: "numeric",
        timeZone: "UTC",
      });
    return parsed.toISOString();
  });
  engine.registerFilter("image_url", (v: any) =>
    String(typeof v === "string" ? v : v?.src || v?.url || "").replace(/^\/\//, "https://"),
  );
  engine.registerFilter(
    "image_tag",
    (v: string, options: any = {}) =>
      `<img src="${v}" alt="${String(options.alt || "").replaceAll('"', "&quot;")}" loading="${options.loading || "lazy"}">`,
  );
  engine.registerFilter("default_pagination", () => "");
  engine.registerFilter("handleize", (value: unknown) => String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, ""));
  let layout = await readFile(join(out, "theme/layout/theme.liquid"), "utf8");
  for (const name of ["s2s-header", "s2s-footer"])
    layout = layout.replace(
      `{% render '${name}' %}`,
      await readFile(join(out, "theme/snippets", name + ".liquid"), "utf8"),
    );
  const hasCart = await stat(join(out, "theme/sections/s2s-cart.liquid")).then(
    () => true,
    () => false,
  );
  const phase3 = await readJson<any>(
    join(out, "phase3-content-plan.json"),
  ).catch(() => null);
  const phase3Products = (phase3?.records || []).filter(
    (record: any) => record.kind === "product" && record.status === "ready",
  );
  for (const record of phase3Products) {
    if (!record?.handle || !record.sourceSnapshot?.variants?.length) continue;
    const variants = record.sourceSnapshot.variants.map((variant: any) => ({
      ...variant,
      available: variant.available !== false,
    }));
    localProducts[record.handle] = {
      ...record.sourceSnapshot,
      variants,
      selected_or_first_available_variant: variants.find((variant: any) => variant.available) || variants[0],
    };
  }
  const samplePage = (phase3?.records || []).find(
    (record: any) => record.kind === "page" && record.status === "ready",
  );
  const collectionRecords = (phase3?.records || []).filter(
    (record: any) => record.kind === "collection" && record.status === "ready",
  );
  const sampleCollection = collectionRecords[0];
  const sampleStandardProduct = phase3Products[0];
  const productBinding = await readJson<any>(join(out, "phase3-product-template-binding.json")).catch(() => null);
  const productTemplatePlan = await readJson<any>(join(out, "phase3-product-template-plan.json")).catch(() => null);
  const selectedHandles = productHandles.length ? productHandles : (productTemplatePlan?.products || []).map((item: any) => item.handle);
  const familyPages = await Promise.all(selectedHandles.map(async (handle: string) => {
    const binding = productBinding?.products?.find((item: any) => item.handle === handle);
    const planned = productTemplatePlan?.products?.find((item: any) => item.handle === handle);
    const record = phase3Products.find((item: any) => item.handle === (planned?.sourceHandle || handle));
    if (!record || !binding?.templateSuffix) throw new Error(`Missing bound product preview: ${handle}`);
    const template = await readJson<any>(join(out, `theme/templates/product.${binding.templateSuffix}.json`));
    return {
      kind: "family-product", title: record.sourceSnapshot.title, url: `/products/${handle}`,
      sectionType: template.sections.main.type,
      sectionTypes: (template.order || Object.keys(template.sections || {})).map((id: string) => ({ id, type: template.sections[id]?.type })),
      record, binding, handle,
    };
  }));
  const sampleCustomProduct =
    phase3Products.find((record: any) =>
      /portrait|mug|blanket|pillow|necklace|ring|phone|crewneck|candle/i.test(
        record.handle,
      ),
    ) || phase3Products[1];
  const pagePlan = await readJson<any>(join(out, "phase3-page-plan.json")).catch(() => null);
  const editorialPlan = await readJson<any>(join(out, "phase4-editorial-plan.json")).catch(() => null);
  const plannedPages = (pagePlan?.pages || []).map((entry: any) => ({
    kind: "page", title: entry.input.title, url: `/pages/${entry.handle}`, previewPath: `pages/${entry.handle}.html`,
    pageRecord: { handle: entry.handle, title: entry.input.title, content: entry.input.body || "" },
  }));
  const firstImage = (html: string) => html?.match(/<img\b[^>]*\bsrc=["']([^"']+)/i)?.[1] || null;
  const plannedArticles = (editorialPlan?.articles || []).map((entry: any) => ({
    kind: "article", title: entry.input.title, url: `/blogs/${entry.blogHandle}/${entry.handle}`,
    previewPath: `blogs/${entry.blogHandle}/${entry.handle}.html`, articleRecord: entry,
  }));
  const plannedBlogs = (editorialPlan?.blogs || []).map((entry: any) => ({
    kind: "blog", title: entry.input.title, url: `/blogs/${entry.handle}`, previewPath: `blogs/${entry.handle}.html`, blogRecord: entry,
  }));
  const policyPages = (pagePlan?.pages || []).filter((entry: any) => ["privacy-policy", "terms-of-service", "shipping-policy", "refund-policy"].includes(entry.handle)).map((entry: any) => ({
    kind: "page", title: entry.input.title, url: `/policies/${entry.handle}`, previewPath: `policies/${entry.handle}.html`, pageType: "policy",
    pageRecord: { handle: entry.handle, title: entry.input.title, content: entry.input.body || "" },
  }));
  const pages = [
    ...familyPages,
    ...ir.pages,
    ...plannedPages,
    ...plannedBlogs,
    ...plannedArticles,
    ...policyPages,
    ...(hasCart ? [{ kind: "cart", title: "Your cart", url: "/cart" }] : []),
    ...(samplePage
      ? [
          {
            kind: "page",
            title: samplePage.sourceSnapshot.title,
            url: samplePage.path,
          },
        ]
      : []),
    ...collectionRecords.map((record: any) => ({
      kind: "collection",
      title: record.sourceSnapshot.title,
      url: record.path,
      handle: record.handle,
      collectionRecord: record,
    })),
    ...(sampleStandardProduct
      ? [
          {
            kind: "standard-product",
            title: sampleStandardProduct.sourceSnapshot.title,
            url: sampleStandardProduct.path,
          },
        ]
      : []),
    ...(sampleCustomProduct
      ? [
          {
            kind: "custom-product",
            title: sampleCustomProduct.sourceSnapshot.title,
            url: sampleCustomProduct.path,
          },
        ]
      : []),
  ];
  for (const page of pages) {
    const familyPage = familyPages.find(item => item === page);
    const currentPage = (page as any).pageRecord || (samplePage ? { handle: samplePage.handle, title: samplePage.sourceSnapshot.title, content: samplePage.sourceSnapshot.bodyHtml } : null);
    const currentBlogEntry = (page as any).blogRecord;
    const currentArticleEntry = (page as any).articleRecord;
    const currentBlogArticles = currentBlogEntry ? plannedArticles.filter((item: any) => item.articleRecord.blogHandle === currentBlogEntry.handle).map((item: any) => ({
      title: item.articleRecord.input.title, url: item.url, published_at: item.articleRecord.sourcePublishedAt || "",
      excerpt: item.articleRecord.input.summary || "", image: item.articleRecord.input.image || firstImage(item.articleRecord.input.body || ""),
    })) : [];
    const currentCollection = (page as any).collectionRecord || sampleCollection;
    const renderableSection = async (type: string, id?: string) => {
      if (type === "apps")
        return `<section class="shopify-section s2s-preview-review-section" data-preview-section-id="${id || "apps"}" style="padding:36px 0 80px"><div id="looxReviews" class="loox-widget" data-s2s-preview-provider-shell style="display:block;max-width:1280px;min-height:167px;margin:0 auto"></div></section>`;
      return (await readFile(join(out, `theme/sections/${type}.liquid`), "utf8"))
        .replace(/{% schema %}[\s\S]*?{% endschema %}/g, "")
        .replace(/s2s_preview_addons:\s*nil/g, "s2s_preview_addons: s2s_preview_addons")
        // LiquidJS can render all_products in isolation, but Shopify's
        // all_products drop is not reproduced reliably once a complete OS 2.0
        // section is embedded in the local layout. Bind the same captured
        // merchant products through an explicit preview-only object so local
        // evidence contains the real add-on ids, prices and availability.
        .replace(/all_products\['skip-the-line'\]/g, "s2s_preview_addons.skip_line")
        .replace(/all_products\['digital-download'\]/g, "s2s_preview_addons.digital_download")
        .replace(/all_products\['add-a-santa-hat'\]/g, "s2s_preview_addons.santa_hat")
        .replace(/all_products\['s2s-artwork-proof-checkbox'\]/g, "s2s_preview_addons.sleeve_name")
        .replace(/product\.collections\.first\.products/g, "s2s_preview_recommendations")
        .replace(/{% render 's2s-product-rating'[^%]*%}/g, '<span class="loox-rating" data-s2s-preview-provider-shell style="display:block;width:120px;height:19px"></span>')
        // App blocks are rendered by Shopify online. Local preflight preserves
        // their placement/binding shell without inventing merchant review data.
        .replace(/{% content_for 'blocks' %}/g, '<div class="loox-rating loox-widget" data-s2s-preview-provider-shell style="display:block;min-width:120px;min-height:20px"></div>');
    };
    let section = familyPage
      ? (await Promise.all(familyPage.sectionTypes.map((entry: any) => renderableSection(entry.type, entry.id)))).join("\n")
      : await renderableSection("s2s-" + page.kind);
    if (["standard-product", "custom-product", "family-product"].includes(page.kind))
      section = section
        .replace(/{% form 'product', product[^%]*%}/g, (tag) => {
          // Preserve the generator-owned form class. Replacing every product
          // form with s2s-family-form prevented family-specific runtimes (most
          // visibly the portrait stepper) from mounting in local preflight,
          // so local evidence did not represent the generated Shopify theme.
          const declared = tag.match(/class:\s*['"]([^'"]+)['"]/i)?.[1];
          const className = declared || (page.kind !== "standard-product" ? "s2s-family-form" : "");
          return `<form action="#"${className ? ` class="${className}"` : ""}>`;
        })
        .replace(/{% endform %}/g, "</form>");
    if (page.kind === "collection")
      section = section
        .replace(/{% paginate collection\.products by 48 %}/g, "")
        .replace(/{% endpaginate %}/g, "");
    if (page.kind === "blog")
      section = section
        .replace(/{% paginate blog\.articles by 24 %}/g, "")
        .replace(/{% endpaginate %}/g, "");
    const standardProduct = sampleStandardProduct?.sourceSnapshot;
    const customProduct = sampleCustomProduct?.sourceSnapshot;
    const previewProduct = familyPage?.record.sourceSnapshot || (page.kind === "custom-product" ? customProduct : standardProduct);
    const previewVariants = (previewProduct?.variants || []).map(
      (variant: any) => ({ ...variant, id: variant.id, available: variant.available }),
    );
    const previewOptions = (previewProduct?.options || []).map((option: any) => ({
      ...option,
      selected_value: option.values[0],
    }));
    const collectionHandles = new Set(
      currentCollection?.sourceSnapshot.productHandles || [],
    );
    const collectionProducts = [...collectionHandles]
      .map((handle) => phase3Products.find((record: any) => record.handle === handle))
      .filter(Boolean)
      .map((record: any, index: number) => ({
        id: `preview-collection-product-${index + 1}`,
        title: record.sourceSnapshot.title,
        url: record.path,
        featured_image: record.sourceSnapshot.images?.[0],
        price: Math.min(
          ...record.sourceSnapshot.variants.map(
            (variant: any) => variant.price,
          ),
        ),
        price_varies:
          new Set(
            record.sourceSnapshot.variants.map((variant: any) => variant.price),
          ).size > 1,
        compare_at_price_max: Math.max(
          0,
          ...record.sourceSnapshot.variants.map(
            (variant: any) => variant.compare_at_price || 0,
          ),
        ),
      }));
    const previewRecommendations = phase3Products.slice(0, 11).map((record: any, index: number) => ({
      id: `preview-recommendation-${index + 1}`,
      title: record.sourceSnapshot.title,
      url: record.path,
      featured_image: record.sourceSnapshot.images?.[0],
      price: Math.min(...record.sourceSnapshot.variants.map((variant: any) => variant.price)),
    }));
    let html = await engine.parseAndRender(
      layout.replace("{{ content_for_layout }}", section),
      {
        request: {
          locale: { iso_code: "en" },
          page_type: (page as any).pageType || (page.kind === "home" ? "index" : page.kind),
        },
        template: { suffix: "" },
        product:
          ["standard-product", "custom-product", "family-product"].includes(page.kind)
            ? {
                ...previewProduct,
                tags:
                  familyPage ? ["site2shop-family-" + familyPage.binding.family] : page.kind === "custom-product"
                    ? ["site2shop-family-portrait"]
                    : ["site2shop-family-standard"],
                options_with_values: previewOptions,
                variants: previewVariants,
                has_only_default_variant: previewVariants.length === 1
                  && previewOptions.length === 1
                  && previewOptions[0]?.values?.length === 1
                  && String(previewOptions[0].values[0]).toLowerCase() === "default title",
                selected_or_first_available_variant: previewVariants[0],
                available: previewVariants.some(
                  (variant: any) => variant.available,
                ),
              }
            : page.kind === "product"
              ? ir.product?.variants?.length
                ? {
                    ...ir.product,
                    selected_or_first_available_variant: ir.product.variants[0],
                  }
                : null
              : null,
        page: currentPage,
        blog: currentBlogEntry ? { title: currentBlogEntry.input.title, url: `/blogs/${currentBlogEntry.handle}`, articles: currentBlogArticles } : currentArticleEntry
          ? { title: editorialPlan.blogs.find((entry: any) => entry.handle === currentArticleEntry.blogHandle)?.input.title || currentArticleEntry.blogHandle, url: `/blogs/${currentArticleEntry.blogHandle}` } : null,
        article: currentArticleEntry ? { title: currentArticleEntry.input.title, content: currentArticleEntry.input.body || "", published_at: currentArticleEntry.sourcePublishedAt || "", author: currentArticleEntry.input.author?.name || "", image: currentArticleEntry.input.image || firstImage(currentArticleEntry.input.body || "") } : null,
        collection: currentCollection
          ? {
              title: currentCollection.sourceSnapshot.title,
              description: currentCollection.sourceSnapshot.descriptionHtml,
              products: collectionProducts,
            }
          : null,
        routes: { root_url: "/", cart_url: "/cart", cart_add_url: "/cart/add" },
        cart: {
          item_count: 0,
          "empty?": true,
          items: [],
          currency: { iso_code: "USD" },
        },
        all_products: localProducts,
        s2s_preview_addons: {
          skip_line: localProducts["skip-the-line"],
          digital_download: localProducts["digital-download"],
          santa_hat: localProducts["add-a-santa-hat"],
          sleeve_name: localProducts["s2s-artwork-proof-checkbox"],
        },
        s2s_preview_recommendations: previewRecommendations,
        section: { id: familyPage ? `preview-${familyPage.binding.templateSuffix}` : `preview-${page.kind}` },
        content_for_header: "",
        page_title: page.title,
        canonical_url: page.url,
      },
    );
    html = html.replace('"shopify":true', '"shopify":false');
    const previewPath = (page as any).previewPath || (familyPage
      ? "products/" + familyPage.handle + ".html"
      : page.kind === "collection" && (page as any).handle
        ? "collections/" + (page as any).handle + ".html"
        : page.kind + ".html");
    await write(join(out, "preview", previewPath), html);
  }
  await json(join(out, "preview/status.json"), {
    mode: "local-liquidjs-approximation",
    notShopifyRuntime: true,
    themeBuild: build.actual,
  });
}
export async function serve(out: string, port = 0) {
  const root = resolve(out);
  const platformRoutes = await readJson<Record<string,string>>(join(root, "preview/routes.json")).catch(() => null);
  const evidencePlan = await readJson<any>(join(out, "capture-plan.json")).catch(() => null);
  const targetOrigin = evidencePlan ? new URL(Object.values<any>(evidencePlan.routes)[0].target.url).origin : null;
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css",
    ".js": "text/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".mp4": "video/mp4",
  };
  const server = createServer(async (req, res) => {
    try {
      const u = new URL(req.url || "/", "http://localhost");
      const requestedPath = decodeURIComponent(u.pathname);
      let path = requestedPath;
      if (platformRoutes) {
        const mapped = platformRoutes[requestedPath + u.search] || platformRoutes[requestedPath];
        if (mapped) path = "/" + mapped;
        else if (path.startsWith("/assets/")) {const copy="/preview"+path;path=await stat(resolve(root,"."+copy)).then(s=>s.isFile()?copy:"/theme"+path,()=>"/theme"+path);}
        else { res.writeHead(404, { "Content-Type": "text/plain" }).end("Unmapped SHOPYY route"); return; }
      }
      else if (path === "/" || path === "/index.html")
        path =
          u.searchParams.get("view") === "s2s-product"
            ? "/preview/product.html"
            : u.searchParams.get("view") === "s2s-standard-product"
              ? "/preview/standard-product.html"
              : u.searchParams.get("view") === "s2s-custom-product"
                ? "/preview/custom-product.html"
              : "/preview/home.html";
      else if (path.startsWith("/products/")) path = "/preview/products/" + path.split("/").filter(Boolean).pop() + ".html";
      else if (path.startsWith("/pages/")) {
        const handle = path.split("/").filter(Boolean)[1];
        const specific = resolve(root, `preview/pages/${handle}.html`);
        path = await stat(specific).then(() => `/preview/pages/${handle}.html`, () => "/preview/page.html");
      }
      else if (path.startsWith("/collections/")) {
        const handle = path.split("/").filter(Boolean)[1];
        const specific = resolve(root, `preview/collections/${handle}.html`);
        path = await stat(specific).then(() => `/preview/collections/${handle}.html`, () => "/preview/collection.html");
      }
      else if (path.startsWith("/blogs/")) {
        const parts = path.split("/").filter(Boolean);
        const relative = parts.length > 2 ? `preview/blogs/${parts[1]}/${parts[2]}.html` : `preview/blogs/${parts[1]}.html`;
        const specific = resolve(root, relative);
        path = await stat(specific).then(() => `/${relative}`, () => "/preview/page.html");
      }
      else if (path.startsWith("/policies/")) {
        const handle = path.split("/").filter(Boolean)[1];
        const specific = resolve(root, `preview/policies/${handle}.html`);
        path = await stat(specific).then(() => `/preview/policies/${handle}.html`, () => "/preview/page.html");
      }
      else if (path === "/cart") path = "/preview/cart.html";
      else if (path.startsWith("/assets/")) path = "/theme" + path;
      const target = resolve(root, "." + path);
      if (target !== root && !target.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
      }
      const s = await stat(target);
      if (!s.isFile()) {
        res.writeHead(404).end();
        return;
      }
      const platformBuild = platformRoutes ? await (await import('./shopyy/artifacts.js')).buildIdentity(root) : null;
      res.writeHead(200, {
        "Content-Type": types[extname(target)] || "application/octet-stream",
        "Cache-Control": "no-store",
        ...(platformBuild ? { "X-Site2Shop-Build": platformBuild.id } : {}),
      });
      let body = await readFile(target);
      if (types[extname(target)]?.startsWith("text/html") && targetOrigin) {
        let html = body.toString("utf8");
        if (requestedPath.startsWith("/policies/"))
          html = html.replace(/s2s-page-type-page\b/g, "s2s-page-type-policy");
        const canonical = new URL(requestedPath || "/", targetOrigin).href;
        body = Buffer.from(html.replace(/<link\s+rel=["']canonical["'][^>]*>/i, `<link rel="canonical" href="${canonical}">`));
      }
      res.end(body);
    } catch {
      res
        .writeHead(404, { "Content-Type": "text/plain" })
        .end("Outside phase 1 capture scope");
    }
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const address = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${address.port}` };
}
