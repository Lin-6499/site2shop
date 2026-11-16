import assert from "node:assert/strict";
import test from "node:test";
import { localPreviewUrlForTarget } from "../src/target-preview-url.js";

test("draft product navigation keeps preview_key on local theme-dev URLs", () => {
  const result = localPreviewUrlForTarget(
    "http://127.0.0.1:9292",
    "https://example.myshopify.com/products/sample",
    {
      sample: "https://example.myshopify.com/products/sample?preview_key=abc123&preview_theme_id=999",
    },
  );

  assert.equal(result, "http://127.0.0.1:9292/products/sample?preview_key=abc123");
});

test("non-product routes and products without preview keys remain clean", () => {
  assert.equal(
    localPreviewUrlForTarget(
      "http://127.0.0.1:9292",
      "https://example.myshopify.com/pages/about",
      {},
    ),
    "http://127.0.0.1:9292/pages/about",
  );
  assert.equal(
    localPreviewUrlForTarget(
      "http://127.0.0.1:9292",
      "https://example.myshopify.com/products/sample",
      {},
    ),
    "http://127.0.0.1:9292/products/sample",
  );
});
