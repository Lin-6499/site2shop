import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const projectRoot = process.argv[2];
if (!projectRoot) throw new Error("Usage: node scripts/collapse-paired-review-sheets.mjs <project-root>");
const inputDir = path.join(projectRoot, "paired-review-work");
const outputDir = path.join(inputDir, "master-sheets");
fs.mkdirSync(outputDir, { recursive: true });

for (const kind of ["transitions", "states"]) {
  for (const viewport of ["desktop", "tablet", "mobile"]) {
    const files = fs.readdirSync(inputDir)
      .filter((name) => name.startsWith(`${kind}-${viewport}-`) && name.endsWith(".png"))
      .sort((a, b) => Number(a.match(/-(\d+)\.png$/)?.[1]) - Number(b.match(/-(\d+)\.png$/)?.[1]));
    const groupSize = 6;
    for (let start = 0; start < files.length; start += groupSize) {
      const group = files.slice(start, start + groupSize);
      const cellWidth = 520;
      const cellHeight = 745;
      const columns = 3;
      const rows = Math.ceil(group.length / columns);
      const overlays = [];
      for (let index = 0; index < group.length; index += 1) {
        const resized = await sharp(path.join(inputDir, group[index]))
          .resize(cellWidth, cellHeight, { fit: "contain", background: "#ffffff" })
          .png()
          .toBuffer();
        overlays.push({ input: resized, left: (index % columns) * cellWidth, top: Math.floor(index / columns) * cellHeight });
      }
      const outName = `${kind}-${viewport}-master-${String(Math.floor(start / groupSize) + 1).padStart(2, "0")}.png`;
      await sharp({ create: { width: cellWidth * columns, height: cellHeight * rows, channels: 3, background: "#d1d5db" } })
        .composite(overlays)
        .png()
        .toFile(path.join(outputDir, outName));
    }
  }
}

console.log(outputDir);
