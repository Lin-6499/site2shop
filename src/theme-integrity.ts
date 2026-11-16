import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { readJson } from "./util.js";

export const THEME_BUILD_PLACEHOLDER = "__SITE2SHOP_BUILD_ID__";
export function normalizedThemeBuildBytes(name: string, body: Uint8Array) {
  if (name !== "layout/theme.liquid") return body;
  return Buffer.from(Buffer.from(body).toString("utf8").replace(
    /(<meta\s+name=["']site2shop-build-id["']\s+content=["'])[^"']*(["']\s*\/?>)/i,
    `$1${THEME_BUILD_PLACEHOLDER}$2`,
  ));
}

export async function computeThemeBuildId(out: string) {
  const root = join(out, "theme");
  const files: Array<{ name: string; body: Buffer }> = [];
  async function walk(dir: string, prefix = "") {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const name = prefix + entry.name;
      if (entry.isDirectory()) await walk(path, name + "/");
      else if (!entry.name.startsWith("."))
        files.push({ name, body: await readFile(path) });
    }
  }
  await walk(root);
  const digest = createHash("sha256");
  // Match packageTheme's code-unit order; localeCompare changes ordering of
  // punctuation/case and can reject an untouched build on another machine.
  for (const file of files.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    digest.update(file.name).update("\0").update(normalizedThemeBuildBytes(file.name, file.body));
  return digest.digest("hex");
}

export async function assertGeneratedThemeIntegrity(out: string) {
  const build = await readJson<{ id: string }>(join(out, "theme-build.json"));
  const actual = await computeThemeBuildId(out);
  if (actual !== build.id)
    throw new Error(
      "Generated theme integrity failed: files under theme/ changed after the last build. Put the fix in generator source and rebuild before deployment.",
    );
  return { expected: build.id, actual };
}
