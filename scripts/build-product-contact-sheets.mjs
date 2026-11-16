import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const projectRoot = process.argv[2];
if (!projectRoot) throw new Error("Usage: node scripts/build-product-contact-sheets.mjs <project-root>");

const coverage = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "preflight-coverage.json"), "utf8"),
);
const routeIds = [
  "house-portrait",
  "pop-art",
  "watercolor",
  "gift-card",
  "print",
  "digital",
  "hat",
  "wine-glass",
  "house-mug",
  "print-holy-sh-t",
  "print-homeowner-era",
  "print-heaven-on-earth",
  "print-new-chapter",
];
const outputDir = path.join(projectRoot, "agent-visual-contact-sheets");
fs.mkdirSync(outputDir, { recursive: true });

function screenshotPath(artifactPath) {
  const artifact = JSON.parse(fs.readFileSync(path.join(projectRoot, artifactPath), "utf8"));
  return path.join(projectRoot, artifact.artifacts.screenshot.path);
}

for (const viewport of ["desktop", "tablet", "mobile"]) {
  const cellWidth = viewport === "desktop" ? 500 : viewport === "tablet" ? 380 : 260;
  const imageHeight = viewport === "desktop" ? 282 : viewport === "tablet" ? 476 : 566;
  const labelHeight = 34;
  const rowHeight = imageHeight + labelHeight;
  const canvasWidth = cellWidth * 2;
  const canvasHeight = rowHeight * routeIds.length;
  const composites = [];

  for (let row = 0; row < routeIds.length; row += 1) {
    const routeId = routeIds[row];
    const state = coverage.routes[routeId]?.viewports?.[viewport]?.states?.initial;
    if (!state) throw new Error(`Missing ${routeId}/${viewport}/initial`);
    for (const [column, side] of ["source", "target"].entries()) {
      const input = screenshotPath(state[side].path);
      const resized = await sharp(input)
        .resize(cellWidth, imageHeight, { fit: "cover", position: "top" })
        .png()
        .toBuffer();
      composites.push({ input: resized, left: column * cellWidth, top: row * rowHeight + labelHeight });
    }
    const label = Buffer.from(
      `<svg width="${canvasWidth}" height="${labelHeight}"><rect width="100%" height="100%" fill="#111827"/><text x="12" y="23" font-family="Arial" font-size="16" fill="white">${routeId} — SOURCE</text><text x="${cellWidth + 12}" y="23" font-family="Arial" font-size="16" fill="white">${routeId} — TARGET</text></svg>`,
    );
    composites.push({ input: label, left: 0, top: row * rowHeight });
  }

  await sharp({
    create: { width: canvasWidth, height: canvasHeight, channels: 3, background: "#ffffff" },
  })
    .composite(composites)
    .png()
    .toFile(path.join(outputDir, `products-${viewport}.png`));

  const workflowRows = [];
  for (const routeId of routeIds) {
    const states = coverage.routes[routeId]?.viewports?.[viewport]?.states;
    const preferred = ["replayed", "returned", "configured", "changed"].find((name) => states?.[name]);
    if (preferred) workflowRows.push({ routeId, stateName: preferred, state: states[preferred] });
  }
  const workflowHeight = rowHeight * workflowRows.length;
  const workflowComposites = [];
  for (let row = 0; row < workflowRows.length; row += 1) {
    const { routeId, stateName, state } = workflowRows[row];
    for (const [column, side] of ["source", "target"].entries()) {
      const input = screenshotPath(state[side].path);
      const resized = await sharp(input)
        .resize(cellWidth, imageHeight, { fit: "cover", position: "top" })
        .png()
        .toBuffer();
      workflowComposites.push({ input: resized, left: column * cellWidth, top: row * rowHeight + labelHeight });
    }
    const label = Buffer.from(
      `<svg width="${canvasWidth}" height="${labelHeight}"><rect width="100%" height="100%" fill="#312e81"/><text x="12" y="23" font-family="Arial" font-size="16" fill="white">${routeId}/${stateName} — SOURCE</text><text x="${cellWidth + 12}" y="23" font-family="Arial" font-size="16" fill="white">${routeId}/${stateName} — TARGET</text></svg>`,
    );
    workflowComposites.push({ input: label, left: 0, top: row * rowHeight });
  }
  await sharp({
    create: { width: canvasWidth, height: workflowHeight, channels: 3, background: "#ffffff" },
  })
    .composite(workflowComposites)
    .png()
    .toFile(path.join(outputDir, `products-${viewport}-workflow.png`));
}

console.log(outputDir);
