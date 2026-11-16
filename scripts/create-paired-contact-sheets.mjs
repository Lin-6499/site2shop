import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import sharp from "sharp";

const project = resolve(process.argv[2]);
const coverage = JSON.parse(await readFile(join(project, "preflight-coverage.json"), "utf8"));
const out = join(project, "paired-review-work", "preflight", "contact-sheets");
await mkdir(out, { recursive: true });

const loadCapture = async ref => JSON.parse(await readFile(join(project, ref.path), "utf8"));
const xml = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
const tileWidth = 420;
const tileHeight = 280;
const labelHeight = 36;

for (const [routeId, route] of Object.entries(coverage.routes)) {
  const rows = [];
  for (const viewport of ["desktop", "tablet", "mobile"]) {
    const view = route.viewports[viewport];
    for (const [stateId, record] of Object.entries(view.states)) {
      rows.push({ viewport, stateId, record });
    }
  }
  const canvas = sharp({ create: { width: tileWidth * 2, height: tileHeight * rows.length, channels: 4, background: "#ffffff" } });
  const composites = [];
  for (let row = 0; row < rows.length; row++) {
    const { viewport, stateId, record } = rows[row];
    for (let col = 0; col < 2; col++) {
      const side = col === 0 ? "source" : "target";
      const capture = await loadCapture(record[side]);
      const imagePath = join(project, capture.artifacts.screenshot.path);
      const image = await sharp(imagePath).resize(tileWidth, tileHeight - labelHeight, { fit: "contain", background: "#f3f3f3" }).png().toBuffer();
      const label = await sharp(Buffer.from(`<svg width="${tileWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#162f2f"/><text x="12" y="24" font-family="Arial" font-size="15" fill="white">${xml(`${viewport} / ${stateId} / ${side}`)}</text></svg>`)).png().toBuffer();
      composites.push({ input: label, left: col * tileWidth, top: row * tileHeight });
      composites.push({ input: image, left: col * tileWidth, top: row * tileHeight + labelHeight });
    }
  }
  const path = join(out, `${basename(routeId)}.png`);
  await canvas.composite(composites).png().toFile(path);
  console.log(path);
}
