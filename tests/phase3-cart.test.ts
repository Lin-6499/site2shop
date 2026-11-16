import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeCommerceTheme } from "../src/commerce-theme.js";

test("phase 3 commerce support emits a valid cart route and runtime assets", async () => {
  const out = await mkdtemp(join(tmpdir(), "s2s-phase3-cart-"));
  try {
    await writeCommerceTheme(out);
    const template = JSON.parse(await readFile(join(out, "theme/templates/cart.json"), "utf8"));
    const section = await readFile(join(out, "theme/sections/s2s-cart.liquid"), "utf8");
    const runtime = await readFile(join(out, "theme/assets/s2s-commerce.js"), "utf8");
    assert.equal(template.sections.main.type, "s2s-cart");
    assert.deepEqual(template.order, ["main"]);
    assert.match(section, /data-s2s-cart/);
    assert.match(section, /name="checkout"/);
    assert.match(section, /data-s2s-commerce-config/);
    assert.match(section, /s2s-commerce\.css/);
    assert.match(section, /s2s-commerce\.js/);
    assert.match(runtime, /data-s2s-cart/);
    assert.match(runtime, /\[data-s2s-commerce-config\]/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
