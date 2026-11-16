import test from "node:test";
import assert from "node:assert/strict";
import { requireSourceScreenshot } from "../src/verify.js";

test("verification rejects a missing required viewport as invalid evidence before image processing", () => {
  assert.equal(
    requireSourceScreenshot({ "1920": "capture/home-1920.png" }, "home", 1920),
    "capture/home-1920.png",
  );
  assert.throws(
    () => requireSourceScreenshot({ "1440": "capture/home-1440.png" }, "home", 1920),
    /SOURCE_SCREENSHOT_MISSING: home has no 1920px baseline/,
  );
});
