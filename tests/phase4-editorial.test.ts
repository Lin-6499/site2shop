import assert from "node:assert/strict";
import test from "node:test";
import { normalizeArticleContent } from "../src/phase4-store.js";

test("article normalization separates the featured image and portable body", () => {
  const result = normalizeArticleContent(`
    <article>
      <div class="hero"><img class="article-img" src="https://cdn.example/hero.jpg" alt="Hero alt"></div>
      <h1>Do not duplicate this title</h1>
      <p class="article-meta">Victoria Example @ Oct 07, 2025</p>
      <div class="article-content"><p>Portable story body.</p><script>alert(1)</script></div>
    </article>`, "Fallback title");

  assert.deepEqual(result.image, {
    url: "https://cdn.example/hero.jpg",
    altText: "Hero alt",
  });
  assert.equal(result.authorName, "Victoria Example");
  assert.equal(result.body, "<p>Portable story body.</p>");
  assert.doesNotMatch(result.body, /<h1|article-img|script/i);
});
