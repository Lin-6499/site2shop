import { join, resolve } from "node:path";
import { captureNavigationCoverage } from "../src/planned-capture.js";
import { loadEvidencePlan } from "../src/evidence-gate.js";
import { json, readJson } from "../src/util.js";

const [outArg] = process.argv.slice(2);
if (!outArg) throw new Error("Usage: capture-online-navigation <output>");
const out = resolve(outArg);
const [{ plan, planSha256 }, build, deployment, coverage] = await Promise.all([
  loadEvidencePlan(out),
  readJson<any>(join(out, "theme-build.json")),
  readJson<any>(join(out, "deployment.json")),
  readJson<any>(join(out, "online-coverage.json")),
]);
if (coverage.planSha256 !== planSha256 || coverage.buildId !== build.id)
  throw new Error("Existing online state coverage is stale; recapture it before navigation.");
const navigation = await captureNavigationCoverage(out, plan, "online", build.id, String(deployment.themeId));
coverage.navigation = navigation.artifact;
await json(join(out, "online-coverage.json"), coverage);
await json(join(out, "online-navigation-result.json"), {
  capturedAt: new Date().toISOString(), errors: navigation.errors,
  planSha256, buildId: build.id, themeId: String(deployment.themeId), artifact: navigation.artifact,
});
if (navigation.errors.length) throw new Error(navigation.errors.join("; "));
console.log(JSON.stringify({ passed: true, routes: Object.keys(plan.routeInventory || {}).length, artifact: navigation.artifact }, null, 2));
