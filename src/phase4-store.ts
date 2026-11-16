import { join } from "node:path";
import { load } from "cheerio";
import { execute, validateStore } from "./catalog.js";
import { safePageBody } from "./phase3-store.js";
import { json, readJson } from "./util.js";

type ContentRecord = {
  kind: string;
  handle: string;
  path: string;
  status: string;
  fingerprint?: string;
  sourceSnapshot?: any;
};

const readContent = async (out: string) =>
  await readJson<{ records: ContentRecord[] }>(
    join(out, "phase4-content-localized.json"),
  ).catch(() =>
    readJson<{ records: ContentRecord[] }>(join(out, "phase3-content-plan.json")),
  );

export function normalizeArticleContent(input: string, fallbackTitle: string) {
  const $ = load(input || "", null, false);
  const hero = $("img.article-img").first().length
    ? $("img.article-img").first()
    : $("article img").first();
  const content = $(".article-content").first();
  const metaText = $(".article-meta").first().text().trim();
  const authorName = metaText.split("@")[0]?.trim() || "West & Willow";
  const body = content.length ? content.html() || "" : input;
  const url = hero.attr("src") || hero.attr("data-src") || "";
  const altText = hero.attr("alt") || fallbackTitle;
  return {
    body: safePageBody(body),
    image: url ? { url, altText } : undefined,
    authorName,
  };
}

export async function planPhase4Collections(out: string) {
  const content = await readContent(out);
  const products = await readJson<any>(
    join(out, "phase3-product-binding.json"),
  ).catch(() => null);
  const productIds = new Map(
    (products?.products || []).map((product: any) => [product.handle, product.id]),
  );
  const productPlan = await readJson<any>(join(out, 'phase3-product-plan.json')).catch(()=>({products:[]}));
  for(const product of productPlan.products || [])
    if(product.sourceHandle && productIds.has(product.handle)) productIds.set(product.sourceHandle, productIds.get(product.handle));
  const aliases:Record<string,string>=await readJson<Record<string,string>>(join(out,'collection-handle-overrides.json')).catch(()=>({}));
  const sourceOrigin=new URL((await readJson<any>(join(out,'site-ir.json'))).sourceUrl).origin;
  const operationalProductHandles = new Set([
    "gift-card",
    "onward-package-protection",
    "embroidery-pet-name",
    "international-shipping-charge",
    "us-shipping-charge",
  ]);
  const collections = content.records
    .filter((record) => record.kind === "collection" && record.status === "ready")
    .map((record) => {
      const handles: string[] = record.sourceSnapshot.productHandles || [];
      const skippedOperationalProductHandles = handles.filter(
        (handle) => operationalProductHandles.has(handle) && !productIds.has(handle),
      );
      const missingProductHandles = handles.filter(
        (handle) => !productIds.has(handle) && !operationalProductHandles.has(handle),
      );
      return {
        sourceHandle: record.handle,
        handle: aliases[record.handle] || record.handle,
        fingerprint: record.fingerprint,
        productHandles: handles,
        skippedOperationalProductHandles,
        missingProductHandles,
        input: {
          title: record.sourceSnapshot.title || record.handle,
          handle: aliases[record.handle] || record.handle,
          descriptionHtml: safePageBody(
            record.sourceSnapshot.descriptionHtml || "",
          ),
          sortOrder: "MANUAL",
          products: handles
            .map((handle) => productIds.get(handle))
            .filter(Boolean),
          metafields: [
            {namespace:'site2shop',key:'source_identity',type:'single_line_text_field',value:sourceOrigin+'/collections/'+record.handle},
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
    generatedAt: new Date().toISOString(),
    mode: "manual-collections-no-publication",
    collections,
    counts: {
      collections: collections.length,
      memberships: collections.reduce(
        (sum, collection) => sum + collection.productHandles.length,
        0,
      ),
      boundMemberships: collections.reduce(
        (sum, collection) => sum + collection.input.products.length,
        0,
      ),
      skippedOperationalMemberships: collections.reduce(
        (sum, collection) =>
          sum + collection.skippedOperationalProductHandles.length,
        0,
      ),
      missingMemberships: collections.reduce(
        (sum, collection) => sum + collection.missingProductHandles.length,
        0,
      ),
    },
  };
  await json(join(out, "phase4-collection-plan.json"), plan);
  return plan;
}

export async function planPhase4Editorial(out: string) {
  const content = await readContent(out);
  const blogs = content.records
    .filter((record) => record.kind === "blog" && record.status === "ready")
    .map((record) => ({
      handle: record.handle,
      fingerprint: record.fingerprint,
      input: {
        title: record.sourceSnapshot.title || record.handle,
        handle: record.handle,
        commentPolicy: "CLOSED",
        metafields: [
          {
            namespace: "site2shop",
            key: "source_fingerprint",
            type: "single_line_text_field",
            value: record.fingerprint,
          },
        ],
      },
    }));
  const articles = content.records
    .filter((record) => record.kind === "article" && record.status === "ready")
    .map((record) => {
      const title = record.sourceSnapshot.title || record.handle;
      const normalized = normalizeArticleContent(record.sourceSnapshot.bodyHtml || "", title);
      return {
        handle: record.handle,
        blogHandle: record.sourceSnapshot.blogHandle,
        fingerprint: record.fingerprint,
        sourcePublishedAt: record.sourceSnapshot.publishedAt || null,
        input: {
          title,
          handle: record.handle,
          author: { name: normalized.authorName },
          body: normalized.body,
          summary: safePageBody(record.sourceSnapshot.summaryHtml || ""),
          ...(normalized.image ? { image: normalized.image } : {}),
          isPublished: false,
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
    })
    .sort((left, right) => {
      const blogOrder = String(left.blogHandle).localeCompare(String(right.blogHandle));
      if (blogOrder) return blogOrder;
      return String(right.sourcePublishedAt || "").localeCompare(
        String(left.sourcePublishedAt || ""),
      );
    });
  const plan = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "unpublished-editorial-no-overwrite",
    blogs,
    articles,
    counts: { blogs: blogs.length, articles: articles.length },
  };
  await json(join(out, "phase4-editorial-plan.json"), plan);
  return plan;
}

export async function auditPhase4(out: string, store: string) {
  validateStore(store);
  const target = await execute(store, "phase4-audit");
  if (target.collections.pageInfo.hasNextPage || target.blogs.pageInfo.hasNextPage)
    throw new Error("Phase 4 audit exceeded a safe top-level page limit.");
  if (target.blogs.nodes.some((blog: any) => blog.articles.pageInfo.hasNextPage))
    throw new Error("A target blog exceeds 250 articles; cursor audit is required.");
  const result = {
    schemaVersion: 1,
    store,
    auditedAt: new Date().toISOString(),
    mode: "read-only",
    writesPerformed: false,
    collections: target.collections.nodes,
    blogs: target.blogs.nodes,
  };
  await json(join(out, "phase4-target-audit.json"), result);
  return result;
}

export async function syncPhase4Collections(out: string, store: string) {
  validateStore(store);
  const plan = await planPhase4Collections(out);
  if (plan.counts.missingMemberships)
    throw new Error(
      `${plan.counts.missingMemberships} collection memberships reference products that are not bound.`,
    );
  const audit = await auditPhase4(out, store);
  const conflicts = plan.collections.filter((collection) => {
    const existing = audit.collections.find(
      (item: any) => item.handle === collection.handle,
    );
    const reusableSite2ShopCollection = existing?.metafield?.value === collection.fingerprint;
    return (
      existing &&
      !reusableSite2ShopCollection &&
      existing.metafield?.value !== collection.fingerprint
    );
  });
  if (conflicts.length)
    throw new Error(
      `Refusing to overwrite ${conflicts.length} collection handle(s): ${conflicts.map((item) => item.handle).join(", ")}`,
    );
  const binding: any = {
    schemaVersion: 1,
    store,
    syncedAt: new Date().toISOString(),
    mode: "manual-collections-no-publication",
    collections: [],
    completed: false,
  };
  for (const collection of plan.collections) {
    const existing = audit.collections.find(
      (item: any) => item.handle === collection.handle,
    );
    const target = existing
      ? existing
      : (await execute(
          store,
          "phase4-collection-create",
          { input: collection.input },
          true,
        )).collectionCreate.collection;
    const actual=(await execute(store,'baseline-collection-readback',{id:target.id})).collection;
    if(!actual||actual.handle!==collection.handle||actual.products.pageInfo.hasNextPage||
       actual.products.nodes.map((p:any)=>p.id).join('|')!==collection.input.products.join('|'))
      throw new Error(`Collection membership/order readback differs from source contract: ${collection.handle}`);
    binding.collections.push({
      ...target,
      sourceHandle: collection.sourceHandle,
      productCount: actual.products.nodes.length,
      verifiedProductIds: actual.products.nodes.map((p:any)=>p.id),
      action:
        existing?.handle === "frontpage" && !existing.metafield?.value
          ? "reused-system-frontpage"
          : existing
            ? "reused"
            : "created",
    });
    await json(join(out, "phase4-collection-binding.json"), binding);
  }
  binding.completed = true;
  await json(join(out, "phase4-collection-binding.json"), binding);
  return binding;
}

export async function exposePhase4Collections(out: string, store: string) {
  validateStore(store);
  const binding = await readJson<any>(join(out, "phase4-collection-binding.json"));
  if (!binding.completed || binding.store !== store)
    throw new Error("A completed Phase 4 collection binding for this store is required.");
  const context = await execute(store, "context");
  const onlineStores = context.publications.nodes.filter((publication: any) =>
    ["Online Store", "在线商店"].includes(publication.name),
  );
  if (onlineStores.length !== 1)
    throw new Error("Cannot unambiguously identify the Online Store publication.");
  const publicationId = onlineStores[0].id;
  const pending = binding.collections.filter((collection: any) => collection.action === "created");
  const published: any[] = [];
  for (let offset = 0; offset < pending.length; offset += 10) {
    const group = pending.slice(offset, offset + 10);
    const full = [...group];
    while (full.length < 10) full.push(full[full.length - 1]);
    const variables: any = { publication: [{ publicationId }] };
    full.forEach((collection: any, index: number) => {
      variables[`id${index}`] = collection.id;
    });
    await execute(store, "phase5-collection-publish-batch", variables, true);
    published.push(...group.map((collection: any) => ({
      id: collection.id,
      handle: collection.handle,
      published: true,
    })));
  }
  const result = {
    schemaVersion: 1,
    store,
    publicationId,
    exposedAt: new Date().toISOString(),
    scope: "newly-created-phase4-collections-only",
    collections: published,
  };
  await json(join(out, "phase4-collection-exposure.json"), result);
  return result;
}

export async function syncPhase4Editorial(out: string, store: string) {
  validateStore(store);
  const plan = await planPhase4Editorial(out);
  const audit = await auditPhase4(out, store);
  const blogConflicts = plan.blogs.filter((blog) => {
    const existing = audit.blogs.find((item: any) => item.handle === blog.handle);
    return existing && existing.metafield?.value !== blog.fingerprint;
  });
  const articleConflicts = plan.articles.filter((article) => {
    const blog = audit.blogs.find((item: any) => item.handle === article.blogHandle);
    const existing = blog?.articles.nodes.find(
      (item: any) => item.handle === article.handle,
    );
    return existing && existing.metafield?.value !== article.fingerprint;
  });
  if (blogConflicts.length || articleConflicts.length)
    throw new Error(
      `Refusing to overwrite editorial conflicts: ${[
        ...blogConflicts.map((item) => `blog:${item.handle}`),
        ...articleConflicts.map((item) => `article:${item.handle}`),
      ].join(", ")}`,
    );
  const binding: any = {
    schemaVersion: 1,
    store,
    syncedAt: new Date().toISOString(),
    mode: "unpublished-editorial-no-overwrite",
    blogs: [],
    articles: [],
    completed: false,
  };
  for (const blog of plan.blogs) {
    const existing = audit.blogs.find((item: any) => item.handle === blog.handle);
    const target = existing
      ? existing
      : (await execute(store, "phase4-blog-create", { blog: blog.input }, true))
          .blogCreate.blog;
    binding.blogs.push({ ...target, action: existing ? "reused" : "created" });
    await json(join(out, "phase4-editorial-binding.json"), binding);
  }
  const blogIds = new Map(binding.blogs.map((blog: any) => [blog.handle, blog.id]));
  for (const article of plan.articles) {
    const blog = audit.blogs.find((item: any) => item.handle === article.blogHandle);
    const existing = blog?.articles.nodes.find(
      (item: any) => item.handle === article.handle,
    );
    const blogId = blogIds.get(article.blogHandle);
    if (!blogId) throw new Error(`Missing target blog ${article.blogHandle}.`);
    const target = existing
      ? existing
      : (await execute(
          store,
          "phase4-article-create",
          { article: { ...article.input, blogId } },
          true,
        )).articleCreate.article;
    binding.articles.push({
      ...target,
      blogHandle: article.blogHandle,
      action: existing ? "reused" : "created",
    });
    await json(join(out, "phase4-editorial-binding.json"), binding);
  }
  binding.completed = true;
  await json(join(out, "phase4-editorial-binding.json"), binding);
  return binding;
}
