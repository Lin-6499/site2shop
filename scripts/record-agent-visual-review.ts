import { resolve } from "node:path";
import { submitReview } from "../src/visual-review-workflow.js";
const [out, stage, input] = process.argv.slice(2);
if (!out || !["preflight", "online"].includes(stage) || !input || input.startsWith("--"))
  throw new Error("Usage: record-agent-visual-review <output> <preflight|online> <explicit-review.json>. Confirmation flags cannot create a passing review.");
console.log(await submitReview(resolve(out), stage as "preflight" | "online", "visual", resolve(input)));
