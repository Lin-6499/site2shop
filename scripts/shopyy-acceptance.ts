// Compatibility entrypoint: legacy height/existence reports are not accepted.
import { resolve } from "node:path";
import { recordGate } from "../src/shopyy/gates.js";
const index = process.argv.indexOf("--project");
if (index < 0 || !process.argv[index + 1]) throw Error("--project <file> is required");
const report = await recordGate(resolve(process.argv[index + 1]), "preflight");
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 2;
