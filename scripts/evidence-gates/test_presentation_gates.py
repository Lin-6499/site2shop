"""Synthetic layout fault injection. Never treat these fixtures as site evidence."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from presentation_integrity import FIELDS, PIXEL_FIELDS
from test_evidence_gates import Fixture


def layout_fixture(root, stage="online"):
    f = Fixture(root, scenario="static", stage=stage)
    tolerance = {"absolute": 1, "relative": 0, "reason": "Synthetic subpixel rounding allowance"}
    acceptance = {"kind": "rendered", "profile": "box-v1", "sourcePointer": "/boxes/widget",
                  "targetPointer": "/boxes/widget", "tolerances": {
                      field: copy.deepcopy(tolerance) for field in PIXEL_FIELDS}}
    f.change(f.plan["analysis"], lambda a: a["routes"][0]["components"][0].update(acceptance=acceptance))
    node = f.plan["routes"]["sample"]["states"]["initial"]
    for field in FIELDS:
        rule = {"id": field, "sourcePointer": "/boxes/widget/" + field,
                "targetPointer": "/boxes/widget/" + field,
                "operator": "numeric" if field in PIXEL_FIELDS else "equal", "negativeTest": "reject-" + field}
        if field in PIXEL_FIELDS:
            rule.update(tolerance={"absolute": 1, "relative": 0}, toleranceReason=tolerance["reason"])
        node["rules"].append(rule)
    f.seal()
    f.manifest["planSha256"] = f.digest
    generator = f.save("/* synthetic generator fixture */", ".js")
    generated = f.save("/* synthetic generated fixture */", ".css")
    for vp, dims in f.plan["viewports"].items():
        record = f.record(node="initial", vp=vp)
        box = {field: 0 for field in PIXEL_FIELDS}
        box.update(widthPx=dims["width"] - 32, leftInsetPx=16, rightInsetPx=16,
                   visible=True, placement={"parent": "page-content", "previous": "press", "next": "footer"},
                   topology={"display": "block", "flow": "normal", "tracks": "none"},
                   overflow={"x": "visible", "y": "visible", "nativeScrollbarX": False})
        context = {"cssViewport": dims, "documentClientWidth": dims["width"],
                   "devicePixelRatio": 1, "visualViewportScale": 1, "rootZoom": 1}
        for side in ("source", "target"):
            f.change(record[side], lambda d: d["observations"].update(
                boxes={"widget": box}, presentationContext=context))
        record["presentationBindings"] = {"form": {"mode": "provider-configuration",
            "sourceCaptureSha256": record["source"]["sha256"], "sourcePointer": "/boxes/widget",
            "measures": list(FIELDS), "owner": "fixture.renderReviewWidget", "generator": generator,
            "generated": generated}}
        for rule in node["rules"]:
            record["negativeTests"][rule["id"]] = f.save({"id": rule["negativeTest"],
                "ruleId": rule["id"], "status": "passed", "planSha256": f.digest, "buildId": "build-A",
                "runner": "synthetic-fixture-only", "executedAt": "2026-10-23T12:00:00+08:00",
                "rejectedMutations": ["missing-source", "missing-target", "mismatch"],
                "log": f.save("synthetic test log; not browser evidence", ".log")})
    return f


class PresentationGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="presentation-gate-test-")
        self.addCleanup(self.temp.cleanup)
        self.f = layout_fixture(self.temp.name)

    def record(self):
        return self.f.record(node="initial")

    def mutate_box(self, **changes):
        self.f.change(self.record()["target"], lambda d: d["observations"]["boxes"]["widget"].update(changes))

    def reject(self, message):
        errors = self.f.run()
        self.assertTrue(any(message in error for error in errors), errors)

    def test_valid_layout_in_all_stages_and_viewports(self):
        for stage in ("source", "preflight", "online"):
            with self.subTest(stage=stage), tempfile.TemporaryDirectory() as root:
                self.assertEqual(layout_fixture(root, stage).run(), [])

    def test_legacy_unclassified_component_is_blocked(self):
        self.f.change(self.f.plan["analysis"], lambda a: a["routes"][0]["components"][0].pop("acceptance"))
        self.reject("missing acceptance classification")

    def test_component_present_does_not_replace_dimension_coverage(self):
        rules = self.f.plan["routes"]["sample"]["states"]["initial"]["rules"]
        rules[:] = [rule for rule in rules if rule["id"] != "paddingTopPx"]
        self.reject("paddingTopPx: expected one measured assertion")

    def test_cannot_widen_tolerance_in_capture_plan(self):
        rule = next(r for r in self.f.plan["routes"]["sample"]["states"]["initial"]["rules"] if r["id"] == "widthPx")
        rule["tolerance"]["absolute"] = 1000
        self.reject("exceeds independently declared tolerance")

    def test_missing_measured_value(self):
        self.f.change(self.record()["target"], lambda d: d["observations"]["boxes"]["widget"].pop("widthPx"))
        self.reject("widthPx: missing finite measurement")

    def test_boolean_is_not_a_dimension(self):
        self.mutate_box(widthPx=True)
        self.reject("widthPx: missing finite measurement")

    def test_padding_error_is_not_excused_by_empty_reviews_or_pass_flag(self):
        self.mutate_box(paddingTopPx=36, paddingBottomPx=80)
        self.record().update(passed=True, dataDifferences="Target has zero reviews; source has many")
        self.reject("comparison failed: paddingTopPx")

    def test_fault_injection_for_every_numeric_dimension(self):
        original = copy.deepcopy(self.record()["target"])
        for field in PIXEL_FIELDS:
            with self.subTest(field=field):
                self.record()["target"] = copy.deepcopy(original)
                self.f.change(self.record()["target"], lambda d: d["observations"]["boxes"]["widget"].__setitem__(
                    field, d["observations"]["boxes"]["widget"][field] + 25))
                self.reject("comparison failed: " + field)

    def test_structural_placement_mismatch(self):
        self.mutate_box(placement={"parent": "viewport", "previous": "none", "next": "footer"})
        self.reject("comparison failed: placement")

    def test_wrong_grid_layout(self):
        self.mutate_box(topology={"display": "grid", "flow": "row", "tracks": "1"})
        self.reject("comparison failed: topology")

    def test_visible_native_scrollbar(self):
        self.mutate_box(overflow={"x": "auto", "y": "visible", "nativeScrollbarX": True})
        self.reject("comparison failed: overflow")

    def test_data_variance_does_not_require_fabricated_content(self):
        for side, count, height in (("source", 120, 4800), ("target", 0, 150)):
            self.f.change(self.record()[side], lambda d: d["observations"].update(reviewCount=count, contentHeight=height))
        self.record()["presentationBindings"]["form"]["sourceCaptureSha256"] = self.record()["source"]["sha256"]
        self.assertEqual(self.f.run(), [])

    def test_wrong_capture_viewport(self):
        self.f.change(self.record()["target"], lambda d: d["viewport"].update(width=1920))
        self.reject("capture identity mismatch: viewport")

    def test_different_effective_width_is_invalid_comparison(self):
        self.f.change(self.record()["target"], lambda d: d["observations"]["presentationContext"].update(documentClientWidth=375))
        self.reject("incompatible render contexts")

    def test_missing_measured_render_context(self):
        self.f.change(self.record()["target"], lambda d: d["observations"].pop("presentationContext"))
        self.reject("missing measured render context")

    def test_falsely_labeled_viewport(self):
        self.f.change(self.record()["target"], lambda d: d["observations"]["presentationContext"]["cssViewport"].update(width=1920))
        self.reject("measured viewport differs from plan")

    def test_missing_generator_binding(self):
        self.record().pop("presentationBindings")
        self.reject("generator binding coverage")

    def test_generic_default_is_provisional(self):
        self.record()["presentationBindings"]["form"]["mode"] = "generic-default"
        self.reject("provisional/default layout")

    def test_stale_source_binding(self):
        self.record()["presentationBindings"]["form"]["sourceCaptureSha256"] = "0" * 64
        self.reject("stale source-to-generator binding")

    def test_unconsumed_layout_requirement(self):
        self.record()["presentationBindings"]["form"]["measures"].remove("gapBeforePx")
        self.reject("unconsumed presentation requirements")

    def test_generator_artifact_tampering(self):
        self.record()["presentationBindings"]["form"]["generator"]["sha256"] = "0" * 64
        self.reject("artifact hash mismatch")

    def test_missing_negative_test_for_layout(self):
        del self.record()["negativeTests"]["paddingTopPx"]
        self.reject("paddingTopPx")

    def test_source_gate_does_not_require_unbuilt_generator(self):
        self.f.stage = self.f.manifest["stage"] = "source"
        self.record().pop("presentationBindings")
        self.assertEqual(self.f.run(), [])

    def test_cli_failure_is_nonzero_for_upload_wrapper(self):
        self.mutate_box(paddingTopPx=36)
        manifest = self.f.save(self.f.manifest)
        result = subprocess.run([sys.executable, str(Path(__file__).with_name("validate_evidence_coverage.py")),
            str(self.f.root / manifest["path"]), "--plan", str(self.f.root / "capture-plan.json"),
            "--stage", "online", "--build-id", "build-A", "--theme-id", "draft-A"],
            capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertFalse(json.loads(result.stdout)["passed"])


if __name__ == "__main__":
    unittest.main()
