import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import {
  haroldProductScript,
  haroldProductEnhancementScript,
  haroldStepScrollScript,
  haroldProductSections,
} from "../src/harold-product-theme.js";
import {
  familyVariantSyncScript,
  familyProductScript,
} from "../src/family-product-theme.js";

function workflow(total = 4, mobile = false) {
  const photo: any = { type: "file", files: [] };
  const status = { textContent: "" };
  const panels = Array.from({ length: total }, (_, index) => ({
    dataset: { s2sStep: String(index + 1) },
    hidden: index !== 0,
    querySelectorAll: () => (index === 2 ? [photo] : []),
  }));
  const listeners: Array<(event: any) => void> = [];
  const form = {
    querySelector: (selector: string) =>
      selector === "[data-s2s-status]"
        ? status
        : panels.find((p) => selector.includes(`="${p.dataset.s2sStep}"`)),
    querySelectorAll: (selector: string) =>
      selector === "[data-s2s-step]" ? panels : [],
    addEventListener: (_name: string, fn: (event: any) => void) =>
      listeners.push(fn),
  };
  let scrollCount = 0;
  const root = {
    dataset: { s2sTotalSteps: String(total), s2sCurrentStep: "1" },
    querySelector: (selector: string) =>
      selector === "form"
        ? form
        : {
            scrollIntoView() {
              scrollCount += 1;
            },
          },
    querySelectorAll: () => [],
  };
  const context = {
    document: { querySelectorAll: () => [root] },
    matchMedia: () => ({ matches: mobile }),
    requestAnimationFrame: (fn: () => void) => fn(),
  };
  const initialize = () =>
    runInNewContext(
      haroldProductScript + haroldProductEnhancementScript + haroldStepScrollScript,
      context,
    );
  initialize();
  return {
    root,
    photo,
    status,
    initialize,
    step: () => Number(root.dataset.s2sCurrentStep),
    visible: () =>
      panels.filter((p) => !p.hidden).map((p) => Number(p.dataset.s2sStep)),
    scrollCount: () => scrollCount,
    click(direction: "next" | "previous") {
      listeners.forEach((fn) =>
        fn({
          preventDefault() {},
          target: {
            closest: (selector: string) =>
              selector.includes(`[data-s2s-step-${direction}]`) ? {} : null,
          },
        }),
      );
    },
  };
}

test("Harold forward/back/forward uses one step state (regression: 1,2,1,3)", () => {
  const flow = workflow();
  for (const [action, expected] of [
    ["next", 2],
    ["previous", 1],
    ["next", 2],
    ["previous", 1],
    ["next", 2],
  ] as const) {
    flow.click(action);
    assert.equal(flow.step(), expected);
    assert.deepEqual(flow.visible(), [expected]);
  }
});

test("Harold step changes restore the information panel on desktop and mobile", () => {
  const desktop = workflow(4, false);
  desktop.click("next");
  assert.equal(desktop.scrollCount(), 1);

  const mobile = workflow(4, true);
  mobile.click("next");
  assert.equal(mobile.scrollCount(), 1);
  mobile.click("previous");
  assert.equal(mobile.scrollCount(), 2);
});

test("Harold back never skips upload guard and repeated initialization does not double-advance", () => {
  const flow = workflow();
  flow.initialize();
  flow.click("next");
  flow.click("next");
  assert.equal(flow.step(), 3);
  flow.click("next");
  assert.equal(flow.step(), 3);
  assert.match(flow.status.textContent, /Choose a JPG/);
  flow.click("previous");
  assert.equal(flow.step(), 2);
  flow.click("next");
  assert.equal(flow.step(), 3);
  flow.photo.files = [{ type: "image/png", size: 100 }];
  flow.click("next");
  assert.equal(flow.step(), 4);
  flow.click("previous");
  flow.click("next");
  assert.equal(flow.step(), 4);
  assert.equal(flow.photo.files.length, 1);
});

test("Harold house template preserves source component contracts in generator output", () => {
  const section = haroldProductSections["s2s-harold-house-product"];
  assert.match(section, /s2s-harold-image-option--style/);
  assert.match(section, /s2s-5a840ef9507bc2f0\.jpeg' \| asset_url/);
  assert.match(section, /s2s-harold-image-option--size/);
  assert.match(section, /s2s-7d0ce3eaf2357136\.jpg' \| asset_url/);
  assert.match(section, /s2s-b8d4f1d4600d10a1\.png' \| asset_url/);
  assert.doesNotMatch(
    section,
    /haroldhome\.co\/cdn\/shop\/(?:files|t\/53\/assets)\/swatch-/,
    "replicated swatches must use packaged theme assets instead of source hotlinks",
  );
  assert.match(section, /Classic styles:/);
  assert.match(section, /Specialty styles:/);
  assert.match(section, /s2s-harold-frame-card/);
  assert.match(section, /Subtotal: <span data-s2s-subtotal>/);
  assert.match(section, /Artwork Ready in 1-2 Days/);
  assert.match(section, /\{\{ form \| payment_terms \}\}/);
  assert.match(section, /Free proofs\. Preview your artwork in 1-3 days/);
  assert.match(section, /Unlimited revisions/);
  assert.match(section, /Any notes for the artist\?/);
  assert.doesNotMatch(
    section,
    /s2s-harold-intro/,
    "the source house workflow does not render a product-description block above its steps",
  );
  assert.equal(
    (section.match(/data-s2s-option-group=/g) || []).length,
    3,
    "each Shopify option must contribute exactly one variant-matching group",
  );
  assert.doesNotMatch(
    section,
    /data-s2s-frame-values[^>]*data-s2s-option-group/,
    "visual frame subgroups must not become extra Shopify options",
  );
  assert.match(
    familyVariantSyncScript,
    /not\(\[name=\"form-option-framing-swicher\"\]\)/,
  );
  assert.match(
    familyProductScript,
    /not\(\[name=\"form-option-framing-swicher\"\]\)/,
  );
  assert.match(section, /type="file"[^>]*required data-s2s-required-photo/);
  const stageEnd = section.indexOf(
    '</div>\n    <div class="s2s-harold-thumb-nav">',
  );
  const previousArrow = section.indexOf("data-family-previous");
  const thumbViewport = section.indexOf("data-family-thumbs-viewport");
  assert.ok(
    stageEnd >= 0 && previousArrow > stageEnd && previousArrow < thumbViewport,
    "gallery arrows must belong to the thumbnail navigation, not the main image stage",
  );
});
