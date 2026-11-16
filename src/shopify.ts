import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { json, readJson } from "./util.js";
import { report } from "./report.js";
import { assertProductFamilyDraftContracts } from "./product-family-contracts.js";
import { assertGeneratedThemeIntegrity } from "./theme-integrity.js";
import { assertDraftVisualAuditNotFailed, assertReviewSystemViewportCoverage } from "./product-family-evidence.js";
import { assertCollectionFamilyContract } from "./collection-contracts.js";
import { assertPageFamilyDraftContracts } from "./page-family-contracts.js";
import { assertReviewedReleaseEvidence } from "./reviewed-release-evidence.js";

const require = createRequire(import.meta.url);
const executable = join(
  dirname(require.resolve("@shopify/cli/package.json")),
  "bin/run.js",
);
export function parseCliJson(output: string): any {
  try {
    return JSON.parse(output);
  } catch {}
  for (const line of output.trim().split(/\r?\n/).reverse()) {
    try {
      return JSON.parse(line);
    } catch {}
  }
  throw new Error("Shopify CLI did not return JSON. See the CLI output.");
}
export async function shopify(args: string[]) {
  return await new Promise<string>((resolve, reject) => {
    // No shell: paths and store names cannot become shell commands. Login stays in Shopify CLI.
    const child = spawn(process.execPath, [executable, ...args], {
      stdio: ["inherit", "pipe", "inherit"],
      env: { ...process.env, SHOPIFY_CLI_NO_ANALYTICS: "1" },
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(output)
        : reject(
            new Error(`Shopify CLI exited ${code}. ${output.slice(-1500)}`),
          ),
    );
  });
}
export async function check(out: string) {
  const output = await shopify([
    "theme",
    "check",
    "--path",
    join(resolve(out), "theme"),
    "--output",
    "json",
  ]);
  const details = parseCliJson(output);
  await json(join(out, "theme-check.json"), details);
  const errors = details.reduce((n: number, f: any) => n + f.errorCount, 0),
    warnings = details.reduce((n: number, f: any) => n + f.warningCount, 0);
  console.log(`Theme Check: ${errors} errors, ${warnings} warnings`);
  if (errors) throw new Error("Theme Check failed");
  return { errors, warnings };
}
export async function deploy(
  out: string,
  store: string,
  name = "Site2Shop Phase 1",
) {
  store = store.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(store))
    throw new Error("Use an xxx.myshopify.com store domain.");
  // Runs before Theme Check, theme list, or any upload. No legacy pass flag can bypass it.
  await assertReviewedReleaseEvidence(out, "preflight", true);
  await assertGeneratedThemeIntegrity(out);
  await assertPageFamilyDraftContracts(out);
  await assertProductFamilyDraftContracts(out);
  await assertCollectionFamilyContract(out);
  await assertReviewSystemViewportCoverage(out);
  await assertDraftVisualAuditNotFailed(out);
  await check(out);
  const previous = await readJson<any>(join(out, "deployment.json")).catch(
    () => null,
  );
  const build = await readJson<any>(join(out, "theme-build.json"));
  const args = [
    "theme",
    "push",
    "--store",
    store,
    "--path",
    join(resolve(out), "theme"),
    "--json",
    "--strict",
  ];
  if (previous?.store === store && previous.themeId) {
    const themes = parseCliJson(
      await shopify(["theme", "list", "--store", store, "--json"]),
    );
    const entries = Array.isArray(themes) ? themes : themes.themes;
    const target = entries?.find(
      (t: any) => String(t.id) === String(previous.themeId),
    );
    if (target?.role === "unpublished")
      args.push("--theme", String(previous.themeId), "--no-input");
    else
      args.push("--unpublished", "--theme", name);
  } else args.push("--unpublished", "--theme", name);
  const result = parseCliJson(await shopify(args));
  const theme = result.theme;
  if (!theme?.id) throw new Error("No theme id returned");
  const deployment = {
    store,
    themeId: theme.id,
    name: theme.name,
    role: theme.role,
    previewUrl: theme.preview_url,
    editorUrl: theme.editor_url,
    uploadedAt: new Date().toISOString(),
    themeBuild: build.id,
    published: false,
  };
  await json(join(out, "deployment.json"), deployment);
  await report(out);
  console.log(JSON.stringify(deployment, null, 2));
  return deployment;
}
