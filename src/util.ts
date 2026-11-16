import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
export const hash = (input: string | Buffer) =>
  createHash("sha256").update(input).digest("hex");
export async function write(path: string, data: string | Buffer) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}
export const json = async (path: string, value: unknown) =>
  write(path, JSON.stringify(value, null, 2));
export const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, "utf8"));
export const escapeHtml = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export async function pool<T, R>(
  items: T[],
  concurrency: number,
  fn: (v: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}
