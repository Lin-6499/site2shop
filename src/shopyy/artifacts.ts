import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rename, readdir, lstat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import type { Ref } from "./contracts.js";

export const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
// Playwright API request errors can include Cookie/Authorization headers in their call log.
export const safeBrowserError = (error:unknown) => error instanceof Error ? `${error.name}: ${error.message.split(/\nCall log:/)[0]}` : 'Browser operation failed';
export const canonical = (value: any): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value !== null && typeof value === "object" ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}` : JSON.stringify(value);
export const jsonFile = async <T = any>(path: string): Promise<T> => JSON.parse(await readFile(path, "utf8"));
export async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n"); await rename(temp, path);
}
export async function contained(root: string, name: string) {
  if (!name || isAbsolute(name) || name.split(/[\\/]/).includes("..")) throw Error("Artifact path must remain relative to its root");
  const base = await realpath(root), target = await realpath(resolve(base, name));
  if (!relative(base, target) || relative(base, target).startsWith("..") || isAbsolute(relative(base, target))) throw Error("Artifact escapes root");
  return target;
}
export async function readRef(root: string, ref: Ref) {
  if (!ref || !/^[a-f0-9]{64}$/.test(ref.sha256)) throw Error("Missing evidence hash");
  const bytes = await readFile(await contained(root, ref.path));
  if (digest(bytes) !== ref.sha256) throw Error(`Changed evidence: ${ref.path}`);
  return bytes;
}
export async function saveArtifact(root: string, value: unknown, extension = "json"): Promise<Ref> {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  const sha256 = digest(bytes), path = `artifacts/${sha256}.${extension}`;
  await mkdir(join(root, "artifacts"), { recursive: true }); await writeFile(join(root, path), bytes);
  return { path, sha256 };
}
export async function files(root: string, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  for (const item of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if ((await lstat(join(root, name))).isSymbolicLink()) throw Error(`Symlink in build: ${name}`);
    if (item.isDirectory()) found.push(...await files(root, name)); else found.push(name);
  }
  return found.sort();
}
export async function buildIdentity(output: string) {
  const manifest = await jsonFile(join(output, "theme-build.json"));
  if (manifest.schemaVersion !== 2) throw Error("Legacy build: regenerate with the shared renderer");
  if (digest(canonical(manifest.inputs)) !== manifest.inputDigest) throw Error("Build input digest mismatch");
  const actual: { path: string; sha256: string }[] = [];
  for (const folder of ["theme", "preview"]) for (const name of await files(join(output, folder))) {
    actual.push({ path: `${folder}/${name}`, sha256: digest(await readFile(join(output, folder, name))) });
  }
  actual.sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (canonical(actual) !== canonical(manifest.integrity)) throw Error("Generated-only edits or missing/extra build files");
  const id = digest(canonical({ files: actual, inputDigest: manifest.inputDigest }));
  if (id !== manifest.buildId) throw Error("Build identity mismatch");
  const zip = await readFile(await contained(output, manifest.package.file));
  if (digest(zip) !== manifest.package.sha256) throw Error("Package integrity mismatch");
  return { id, manifest };
}

/** Hash every generator module and util dependency, not just the adapter entrypoint. */
export async function generatorIdentity() {
  const base = new URL('./', import.meta.url);
  const names = (await readdir(base)).filter(n => n.endsWith('.ts')).sort();
  names.push('../util.ts');
  return digest(canonical(await Promise.all(names.map(async path => ({path,sha256:digest(await readFile(new URL(path,base)))})))));
}
