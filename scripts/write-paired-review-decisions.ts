import { resolve } from "node:path";
import { preparePairedReview } from "../src/visual-review-workflow.js";
const [out, stage = "preflight"] = process.argv.slice(2);
if (!out || !["preflight", "online"].includes(stage)) throw new Error("Usage: write-paired-review-decisions <output> [preflight|online]. Creates pending checks only.");
console.log(await preparePairedReview(resolve(out), stage as "preflight" | "online"));
