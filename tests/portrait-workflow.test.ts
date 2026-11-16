import test from "node:test";
import assert from "node:assert/strict";
import { buildPortraitSection, buildPortraitVariantMediaSnippet } from "../src/portrait-theme.js";
import { inferPortraitVariantMedia } from "../src/phase3-theme.js";

test("portrait workflow generator preserves per-product pet counts and instance properties", () => {
  const section = buildPortraitSection({
    schemaVersion: 1,
    products: {
      "custom-one-pet-portrait": {
        petCount: 1,
        variantMedia: { "101": 0, "102": 2 },
        frameSwatches: { black: 28, white: 29, walnut: 30, birch: 31 },
      },
      "custom-two-pet-portrait": { petCount: 2 },
      "custom-three-pet-portrait": { petCount: 3 },
      "custom-four-pet-portrait": { petCount: 4 },
    },
    addOns: [
      { handle: "s2s-artwork-proof-checkbox", label: "Artwork Preview", help: "Proof help", placement: "personalization" },
      { handle: "s2s-checkbox-skip-the-line", label: "Want your order sooner?", help: "Priority help", placement: "extras" },
    ],
  });

  for (const [handle, count] of [
    ["custom-one-pet-portrait", 1],
    ["custom-two-pet-portrait", 2],
    ["custom-three-pet-portrait", 3],
    ["custom-four-pet-portrait", 4],
  ] as const) {
    assert.match(section, new RegExp(`when '${handle}'\\n\\s+assign s2s_pet_count = ${count}`));
  }
  assert.match(section, /for s2s_pet_index in \(1\.\.s2s_pet_count\)/);
  assert.match(section, /properties\[\{\{ s2s_photo_property \| strip \| escape \}\}\]/);
  assert.match(section, /properties\[\{\{ s2s_name_property \| strip \| escape \}\}\]/);
  for (const step of [1, 2, 3, 4]) assert.match(section, new RegExp(`data-portrait-step="${step}"`));
  assert.match(section, /data-s2s-addon="s2s-artwork-proof-checkbox"/);
  assert.match(section, /data-s2s-addon="s2s-checkbox-skip-the-line"/);
  assert.match(section, /s2s-portrait-addon-\{\{ section\.id \}\}-s2s_artwork_proof_checkbox/);
  assert.match(section, /s2s-portrait-addon-\{\{ section\.id \}\}-s2s_checkbox_skip_the_line/);
  assert.doesNotMatch(section, /s2s-portrait-addon-\{\{ section\.id \}\}-0/);
  assert.match(section, /Artwork Preview/);
  assert.match(section, /Any Extras\?/);
  assert.doesNotMatch(section, /__S2S_PORTRAIT_/);
  assert.match(section, /name="properties\[\{\{ s2s_name_property \| strip \| escape \}\}\]" maxlength="40" autocomplete="off" required/);
  assert.match(section, /type="hidden" name="quantity" value="1"/);
  assert.doesNotMatch(section, /type="number" name="quantity"/);
  assert.match(section, /data-s2s-framing-mode/);
  assert.match(section, />Frame<\/label>/);
  assert.match(section, />No frame<\/label>/);
  assert.match(section, /data-s2s-frame-value/);
  assert.match(section, /Classic styles:/);
  assert.match(section, /Specialty styles:/);
  assert.match(section, /assign s2s_frame_black_image_position = 29/);
  assert.match(section, /assign s2s_frame_birch_image_position = 32/);
  assert.match(section, /render 's2s-portrait-frame-style'/);
  assert.match(section, /data-s2s-variant-media-map/);
  assert.match(section, /render 's2s-portrait-variant-media-map', product: product/);
  const mediaSnippet = buildPortraitVariantMediaSnippet({
    schemaVersion: 1,
    products: { "custom-one-pet-portrait": { petCount: 1, variantMedia: { "101": 0, "102": 2 } } },
  });
  assert.match(mediaSnippet, /\{"101":0,"102":2\}/);
  assert.match(section, /s2s-portrait-frame-swatch[^<]*\">\{% if swatch_image %\}\{\{ swatch_image/);
  assert.match(section, /value_handle == 'poster-only'/);
  assert.match(section, /data-s2s-frame-value="\{\{ value_handle \}\}"/);
  assert.doesNotMatch(section, /data-portrait-continue|data-portrait-step-two/);
});

test("phase 3 portrait media inference binds descriptive option values to imported gallery files", () => {
  const result = inferPortraitVariantMedia({
    files: [
      { originalSource: "https://cdn.example/products/softwhitewithdate-Black.png?v=1" },
      { originalSource: "https://cdn.example/products/Inlovingmemorysoftwhite-White.png?v=1" },
      { originalSource: "https://cdn.example/products/softwhite-posteronly.png?v=1" },
    ],
    variants: [
      { optionValues: [{ name: "Soft White" }, { name: '8\"x10\"' }, { name: "Black" }] },
      { optionValues: [{ name: "Soft White" }, { name: '12\"x16\"' }, { name: "White" }] },
      { optionValues: [{ name: "Soft White" }, { name: '18\"x24\"' }, { name: "Poster-Only" }] },
    ],
  });
  assert.deepEqual(result, {
    'Soft White\u001f8\"x10\"\u001fBlack': 0,
    'Soft White\u001f12\"x16\"\u001fWhite': 1,
    'Soft White\u001f18\"x24\"\u001fPoster-Only': 2,
  });
});
