import { resolve } from "node:path";
import { preparePairedReview, prepareVisualSummary, submitReview } from "../src/visual-review-workflow.js";
const [mode, out, stage = "preflight", input] = process.argv.slice(2);
if (!out || !["preflight", "online"].includes(stage)) throw new Error("Usage: paired-review-workflow <prepare|prepare-summary|submit-paired|submit-summary> <output> <preflight|online> [explicit-input.json]");
const root = resolve(out), scope = stage as "preflight" | "online";
if (mode === "prepare") console.log(await preparePairedReview(root, scope));
else if (mode === "prepare-summary") console.log(await prepareVisualSummary(root, scope));
else if (["submit-paired", "submit-summary"].includes(mode) && input)
  console.log(await submitReview(root, scope, mode === "submit-paired" ? "paired" : "visual", resolve(input)));
else throw new Error("Legacy batch mark/finalize modes are disabled. Inspect both sites per operation and submit explicit recorded decisions; timestamp/input/inspection synthesis is forbidden.");
