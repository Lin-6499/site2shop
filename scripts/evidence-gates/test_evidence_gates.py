"""Synthetic fixtures test gate behavior, not real-site browser fidelity."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from validate_evidence_coverage import Invalid, check_transition_navigation, validate


class Fixture:
    def __init__(self, root, scenario="multistep", stage="online", implementation="supported"):
        self.root, self.stage = Path(root), stage
        self.counter = 0
        note = self.save({"observed": "synthetic discovery only", "scenario": scenario})
        self.analysis = {"schemaVersion": 1, "unresolved": [],
                         "platform": {"name": "unknown", "confidence": "unknown", "evidence": note},
                         "capabilities": [{"id": "workflow", "capture": "supported",
                                           "implementation": implementation, "evidence": note}],
                         "routes": [{"id": "sample", "url": "https://source.example/products/sample",
                                     "family": scenario, "components": [
                                         {"id": "form", "interactive": scenario != "static", "evidence": note,
                                          "acceptance": {"kind": "nonvisual", "reason": "Synthetic protocol-only fixture; actual rendered forms require box-v1."}}]}]}
        self.rule = {"id": "visible-fields", "sourcePointer": "/fields", "targetPointer": "/fields",
                     "operator": "unordered", "negativeTest": "reject-field-loss"}
        base = {"components": ["form"], "rules": [self.rule]}
        states = {"initial": copy.deepcopy(base)}
        edges = {}
        if scenario != "static":
            states["configured"] = copy.deepcopy(base)
            edges["continue"] = {**copy.deepcopy(base), "from": "initial", "to": "configured",
                                 "action": "activate-primary-control", "condition": "valid-options"}
            edges["back"] = {**copy.deepcopy(base), "from": "configured", "to": "initial",
                             "action": "activate-back-control", "condition": "preserve-options"}
        if scenario in ("multistep", "subscription"):
            states["invalid"] = copy.deepcopy(base)
            edges["invalid-submit"] = {**copy.deepcopy(base), "from": "configured", "to": "invalid",
                                       "action": "submit-empty", "condition": "required-fields-empty"}
        if scenario == "subscription":
            states["one-time"] = copy.deepcopy(base)
            edges["choose-one-time"] = {**copy.deepcopy(base), "from": "initial", "to": "one-time",
                                       "action": "select-one-time", "condition": "purchase-mode-once"}
            edges["change-to-recurring"] = {**copy.deepcopy(base), "from": "one-time", "to": "configured",
                                           "action": "select-recurring", "condition": "purchase-mode-recurring"}
        self.plan = {"schemaVersion": 2, "planId": "fixture", "revision": 1,
                     "contractVersion": "v1", "collectorVersion": "v1", "analysis": self.save(self.analysis),
                     "limits": {"maxActionsPerRoute": 40, "maxMinutesPerRoute": 10},
                     "viewports": {"desktop": {"width": 1920, "height": 1080},
                                   "tablet": {"width": 768, "height": 1024},
                                   "mobile": {"width": 390, "height": 844}},
                     "routes": {"sample": {"family": scenario, "samplingRationale": "synthetic boundary sample",
                                           "source": {"url": "https://source.example/products/sample",
                                                      "canonical": "https://source.example/products/sample"},
                                           "target": {"url": "https://target.example/products/sample",
                                                      "canonical": "https://target.example/products/sample"},
                                           "states": states, "transitions": edges}}}
        from test_navigation_gates import add_inventory
        add_inventory(self)
        from test_interaction_gates import add_interactions, observation_controls, fields_for
        add_interactions(self)
        self.seal()
        dom = self.save("<main data-fixture>Fixture</main>", ".html")
        screenshot = self.save(b"synthetic-image-bytes-not-browser-evidence", ".png")
        self.manifest = {"schemaVersion": 2, "stage": stage, "planSha256": self.digest,
                         "buildId": "build-A", "themeId": "draft-A", "routes": {"sample": {"viewports": {}}}}
        for vp, dimensions in self.plan["viewports"].items():
            result = {"states": {}, "transitions": {}}
            self.manifest["routes"]["sample"]["viewports"][vp] = result
            for kind, nodes in (("states", states), ("transitions", edges)):
                for nid, node in nodes.items():
                    record = {}
                    result[kind][nid] = record
                    for side in ("source", "target"):
                        location = self.plan["routes"]["sample"][side]
                        assets = {"dom": dom, "screenshot": screenshot}
                        if kind == "transitions":
                            trace = {k: node[k] for k in ("from", "to", "action", "condition")}
                            trace.update(status="performed", beforeArtifactHash=result["states"][node["from"]][side]["sha256"],
                                         afterArtifactHash=result["states"][node["to"]][side]["sha256"])
                            assets = {"trace": self.save(trace)}
                        data = {"schemaVersion": 2, "routeId": "sample", "kind": kind, "nodeId": nid, "side": side,
                                "capturedAt": "2026-10-22T12:00:00+08:00", "httpStatus": 200, "pageKind": "content",
                                "requestedUrl": location["url"], "finalUrl": location["url"], "canonical": location["canonical"],
                                "viewport": {"name": vp, **dimensions}, "buildId": "build-A", "themeId": "draft-A",
                                "artifacts": assets, "observations": {"fields": ["option"] if nid == "initial" else
                                                                       ["photo", "photo", "name", "name"]}}
                        data.update({k: self.plan[k] for k in ("planId", "revision", "contractVersion", "collectorVersion")})
                        if scenario == "subscription":
                            state_id = nid if kind == "states" else node["to"]
                            fields = ["purchase-mode"]
                            if state_id in ("configured", "invalid"):
                                fields += ["billing-interval", "recurring-consent"]
                            data["observations"]["fields"] = fields
                        state_id = nid if kind == "states" else node["to"]
                        data["observations"]["fields"] = fields_for(scenario, state_id)
                        data["observations"]["interactionControls"] = observation_controls(self, state_id, vp)
                        record[side] = self.save(data)
                    record["negativeTests"] = {"visible-fields": self.save({
                        "id": "reject-field-loss", "ruleId": "visible-fields", "status": "passed",
                        "planSha256": self.digest, "buildId": "build-A", "runner": "synthetic-fixture-only",
                        "executedAt": "2026-10-22T12:05:00+08:00",
                        "rejectedMutations": ["missing-source", "missing-target", "mismatch"],
                        "log": self.save("synthetic test log, not a browser run", ".log")})}
        from test_navigation_gates import add_navigation_coverage
        add_navigation_coverage(self)

    def save(self, value, extension=".json"):
        self.counter += 1
        path = self.root / (str(self.counter) + extension)
        raw = value if isinstance(value, bytes) else (json.dumps(value).encode() if extension == ".json" else value.encode())
        path.write_bytes(raw)
        return {"path": path.name, "sha256": hashlib.sha256(raw).hexdigest()}

    def seal(self):
        raw = json.dumps(self.plan).encode()
        (self.root / "capture-plan.json").write_bytes(raw)
        self.digest = hashlib.sha256(raw).hexdigest()

    def record(self, kind="states", node="configured", vp="mobile"):
        return self.manifest["routes"]["sample"]["viewports"][vp][kind][node]

    def change(self, ref, mutate):
        value = json.loads((self.root / ref["path"]).read_bytes())
        mutate(value)
        ref.update(self.save(value))

    def run(self):
        return validate(self.plan, self.manifest, self.root, plan_sha256=self.digest,
                        stage=self.stage, build_id="build-A", theme_id="draft-A")


class EvidenceGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="replication-gate-test-")
        self.addCleanup(self.temp.cleanup)
        self.f = Fixture(self.temp.name)

    def reject(self, expected=None):
        errors = self.f.run()
        self.assertTrue(errors)
        if expected:
            self.assertTrue(any(expected in error for error in errors), errors)

    def test_valid_scenarios_and_stages(self):
        for scenario in ("static", "single-step", "multistep", "subscription"):
            for stage in ("source", "preflight", "online"):
                with self.subTest(scenario=scenario, stage=stage), tempfile.TemporaryDirectory() as root:
                    self.assertEqual(Fixture(root, scenario, stage).run(), [])

    def test_legacy_schema_rejected(self):
        self.f.manifest["schemaVersion"] = 1
        self.reject()

    def test_missing_later_state(self):
        del self.f.manifest["routes"]["sample"]["viewports"]["mobile"]["states"]["configured"]
        self.reject()

    def test_missing_back_transition(self):
        del self.f.manifest["routes"]["sample"]["viewports"]["tablet"]["transitions"]["back"]
        self.reject()

    def test_missing_route(self):
        self.f.manifest["routes"].clear()
        self.reject()

    def test_missing_viewport(self):
        del self.f.manifest["routes"]["sample"]["viewports"]["tablet"]
        self.reject()

    def test_missing_source(self):
        del self.f.record()["source"]
        self.reject()

    def test_missing_target(self):
        del self.f.record()["target"]
        self.reject()

    def test_missing_observation(self):
        self.f.change(self.f.record()["target"], lambda x: x["observations"].clear())
        self.reject()

    def test_null_not_absent(self):
        self.f.change(self.f.record()["source"], lambda x: x["observations"].update(fields=None))
        self.reject()

    def test_duplicate_upload_lost_despite_pass_flag(self):
        self.f.record()["status"] = "passed"
        self.f.change(self.f.record()["target"], lambda x: x["observations"].update(fields=["photo", "name"]))
        self.reject("mobile/states/configured: comparison failed: visible-fields")

    def test_missing_artifact(self):
        self.f.record()["source"]["path"] = "nonexistent.json"
        self.reject()

    def test_tampered_artifact(self):
        (self.f.root / self.f.record()["source"]["path"]).write_text("{}")
        self.reject()

    def test_path_escape(self):
        self.f.record()["source"]["path"] = "../outside.json"
        self.reject()

    def test_absolute_path(self):
        self.f.record()["source"]["path"] = str(self.f.root / self.f.record()["source"]["path"])
        self.reject()

    def test_stale_plan(self):
        self.f.manifest["planSha256"] = "old"
        self.reject()

    def test_stale_collector(self):
        self.f.change(self.f.record()["source"], lambda x: x.update(collectorVersion="old"))
        self.reject()

    def test_stale_build(self):
        self.f.change(self.f.record()["target"], lambda x: x.update(buildId="old"))
        self.reject()

    def test_wrong_theme(self):
        self.f.change(self.f.record()["target"], lambda x: x.update(themeId="live"))
        self.reject()

    def test_interstitial(self):
        self.f.change(self.f.record()["target"], lambda x: x.update(pageKind="challenge"))
        self.reject()

    def test_password_url(self):
        self.f.change(self.f.record()["target"], lambda x: x.update(finalUrl="https://target.example/password"))
        self.reject()

    def test_unlock_redirect_to_home(self):
        self.f.change(self.f.record()["target"], lambda x: x.update(finalUrl="https://target.example/"))
        self.reject()

    def test_wrong_canonical(self):
        self.f.change(self.f.record()["target"], lambda x: x.update(canonical="https://target.example/products/other"))
        self.reject()

    def test_http_error(self):
        self.f.change(self.f.record()["target"], lambda x: x.update(httpStatus=500))
        self.reject()

    def test_negative_test_id_is_not_a_run(self):
        self.f.record()["negativeTests"]["visible-fields"] = "reject-field-loss"
        self.reject()

    def test_missing_negative_mutations(self):
        self.f.change(self.f.record()["negativeTests"]["visible-fields"], lambda x: x.update(rejectedMutations=[]))
        self.reject()

    def test_wrong_transition_action(self):
        self.f.change(self.f.record("transitions", "continue")["target"],
                      lambda x: self.f.change(x["artifacts"]["trace"], lambda t: t.update(action="noop")))
        self.reject()

    def test_transition_endpoint_mismatch(self):
        self.f.change(self.f.record("transitions", "continue")["target"],
                      lambda x: self.f.change(x["artifacts"]["trace"], lambda t: t.update(afterArtifactHash="old")))
        self.reject()

    def test_internal_transition_navigation_uses_route_inventory(self):
        source = "https://source.example/pages/customizer"
        target = "https://target.example/pages/customizer"
        inventory = {"routes": {"destination": {
            "sourceUrl": source,
            "target": {"url": target, "finalUrl": target, "canonical": target,
                       "redirectChain": [target]},
            "localTarget": {"url": "http://localhost:9292/pages/customizer",
                            "finalUrl": "http://localhost:9292/pages/customizer",
                            "canonical": "http://localhost:9292/pages/customizer",
                            "redirectChain": ["http://localhost:9292/pages/customizer"]},
        }}}
        edge = {"navigation": {"kind": "internal", "routeId": "destination"}}
        for side, stage, url in (
            ("source", "source", source),
            ("target", "preflight", "http://localhost:9292/pages/customizer"),
            ("target", "online", target),
        ):
            with self.subTest(side=side, stage=stage):
                trace = {"navigation": {"kind": "internal", "requestedUrl": url,
                                        "finalUrl": url, "canonical": url,
                                        "redirectChain": [url]}}
                check_transition_navigation(edge, trace, side, stage, inventory)

    def test_internal_transition_rejects_source_domain_on_target(self):
        target = "https://target.example/pages/customizer"
        inventory = {"routes": {"destination": {
            "sourceUrl": "https://source.example/pages/customizer",
            "target": {"url": target, "finalUrl": target, "canonical": target,
                       "redirectChain": [target]},
        }}}
        edge = {"navigation": {"kind": "internal", "routeId": "destination"}}
        trace = {"navigation": {"kind": "internal",
                                "requestedUrl": "https://source.example/pages/customizer",
                                "finalUrl": "https://source.example/pages/customizer",
                                "canonical": "https://source.example/pages/customizer",
                                "redirectChain": ["https://source.example/pages/customizer"]}}
        with self.assertRaisesRegex(Invalid, "left the intended site"):
            check_transition_navigation(edge, trace, "target", "online", inventory)

    def test_internal_transition_rejects_same_page_or_home_fallback(self):
        target = "https://target.example/pages/customizer"
        inventory = {"routes": {"destination": {
            "sourceUrl": "https://source.example/pages/customizer",
            "target": {"url": target, "finalUrl": target, "canonical": target,
                       "redirectChain": [target]},
        }}}
        edge = {"navigation": {"kind": "internal", "routeId": "destination"}}
        for wrong in ("https://target.example/products/current", "https://target.example/"):
            with self.subTest(wrong=wrong), self.assertRaisesRegex(Invalid, "destination mismatch"):
                check_transition_navigation(edge, {"navigation": {
                    "kind": "internal", "requestedUrl": target, "finalUrl": wrong,
                    "canonical": wrong, "redirectChain": [target, wrong],
                }}, "target", "online", inventory)

    def test_internal_transition_rejects_wrong_canonical(self):
        target = "https://target.example/pages/customizer"
        inventory = {"routes": {"destination": {
            "sourceUrl": "https://source.example/pages/customizer",
            "target": {"url": target, "finalUrl": target, "canonical": target,
                       "redirectChain": [target]},
        }}}
        edge = {"navigation": {"kind": "internal", "routeId": "destination"}}
        trace = {"navigation": {"kind": "internal", "requestedUrl": target,
                                "finalUrl": target,
                                "canonical": "https://target.example/pages/other",
                                "redirectChain": [target]}}
        with self.assertRaisesRegex(Invalid, "canonical"):
            check_transition_navigation(edge, trace, "target", "online", inventory)

    def test_unplanned_navigation_trace_is_rejected(self):
        with self.assertRaisesRegex(Invalid, "unplanned transition navigation"):
            check_transition_navigation({}, {"navigation": {"kind": "internal"}},
                                        "target", "online", {"routes": {}})

    def test_unreachable_state(self):
        self.f.plan["routes"]["sample"]["states"]["unreachable"] = copy.deepcopy(self.f.plan["routes"]["sample"]["states"]["initial"])
        self.reject()

    def test_unknown_component(self):
        self.f.plan["routes"]["sample"]["states"]["initial"]["components"] = ["other"]
        self.reject()

    def test_unresolved_discovery(self):
        self.f.change(self.f.plan["analysis"], lambda x: x.update(unresolved=["missing tablet branch"]))
        self.reject()

    def test_no_adapter_blocks_acceptance_but_not_source(self):
        for stage in ("source", "online"):
            with tempfile.TemporaryDirectory() as root:
                result = Fixture(root, stage=stage, implementation="needs-adapter").run()
                self.assertEqual(bool(result), stage == "online")

    def test_malformed_values_fail_closed(self):
        for value in (None, [], "passed", 42):
            with self.subTest(value=value):
                self.assertTrue(validate(value, self.f.manifest, self.f.root))

    def test_mobile_only_interaction_plan(self):
        self.f.change(self.f.plan["analysis"], lambda x: x["routes"][0]["components"][0].update(
            interactionViewports=["mobile"], interactionViewportReason="drawer only appears on mobile; desktop is static"))
        rp = self.f.plan["routes"]["sample"]
        for nid, node in rp["states"].items():
            if nid != "initial":
                node.update(viewports=["mobile"], viewportReason="mobile drawer state")
        for node in rp["transitions"].values():
            node.update(viewports=["mobile"], viewportReason="mobile drawer interaction")
        from test_interaction_gates import add_interactions
        add_interactions(self.f)
        self.assertEqual(validate(self.f.plan, None, self.f.root), [])
        self.f.change(self.f.plan["analysis"], lambda x: x["routes"][0]["components"][0].pop("interactionViewportReason"))
        self.assertTrue(validate(self.f.plan, None, self.f.root))

    def test_nonfinite_unordered_value(self):
        from validate_evidence_coverage import compare
        with self.assertRaises(ValueError):
            compare({"operator": "unordered"}, [float("nan")], [float("nan")])

    def test_missing_negative_log(self):
        self.f.change(self.f.record()["negativeTests"]["visible-fields"], lambda x: x["log"].update(path="absent.log"))
        self.reject()

    def test_unplanned_extra_state(self):
        self.f.manifest["routes"]["sample"]["viewports"]["mobile"]["states"]["surprise"] = self.f.record()
        self.reject()

    def test_numeric_tolerance_requires_reason(self):
        from validate_evidence_coverage import compare, Invalid
        with self.assertRaises(Invalid):
            compare({"operator": "numeric", "tolerance": {"absolute": 100, "relative": .5}}, 42, 90)

    def test_bad_pointer_rejected_before_capture(self):
        for value in ("fields", "/a~b", "/a~2b", ""):
            plan = copy.deepcopy(self.f.plan)
            plan["routes"]["sample"]["states"]["initial"]["rules"][0]["targetPointer"] = value
            with self.subTest(value=value):
                self.assertTrue(validate(plan, None, self.f.root))

    def test_json_pointer_escapes(self):
        from validate_evidence_coverage import pointer
        self.assertEqual(pointer({"a/b": {"~key": 7}}, "/a~1b/~0key"), 7)

    def test_subscription_branch_field_loss(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = Fixture(root, scenario="subscription")
            fixture.change(fixture.record()["target"], lambda x: x["observations"].update(fields=["purchase-mode"]))
            self.assertTrue(any("states/configured: comparison failed: visible-fields" in error for error in fixture.run()))

    def test_blocked_record_reports_reason(self):
        self.f.record().update(status="blocked", reason="valid-upload permission unavailable")
        self.reject("record blocked: valid-upload permission unavailable")

    def test_failed_capture_cannot_be_accepted(self):
        self.f.change(self.f.record()["source"], lambda x: x.update(status="failed", reason="hydration timed out"))
        self.reject("capture failed: hydration timed out")

    def test_unordered_is_multiset_not_set(self):
        from validate_evidence_coverage import compare
        rule = {"operator": "unordered"}
        self.assertTrue(compare(rule, ["name", "photo", "photo"], ["photo", "name", "photo"]))
        self.assertFalse(compare(rule, ["name", "photo", "photo"], ["name", "photo"]))

    def test_numeric_comparison(self):
        from validate_evidence_coverage import compare, Invalid
        rule = {"operator": "numeric", "tolerance": {"absolute": 2, "relative": .01},
                "toleranceReason": "fixture source measurement variation"}
        self.assertTrue(compare(rule, 42, 43))
        self.assertFalse(compare(rule, 42, 50))
        for value in (True, float("nan"), float("inf"), "42"):
            with self.assertRaises(Invalid):
                compare(rule, 42, value)

    def test_cli_exit_code(self):
        script = Path(__file__).with_name("validate_evidence_coverage.py")
        ref = self.f.save(self.f.manifest)
        args = [sys.executable, "-B", str(script), str(self.f.root / ref["path"]),
                "--plan", str(self.f.root / "capture-plan.json"), "--stage", "online",
                "--build-id", "build-A", "--theme-id", "draft-A"]
        result = subprocess.run(args, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.f.manifest["routes"].clear()
        args[3] = str(self.f.root / self.f.save(self.f.manifest)["path"])
        result = subprocess.run(args, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
