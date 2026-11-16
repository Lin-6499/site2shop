import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { capturePresentation, type PresentationLocator } from "../src/presentation-capture.js";
import { observePlannedState } from "../src/planned-capture.js";
import { BOX_FIELDS } from "../src/evidence-gate.js";

const mapping: PresentationLocator = { id: "reviews", selector: "#reviews", parent: { id: "main", selector: "main" }, previous: { id: "press", selector: "#press" }, next: { id: "footer", selector: "footer" } };
const html = `<style>
* { box-sizing:border-box } body { margin:0 } main { width:100%; padding:16px; }
#press,footer { height:30px; } #reviews { width:100%; padding:8px 12px; margin:10px 0 20px; display:grid; grid-template-columns:repeat(5,1fr); }
.review { height:60px } @media(max-width:1000px){ #reviews {grid-template-columns:repeat(3,1fr)} }
@media(max-width:500px){ #reviews {grid-template-columns:1fr} }
</style><main><div id=press>Press</div><section id=reviews><article class=review>A real measured test fixture</article></section><footer>Footer</footer></main>`;

test("browser observes widths, padding, placement and responsive topology at all three actual viewports", async () => {
  const browser = await chromium.launch({ headless: true, channel: "chromium" });
  try {
    for (const [width, height, tracks] of [[1920, 1080, "5"], [768, 1024, "3"], [390, 844, "1"]] as const) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      await page.setContent(html);
      const data = await capturePresentation(page, [mapping]);
      const box = data.boxes.reviews;
      assert.deepEqual(Object.keys(box).sort(), [...BOX_FIELDS].sort());
      assert.equal(box.widthPx, width - 32);
      assert.equal(box.paddingTopPx, 8);
      assert.equal(box.paddingRightPx, 12);
      assert.equal(box.gapBeforePx, 10);
      assert.equal(box.gapAfterPx, 20);
      assert.equal(box.topology.tracks, tracks);
      assert.deepEqual(box.placement, { parent: "main", previous: "press", next: "footer" });
      assert.equal(box.overflow.nativeScrollbarX, false);
      assert.deepEqual(data.presentationContext.cssViewport, { width, height });
      await page.close();
    }
  } finally { await browser.close(); }
});

test("missing/ambiguous selectors, false neighbors and absent fields cannot become zero-size successes", async () => {
  const browser = await chromium.launch({ headless: true, channel: "chromium" });
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    await assert.rejects(() => capturePresentation(page, [{ ...mapping, selector: "#missing" }]), /expected one element/);
    await assert.rejects(() => capturePresentation(page, [{ ...mapping, selector: "div,footer" }]), /expected one element/);
    await assert.rejects(() => capturePresentation(page, [{ ...mapping, previous: mapping.next }]), /anchor order mismatch/);
    const node: any = { components: ["reviews"], rules: [{ id: "missing", targetPointer: "/box/reviews/notCollected" }], capture: { target: { ready: { selector: "#reviews", state: "visible" }, components: { reviews: mapping } } } };
    const components = [{ id: "reviews", acceptance: { kind: "rendered", targetPointer: "/box/reviews" } }];
    await assert.rejects(() => observePlannedState(page, node, components, "target"), /collector cannot provide missing/);
  } finally { await browser.close(); }
});

test("native horizontal scrollbars and post-interaction layout changes are actually measured", async () => {
  const browser = await chromium.launch({ headless: true, channel: "chromium" });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent(html + `<button id=change onclick="document.querySelector('#reviews').style.paddingTop='48px'">Change</button>`);
    const before = await capturePresentation(page, [mapping]);
    await page.locator("#change").click();
    const after = await capturePresentation(page, [mapping]);
    assert.equal(after.boxes.reviews.paddingTopPx - before.boxes.reviews.paddingTopPx, 40);
    await page.addStyleTag({ content: "#reviews{display:block;overflow-x:scroll}.review{width:1000px}" });
    assert.equal((await capturePresentation(page, [mapping])).boxes.reviews.overflow.nativeScrollbarX, true);
    await page.addStyleTag({ content: "#reviews{scrollbar-width:none}#reviews::-webkit-scrollbar{display:none}" });
    assert.equal((await capturePresentation(page, [mapping])).boxes.reviews.overflow.nativeScrollbarX, false);
  } finally { await browser.close(); }
});
