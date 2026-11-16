"""TEST ONLY. Exports synthetic evidence for entrypoint regressions, not a store."""
import copy
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "evidence-gates"))
from test_presentation_gates import layout_fixture

root, build = Path(sys.argv[1]), sys.argv[2]
f = layout_fixture(root, "preflight")
node = f.plan["routes"]["sample"]["states"]["initial"]
node["generatorBindings"] = {"form": {
    "mode": "contract", "owner": "synthetic-test-only",
    "measures": list(f.record(node="initial")["presentationBindings"]["form"]["measures"]),
    "generator": "src/presentation-capture.ts", "generated": "theme/sections/test.liquid"}}
f.seal()
f.manifest.update(planSha256=f.digest, buildId=build)
for result in f.manifest["routes"]["sample"]["viewports"].values():
    record = result["states"]["initial"]
    for side in ("source", "target"):
        f.change(record[side], lambda d: d.update(buildId=build))
    record["negativeTests"] = {}
f.navigation["buildId"] = build
for ref in f.navigation["surfaces"].values():
    f.change(ref, lambda d: d.update(buildId=build))
for ref in f.navigation["routes"]["sample"].values():
    f.change(ref, lambda d: d.update(buildId=build))
f.manifest["navigation"] = f.save(f.navigation)
(root / "preflight-coverage.json").write_text(json.dumps(f.manifest), encoding="utf-8")
source = copy.deepcopy(f.manifest)
source["stage"] = "source"
(root / "source-coverage.json").write_text(json.dumps(source), encoding="utf-8")
