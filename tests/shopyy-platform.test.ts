import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildPlatform, listPlatformAdapters } from "../src/platform.js";
import { registerBuiltInPlatforms } from "../src/platforms/index.js";

const here = dirname(fileURLToPath(import.meta.url));
// Frozen legacy prototype input: active schema 2 projects must not fall back to this path.
const projectFile = resolve(here, "../../voidresearch-shopyy/shopyy.project.legacy-v1.json");

test("SHOPYY legacy prototype adapter remains deterministic without bypassing the active schema 2 workflow", async () => {
  registerBuiltInPlatforms();
  assert.deepEqual(listPlatformAdapters(), [{ id: "shopyy", version: "0.2.0" }]);
  const output = await mkdtemp(join(tmpdir(), "site2shop-shopyy-"));
  try {
    const first = await buildPlatform("shopyy", { projectFile, outputDirectory: output, prototype: true });
    const firstManifest = JSON.parse(await readFile(first.manifestFile, "utf8"));
    const home = await readFile(join(output, "theme/common/index_default.htm"), "utf8");
    const previewHome = await readFile(join(output, "preview/home.html"), "utf8");
    const previewProduct = await readFile(join(output, "preview/products/glp-3-rt.html"), "utf8");
    assert.match(home, /<\{foreach from=\$goods_list item=vo\}>/);
    assert.match(home, /Fill the Void in your research/);
    assert.doesNotMatch(home, /\{[{%]/, "SHOPYY output must not contain Shopify Liquid tags");
    assert.equal(firstManifest.release.status, "blocked");
    assert.equal(firstManifest.preview.mode, "shared-renderer-fixture");
    assert.equal(firstManifest.prototype, true);
    assert.match(previewHome, /href="\/Products\/list-r1.html"/);
    assert.match(previewProduct, /data-vr-add-to-cart="glp-3-rt"/);
    assert.ok(first.files.includes("common/index.htm"));
    assert.ok(first.files.includes("product/detail.htm"));
    assert.ok(first.files.includes("assets/voidresearch/styles/storefront-common.css"));

    const second = await buildPlatform("shopyy", { projectFile, outputDirectory: output, prototype: true });
    assert.equal(second.buildId, first.buildId);
    const secondManifest = JSON.parse(await readFile(second.manifestFile, "utf8"));
    assert.equal(secondManifest.package.sha256, firstManifest.package.sha256, "ZIP bytes must be deterministic");
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
