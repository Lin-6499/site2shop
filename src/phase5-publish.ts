import { join } from "node:path";
import { execute, validateStore } from "./catalog.js";
import { json, readJson } from "./util.js";
import { assertProductFamilyContracts } from "./product-family-contracts.js";
import { assertGeneratedThemeIntegrity } from "./theme-integrity.js";
import { assertReleaseApproval } from "./release-approval.js";
import { assertReviewSystemViewportCoverage, assertVisualAuditPassed } from "./product-family-evidence.js";
import { assertReviewedReleaseEvidence } from "./reviewed-release-evidence.js";

const BATCH_SIZE = 10;

const batches = <T>(items: T[]) => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += BATCH_SIZE)
    result.push(items.slice(index, index + BATCH_SIZE));
  return result;
};

const padded = <T>(items: T[]) => {
  if (!items.length) throw new Error("Cannot pad an empty publication batch.");
  const result = [...items];
  while (result.length < BATCH_SIZE) result.push(result[result.length - 1]);
  return result;
};

export async function publishPhase5(out: string, store: string) {
  validateStore(store);
  await assertReviewedReleaseEvidence(out, "online", true);
  await assertGeneratedThemeIntegrity(out);
  await assertProductFamilyContracts(out);
  await assertReviewSystemViewportCoverage(out);
  await assertVisualAuditPassed(out);
  await assertReleaseApproval(out);
  const [products, pages, collections, editorial] = await Promise.all([
    readJson<any>(join(out, "phase3-product-binding.json")),
    readJson<any>(join(out, "phase3-page-binding.json")),
    readJson<any>(join(out, "phase4-collection-binding.json")),
    readJson<any>(join(out, "phase4-editorial-binding.json")),
  ]);
  if (![products, pages, collections, editorial].every((item) => item.completed))
    throw new Error("All Phase 3 and Phase 4 bindings must be complete before publishing.");
  if ([products, pages, collections, editorial].some((item) => item.store !== store))
    throw new Error("A binding belongs to a different Shopify store.");

  const context = await execute(store, "context");
  const onlineStores = context.publications.nodes.filter((publication: any) =>
    ["Online Store", "在线商店"].includes(publication.name),
  );
  if (onlineStores.length !== 1)
    throw new Error("Cannot unambiguously identify the Online Store publication.");
  const publicationId = onlineStores[0].id;
  const file = join(out, "phase5-publication-binding.json");
  const previous = await readJson<any>(file).catch(() => null);
  if (previous && (previous.store !== store || previous.publicationId !== publicationId))
    throw new Error("The existing publication checkpoint belongs to another target.");
  const binding: any = previous || {
    schemaVersion: 1,
    store,
    publicationId,
    startedAt: new Date().toISOString(),
    products: [],
    collections: [],
    pages: [],
    articles: [],
    deferred: [
      {
        type: "Product",
        handle: "gift-card",
        reason: "Native Shopify gift-card capability is not configured.",
      },
    ],
    resourcesCompleted: false,
    verified: false,
  };
  const save = async () => await json(file, binding);

  const publishProducts = products.products.filter(
    (product: any) =>
      product.handle !== "gift-card" &&
      !binding.products.some((done: any) => done.id === product.id),
  );
  for (const group of batches(publishProducts)) {
    const full = padded(group);
    const variables: any = { publication: [{ publicationId }] };
    full.forEach((product: any, index) => {
      variables[`id${index}`] = product.id;
      variables[`product${index}`] = { id: product.id, status: "ACTIVE" };
    });
    const result = await execute(
      store,
      "phase5-product-publish-batch",
      variables,
      true,
    );
    for (let index = 0; index < group.length; index++)
      binding.products.push({
        id: (group[index] as any).id,
        handle: (group[index] as any).handle,
        status: result[`update${index}`].product.status,
        published: true,
      });
    await save();
  }

  const publishCollections = collections.collections.filter(
    (collection: any) =>
      !binding.collections.some((done: any) => done.id === collection.id),
  );
  for (const group of batches(publishCollections)) {
    const full = padded(group);
    const variables: any = { publication: [{ publicationId }] };
    full.forEach((collection: any, index) => {
      variables[`id${index}`] = collection.id;
    });
    await execute(
      store,
      "phase5-collection-publish-batch",
      variables,
      true,
    );
    binding.collections.push(
      ...group.map((collection: any) => ({
        id: collection.id,
        handle: collection.handle,
        published: true,
      })),
    );
    await save();
  }

  const publishPages = pages.pages.filter(
    (page: any) => !binding.pages.some((done: any) => done.id === page.id),
  );
  for (const group of batches(publishPages)) {
    const full = padded(group);
    const variables: any = {};
    full.forEach((page: any, index) => {
      variables[`id${index}`] = page.id;
    });
    const result = await execute(store, "phase5-page-publish-batch", variables, true);
    for (let index = 0; index < group.length; index++)
      binding.pages.push({
        id: (group[index] as any).id,
        handle: (group[index] as any).handle,
        isPublished: result[`publish${index}`].page.isPublished,
      });
    await save();
  }

  const publishArticles = editorial.articles.filter(
    (article: any) => !binding.articles.some((done: any) => done.id === article.id),
  );
  for (const group of batches(publishArticles)) {
    const full = padded(group);
    const variables: any = {};
    full.forEach((article: any, index) => {
      variables[`id${index}`] = article.id;
    });
    const result = await execute(
      store,
      "phase5-article-publish-batch",
      variables,
      true,
    );
    for (let index = 0; index < group.length; index++)
      binding.articles.push({
        id: (group[index] as any).id,
        handle: (group[index] as any).handle,
        isPublished: result[`publish${index}`].article.isPublished,
      });
    await save();
  }

  binding.resourcesCompleted = true;
  binding.resourcesCompletedAt = new Date().toISOString();

  const ids = [
    ...binding.products.map((item: any) => item.id),
    ...binding.collections.map((item: any) => item.id),
    ...binding.pages.map((item: any) => item.id),
    ...binding.articles.map((item: any) => item.id),
  ];
  const nodes: any[] = [];
  for (let index = 0; index < ids.length; index += 200) {
    const result = await execute(store, "phase5-verify", {
      ids: ids.slice(index, index + 200),
      publicationId,
    });
    nodes.push(...result.nodes);
  }
  const failed = nodes.filter((node: any) => {
    if (node.__typename === "Product")
      return node.status !== "ACTIVE" || !node.publishedOnPublication;
    if (node.__typename === "Collection") return !node.publishedOnPublication;
    if (node.__typename === "Page" || node.__typename === "Article")
      return !node.isPublished;
    return true;
  });
  if (nodes.length !== ids.length || failed.length)
    throw new Error(
      `Publication verification failed for ${failed.length || ids.length - nodes.length} resource(s).`,
    );
  binding.verified = true;
  binding.verifiedAt = new Date().toISOString();
  binding.counts = {
    products: binding.products.length,
    collections: binding.collections.length,
    pages: binding.pages.length,
    articles: binding.articles.length,
    deferred: binding.deferred.length,
  };
  await save();
  return binding;
}
