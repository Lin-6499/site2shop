import test from "node:test";
import assert from "node:assert/strict";
import { Liquid } from "liquidjs";
import { load } from "cheerio";
import { haroldProductSections } from "../src/harold-product-theme.js";
import { repairStateProductSection } from "../src/harold-state-product-repair.js";

test("state-product repair does not change other family sections", () => {
  const original = "<section>unchanged</section>";
  for (const marker of ["harold-house", "harold-print", "harold-digital", "harold-house-mug"])
    assert.equal(repairStateProductSection(original, marker), original);
});

test("hat option media retains White/Black meaning when gallery order changes", async () => {
  const section = haroldProductSections["s2s-harold-hat-product"];
  const option = section.match(/<fieldset class="s2s-harold-option s2s-harold-image-option[\s\S]*?<\/fieldset>/)?.[0];
  assert.ok(option);
  const engine = new Liquid();
  engine.registerFilter("handleize", value => String(value).toLowerCase());
  engine.registerFilter("image_url", image => image.src);
  engine.registerFilter("image_tag", url => `<img src="${url}">`);
  for (const images of [
    [{ src: "/lifestyle.png" }, { src: "/hat-white-front-proof.png" }, { src: "/hat-black-front-proof.png" }],
    [{ src: "/hat-black-front-proof.png" }, { src: "/lifestyle.png" }, { src: "/hat-white-front-proof.png" }],
  ]) {
    const html = await engine.parseAndRender(option, { product: { images }, option: { values: ["White", "Black"], selected_value: "White" }, section: { id: "test" } });
    const dom = load(html);
    assert.equal(dom('label[aria-label="White"] img').attr("src"), "/hat-white-front-proof.png");
    assert.equal(dom('label[aria-label="Black"] img').attr("src"), "/hat-black-front-proof.png");
  }
});

test("support content uses target payment and policy data, never source delivery dates", () => {
  for (const key of ["s2s-harold-hat-product", "s2s-harold-wine-glass-product"]) {
    const section = haroldProductSections[key];
    assert.match(section, /shop\.enabled_payment_types/);
    assert.match(section, /shop\.shipping_policy\.url/);
    assert.match(section, /shop\.url \| append: product\.url \| url_encode/);
    assert.doesNotMatch(section, /haroldhome\.co|Nov \d|Singapore/);
  }
});
