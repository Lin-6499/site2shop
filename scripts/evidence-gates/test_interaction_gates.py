"""Synthetic non-Next interactions; not live-storefront evidence."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


def fields_for(scenario, state):
    if scenario == "subscription":
        return ["purchase-mode"] + (["billing-interval", "recurring-consent"]
                                     if state in ("configured", "invalid") else [])
    return ["option"] if state == "initial" else ["photo", "photo", "name", "name"]


def add_interactions(f):
    """Fixtures own invented controls; production exporters must discover real ones."""
    analysis = json.loads((f.root / f.plan["analysis"]["path"]).read_bytes())
    f.interaction_snapshots = {}
    for discovered in analysis["routes"]:
        rp = f.plan["routes"][discovered["id"]]
        items = []
        for sid, state in rp["states"].items():
            for vp in state.get("viewports", f.plan["viewports"]):
                edges = [(eid, edge) for eid, edge in rp["transitions"].items()
                         if edge["from"] == sid and vp in edge.get("viewports", f.plan["viewports"])]
                controls = []
                for eid, edge in edges:
                    controls.append({"id": eid, "componentId": "form", "role": "button",
                                     "label": "Synthetic control " + eid, "enabled": True, "events": ["activate"]})
                    edge["interaction"] = {"controlId": eid, "event": "activate", "effects": [{
                        "ruleId": "visible-fields", "kind": "unchanged" if
                        fields_for(rp["family"], edge["from"]) == fields_for(rp["family"], edge["to"]) else "changed",
                        "reason": "Synthetic field transition/retention only"}]}
                snapshot = {"stateId": sid, "viewport": vp, "controls": controls,
                            "evidence": f.save({"synthetic": True, "controls": controls})}
                if not controls:
                    snapshot["emptyReason"] = "Synthetic static or terminal state; no executable controls"
                items.append(snapshot)
                f.interaction_snapshots[(sid, vp)] = snapshot
        discovered["interactionInventory"] = f.save({"schemaVersion": 1, "routeId": discovered["id"],
            "collectorVersion": f.plan["collectorVersion"], "snapshots": items})
    f.plan["analysis"] = f.save(analysis)


def observation_controls(f, sid, vp):
    return [{key: c[key] for key in ("id", "role", "label", "enabled")}
            for c in f.interaction_snapshots[(sid, vp)]["controls"]]


class InteractionGateTests(unittest.TestCase):
    def setUp(self):
        from test_evidence_gates import Fixture
        self.temp = tempfile.TemporaryDirectory(prefix="interaction-gate-")
        self.addCleanup(self.temp.cleanup)
        self.f = Fixture(self.temp.name)

    def reject(self, text):
        errors = self.f.run()
        self.assertTrue(any(text in e for e in errors), errors)

    def mutate_inventory(self, change):
        def apply(analysis):
            self.f.change(analysis["routes"][0]["interactionInventory"], change)
        self.f.change(self.f.plan["analysis"], apply)

    def test_no_next_label_required(self):
        self.assertEqual(self.f.run(), [])

    def test_missing_independent_controls_rejected(self):
        self.f.change(self.f.plan["analysis"], lambda a: a["routes"][0].pop("interactionInventory"))
        self.reject("independent control inventory missing")

    def test_stale_inventory_rejected(self):
        self.mutate_inventory(lambda inv: inv.update(collectorVersion="old"))
        self.reject("stale control inventory")

    def test_newly_revealed_button_cannot_be_omitted(self):
        def extra(inv):
            item = next(n for n in inv["snapshots"] if n["stateId"] == "configured" and n["viewport"] == "mobile")
            item["controls"].append({"id": "details", "componentId": "form", "role": "button",
                "label": "View details", "enabled": True, "events": ["activate"]})
        self.mutate_inventory(extra)
        self.reject("control/event has no planned transition")

    def test_each_event_is_covered(self):
        self.mutate_inventory(lambda inv: inv["snapshots"][0]["controls"][0]["events"].append("hover"))
        self.reject("control/event has no planned transition")

    def test_missing_tablet_snapshot_rejected(self):
        self.mutate_inventory(lambda inv: inv["snapshots"].__setitem__(slice(None),
            [n for n in inv["snapshots"] if n["viewport"] != "tablet"]))
        self.reject("control snapshots differ")

    def test_click_without_effect_assertion_rejected(self):
        self.f.plan["routes"]["sample"]["transitions"]["continue"]["interaction"]["effects"] = []
        self.reject("post-action effects missing")

    def test_forged_success_cannot_hide_no_change(self):
        self.f.record("transitions", "continue")["status"] = "passed"
        edge = self.f.plan["routes"]["sample"]["transitions"]["continue"]
        edge["interaction"]["effects"][0]["kind"] = "unchanged"
        self.reject("expected unchanged post-action effect failed")

    def test_wrong_transition_snapshot_rejected(self):
        self.f.change(self.f.record("transitions", "continue")["target"],
                      lambda d: d["observations"].update(fields=["old-image"]))
        self.reject("transition result differs from captured after-state")

    def test_extra_target_control_after_action_rejected(self):
        self.f.change(self.f.record()["target"], lambda d: d["observations"]["interactionControls"].append(
            {"id": "unexpected", "role": "button", "label": "Extra", "enabled": True}))
        self.reject("missing/extra/changed control after action")

    def test_omitted_target_control_after_action_rejected(self):
        self.f.change(self.f.record()["target"], lambda d: d["observations"].update(interactionControls=[]))
        self.reject("missing/extra/changed control after action")

    def test_disabled_reason_not_implicit_coverage(self):
        self.mutate_inventory(lambda inv: inv["snapshots"][0]["controls"][0].update(enabled=False))
        self.reject("disabled control needs observed reason")

    def test_static_no_controls_requires_evidence_reason(self):
        from test_evidence_gates import Fixture
        with tempfile.TemporaryDirectory() as root:
            f = Fixture(root, "static")
            self.assertEqual(f.run(), [])
            f.change(f.plan["analysis"], lambda a: f.change(a["routes"][0]["interactionInventory"],
                lambda inv: inv["snapshots"][0].pop("emptyReason")))
            self.assertTrue(any("zero controls" in e for e in f.run()))

    def test_same_contract_handles_menu_filter_and_hover(self):
        # The protocol keys on observed event/expected effect, never a Next selector.
        for event in ("change", "hover", "submit", "swipe", "scroll"):
            from test_evidence_gates import Fixture
            with self.subTest(event=event), tempfile.TemporaryDirectory() as root:
                f = Fixture(root)
                for edge in f.plan["routes"]["sample"]["transitions"].values():
                    edge["interaction"]["event"] = event
                f.change(f.plan["analysis"], lambda a: f.change(a["routes"][0]["interactionInventory"],
                    lambda inv: [c.update(events=[event]) for n in inv["snapshots"] for c in n["controls"]]))
                self.assertEqual(f.run(), [])

    def test_main_gate_returns_nonzero_when_after_controls_missing(self):
        self.f.change(self.f.record()["target"], lambda d: d["observations"].update(interactionControls=[]))
        self.f.manifest["passed"] = True
        manifest = self.f.root / "coverage.json"
        manifest.write_text(json.dumps(self.f.manifest))
        result = subprocess.run([sys.executable, str(Path(__file__).with_name("validate_evidence_coverage.py")),
            str(manifest), "--plan", str(self.f.root / "capture-plan.json"), "--stage", "online",
            "--build-id", "build-A", "--theme-id", "draft-A"], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing/extra/changed control after action", result.stdout)
