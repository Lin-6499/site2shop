import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const out = process.argv[2];
if (!out) throw new Error("usage: build-agent-review-sheets <output>");
const root = join(out, "product-family-evidence");
const destination = join(out, "agent-review-sheets");
await mkdir(destination, { recursive: true });
const families = [
  "s2s-portrait", "s2s-mug", "s2s-accessory", "s2s-addon",
  "s2s-apparel", "s2s-custom-apparel", "s2s-embroidered", "s2s-gift-card",
  "s2s-hat", "s2s-home", "s2s-jewelry", "s2s-phone", "s2s-quote", "s2s-royal",
];
const viewports = ["desktop", "tablet", "mobile"];
const regions = ["full", "main", "form"];
const cellWidth = 360, cellHeight = 230, labelHeight = 34, gutter = 8;
const groupSize = 4;
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
for (const viewport of viewports) for (const region of regions) {
  const composites: sharp.OverlayOptions[] = [];
  for (let row = 0; row < families.length; row++) {
    const family = families[row];
    for (let column = 0; column < 2; column++) {
      const side = column === 0 ? "source" : "target";
      const path = join(root, side, family, viewport, `initial-${region}.png`);
      const image = await sharp(path).resize(cellWidth, cellHeight - labelHeight, { fit: "contain", background: "white" }).png().toBuffer();
      composites.push({ input: image, left: column * (cellWidth + gutter), top: row * cellHeight + labelHeight });
      const text = `${family} — ${side}`;
      composites.push({ input: Buffer.from(`<svg width="${cellWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${column ? "#e8f1ff" : "#f4ede8"}"/><text x="10" y="23" font-family="Arial" font-size="16" fill="#172322">${escape(text)}</text></svg>`), left: column * (cellWidth + gutter), top: row * cellHeight });
    }
  }
  const width = cellWidth * 2 + gutter, height = cellHeight * families.length;
  await sharp({ create: { width, height, channels: 3, background: "white" } })
    .composite(composites).png().toFile(join(destination, `${viewport}-${region}.png`));

  for (let groupStart = 0; groupStart < families.length; groupStart += groupSize) {
    const group = families.slice(groupStart, groupStart + groupSize);
    const groupComposites: sharp.OverlayOptions[] = [];
    for (let row = 0; row < group.length; row++) {
      const family = group[row];
      for (let column = 0; column < 2; column++) {
        const side = column === 0 ? "source" : "target";
        const path = join(root, side, family, viewport, `initial-${region}.png`);
        const image = await sharp(path)
          .resize(cellWidth, cellHeight - labelHeight, { fit: "contain", background: "white" })
          .png()
          .toBuffer();
        groupComposites.push({ input: image, left: column * (cellWidth + gutter), top: row * cellHeight + labelHeight });
        const text = `${family} — ${side}`;
        groupComposites.push({
          input: Buffer.from(`<svg width="${cellWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${column ? "#e8f1ff" : "#f4ede8"}"/><text x="10" y="23" font-family="Arial" font-size="16" fill="#172322">${escape(text)}</text></svg>`),
          left: column * (cellWidth + gutter),
          top: row * cellHeight,
        });
      }
    }
    const groupNumber = String(Math.floor(groupStart / groupSize) + 1).padStart(2, "0");
    await sharp({ create: { width, height: cellHeight * group.length, channels: 3, background: "white" } })
      .composite(groupComposites)
      .png()
      .toFile(join(destination, `${viewport}-${region}-${groupNumber}.png`));
  }
}
console.log(destination);
