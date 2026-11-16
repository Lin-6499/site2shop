"""Synthetic navigation regressions; these fixtures are not storefront acceptance evidence."""
import copy
import tempfile
import unittest

SOURCE = "https://source.example/products/sample"
TARGET = "https://target.example/products/sample"
WHEN = "2026-10-22T12:00:00+08:00"


def add_inventory(f):
    raw = f.save('<footer><a href="/products/sample">Example</a></footer>', '.html')
    f.inventory = {"schemaVersion": 1, "collectorVersion": "v1",
                   "sourceOrigins": ["https://source.example"], "targetOrigins": ["https://target.example"],
                   "surfaces": {}, "resolutions": {}, "routes": {
                       "sample": {"sourceUrl": SOURCE, "family": f.plan["routes"]["sample"]["family"],
                                  "captureRouteId": "sample", "target": {"url": TARGET, "finalUrl": TARGET,
                                  "canonical": TARGET, "kind": "product", "templateSuffix": "custom",
                                  "redirectChain": [TARGET]}}}}
    f.analysis["navigationSurfaces"] = []
    for vp in f.plan["viewports"]:
        sid = "footer-" + vp
        identity = {"id": sid, "url": "https://source.example/", "region": "footer", "viewport": vp, "state": "expanded",
                    "target": {"url": "https://target.example/", "canonical": "https://target.example/"}}
        f.analysis["navigationSurfaces"].append(identity)
        f.inventory["surfaces"][sid] = f.save({**identity, "collectorVersion": "v1", "capturedAt": WHEN,
            "complete": True, "httpStatus": 200, "pageKind": "content", "soft404": False,
            "finalUrl": identity["url"], "canonical": identity["url"], "artifact": raw,
            "links": [{"id": "primary", "href": "/products/sample"}]})
        f.inventory["resolutions"][sid + ":primary"] = {"action": "map", "routeId": "sample"}
    f.plan["analysis"] = f.save(f.analysis)
    f.plan["routeInventory"] = f.save(f.inventory)


def add_navigation_coverage(f):
    raw = f.save('<footer><a href="/products/sample">Example</a></footer>', '.html')
    f.navigation = {"schemaVersion": 1, "inventorySha256": f.plan["routeInventory"]["sha256"],
                    "stage": f.stage, "buildId": "build-A", "themeId": "draft-A", "surfaces": {},
                    "routes": {"sample": {}}}
    for vp, dims in f.plan["viewports"].items():
        f.navigation["surfaces"]["footer-" + vp] = f.save({"buildId": "build-A", "themeId": "draft-A",
            "viewport": vp, "state": "expanded", "capturedAt": WHEN, "url": "https://target.example/",
            "finalUrl": "https://target.example/", "canonical": "https://target.example/",
            "httpStatus": 200, "pageKind": "content", "soft404": False,
            "artifact": raw, "links": [{"id": "primary", "href": "/products/sample"}]})
        f.navigation["routes"]["sample"][vp] = f.save({"buildId": "build-A", "themeId": "draft-A",
            "viewport": {"name": vp, **dims}, "capturedAt": WHEN, "httpStatus": 200, "pageKind": "content",
            "soft404": False, "requestedUrl": TARGET, "finalUrl": TARGET, "canonical": TARGET,
            "redirectChain": [TARGET], "artifact": raw, "binding": {"id": "target-resource-1", "kind": "product",
                "url": TARGET, "readBack": True, "published": True, "templateSuffix": "custom"}})
    f.manifest["navigation"] = f.save(f.navigation)


class NavigationGateTests(unittest.TestCase):
    def setUp(self):
        from test_evidence_gates import Fixture
        self.temp = tempfile.TemporaryDirectory(prefix="navigation-gate-test-")
        self.addCleanup(self.temp.cleanup)
        self.f = Fixture(self.temp.name, scenario="static")

    def reject(self, message):
        errors = self.f.run()
        self.assertTrue(any(message in e for e in errors), errors)

    def inventory(self):
        self.f.plan["routeInventory"] = self.f.save(self.f.inventory)
        self.f.navigation["inventorySha256"] = self.f.plan["routeInventory"]["sha256"]
        self.report()

    def report(self):
        self.f.manifest["navigation"] = self.f.save(self.f.navigation)

    def probe(self, **changes):
        self.f.change(self.f.navigation["routes"]["sample"]["mobile"], lambda d: d.update(changes))
        self.report()

    def binding(self, **changes):
        self.f.change(self.f.navigation["routes"]["sample"]["mobile"], lambda d: d["binding"].update(changes))
        self.report()

    def test_legacy_plan_without_inventory_is_blocked(self):
        del self.f.plan["routeInventory"]
        self.reject("artifact reference required")

    def test_missing_independent_surface_plan(self):
        self.f.change(self.f.plan["analysis"], lambda a: a.pop("navigationSurfaces"))
        self.reject("independently planned navigation surfaces missing")

    def test_sitemap_absence_does_not_hide_rendered_link(self):
        self.f.change(self.f.inventory["surfaces"]["footer-mobile"], lambda s: s["links"].append(
            {"id": "missing-from-sitemap", "href": "/catalog/unindexed-item"}))
        self.inventory()
        self.reject("every extracted link needs a disposition")

    def test_missing_mobile_surface(self):
        del self.f.inventory["surfaces"]["footer-mobile"]
        self.inventory()
        self.reject("surface inventory differs")

    def test_internal_url_cannot_hide_as_action(self):
        self.f.inventory["resolutions"]["footer-mobile:primary"] = {"action": "interaction"}
        self.inventory()
        self.reject("internal landing URL cannot be classified")

    def test_internal_link_without_resource_mapping(self):
        self.f.inventory["routes"].clear()
        self.inventory()
        self.reject("link missing target resource plan")

    def test_missing_generated_link(self):
        self.f.change(self.f.navigation["surfaces"]["footer-mobile"], lambda d: d.update(links=[]))
        self.report()
        self.reject("generated links missing")

    def test_link_to_original_store(self):
        self.f.change(self.f.navigation["surfaces"]["footer-mobile"], lambda d: d["links"][0].update(href=SOURCE))
        self.report()
        self.reject("generated link points to wrong destination")

    def test_missing_target_route(self):
        self.f.navigation["routes"].clear()
        self.report()
        self.reject("every mapped destination needs a route smoke check")

    def test_missing_target_viewport(self):
        del self.f.navigation["routes"]["sample"]["tablet"]
        self.report()
        self.reject("route viewport coverage missing")

    def test_http_404(self):
        self.probe(httpStatus=404)
        self.reject("non-success route")

    def test_soft_404_with_200_and_pass_flag(self):
        self.probe(soft404=True, passed=True)
        self.reject("not verified content")

    def test_password_and_challenge_are_not_content(self):
        for kind in ("password", "challenge", "access-denied"):
            self.probe(pageKind=kind)
            self.reject("not verified content")

    def test_unlock_redirect_to_home(self):
        self.probe(finalUrl="https://target.example/")
        self.reject("route probe mismatch")

    def test_wrong_canonical(self):
        self.probe(canonical="https://target.example/404")
        self.reject("route probe mismatch")

    def test_unexpected_redirect(self):
        self.probe(redirectChain=[TARGET, "https://target.example/", TARGET])
        self.reject("unexpected redirect chain")

    def test_declared_redirect_cycle(self):
        self.f.inventory["routes"]["sample"]["target"]["redirectChain"] = [TARGET, TARGET]
        self.inventory()
        self.reject("redirect cycle")

    def test_page_binding_cannot_satisfy_policy_resource(self):
        self.f.inventory["routes"]["sample"]["target"]["kind"] = "policy"
        for ref in self.f.navigation["routes"]["sample"].values():
            self.f.change(ref, lambda d: d["binding"].update(kind="policy"))
        self.inventory()
        self.binding(kind="page")
        self.reject("wrong resource kind")

    def test_binding_url_must_match_landing_url(self):
        self.binding(url="https://target.example/pages/sample")
        self.reject("bound resource does not own")

    def test_created_but_unpublished_resource(self):
        self.binding(published=False)
        self.reject("resource unavailable or not read back")

    def test_no_resource_readback(self):
        self.binding(readBack=False)
        self.reject("resource unavailable or not read back")

    def test_wrong_template(self):
        self.binding(templateSuffix=None)
        self.reject("wrong resource template")

    def test_wrong_theme_and_stale_build(self):
        self.probe(themeId="live")
        self.reject("wrong route probe theme")
        self.probe(themeId="draft-A", buildId="old")
        self.reject("stale/wrong route probe identity")

    def test_meaningful_query_is_not_discarded(self):
        self.f.change(self.f.navigation["surfaces"]["footer-mobile"], lambda d: d["links"][0].update(href="/products/sample?variant=wrong"))
        self.report()
        self.reject("generated link points to wrong destination")

    def test_missing_navigation_report(self):
        del self.f.manifest["navigation"]
        self.reject("artifact reference required")

    def test_tampered_navigation_artifact(self):
        ref = self.f.navigation["routes"]["sample"]["mobile"]
        (self.f.root / ref["path"]).write_text("{}")
        self.reject("artifact hash mismatch")

    def test_source_broken_removal_requires_evidence_and_removes_link(self):
        proof = self.f.save({"httpStatus": 404, "pageKind": "not-found", "requestedUrl": SOURCE,
                             "capturedAt": WHEN, "artifact": self.f.save("Observed missing route", ".html")})
        for item in self.f.inventory["resolutions"].values():
            item.clear()
            item.update(action="remove", decision={"basis": "source-broken", "reason": "Observed retired source route", "evidence": proof})
        self.f.inventory["routes"].clear()
        self.f.navigation["routes"].clear()
        self.inventory()
        self.reject("removed link still visible")
        for ref in self.f.navigation["surfaces"].values():
            self.f.change(ref, lambda d: d.update(links=[]))
        self.report()
        self.assertEqual(self.f.run(), [])
        self.f.change(proof, lambda d: d.update(pageKind="challenge", httpStatus=403))
        self.inventory()
        self.reject("not a broken source")

    def test_scoped_query_ignored_with_independent_theme_check(self):
        self.f.inventory["ignoredQueryKeys"] = {"preview_theme_id": "Verified independently by themeId in online probes"}
        self.inventory()
        self.probe(requestedUrl=TARGET + "?preview_theme_id=draft-A")
        self.assertEqual(self.f.run(), [])

    def test_source_scope_and_target_policy_can_differ(self):
        new_source = "https://source.example/legal/shipping.html"
        new_target = "https://target.example/policies/shipping-policy"
        self.f.inventory["routes"]["sample"]["sourceUrl"] = new_source
        self.f.inventory["routes"]["sample"]["target"].update(url=new_target, finalUrl=new_target,
            canonical=new_target, kind="policy", redirectChain=[new_target])
        self.f.plan["routes"]["sample"]["source"].update(url=new_source, canonical=new_source)
        self.f.plan["routes"]["sample"]["target"].update(url=new_target, canonical=new_target)
        self.f.change(self.f.plan["analysis"], lambda a: a["routes"][0].update(url=new_source))
        for ref in self.f.inventory["surfaces"].values():
            self.f.change(ref, lambda d: d["links"][0].update(href=new_source))
        for ref in self.f.navigation["surfaces"].values():
            self.f.change(ref, lambda d: d["links"][0].update(href=new_target))
        for ref in self.f.navigation["routes"]["sample"].values():
            def change_probe(d):
                d.update(requestedUrl=new_target, finalUrl=new_target, canonical=new_target, redirectChain=[new_target])
                d["binding"].update(kind="policy", url=new_target)
            self.f.change(ref, change_probe)
        for records in self.f.manifest["routes"]["sample"]["viewports"].values():
            for record in records["states"].values():
                for side, url in (("source", new_source), ("target", new_target)):
                    self.f.change(record[side], lambda d, url=url: d.update(requestedUrl=url, finalUrl=url, canonical=url))
        self.inventory()
        self.assertEqual(self.f.run(), [])

    def test_declared_alias_redirect_can_pass(self):
        alias = "https://target.example/old/sample"
        mapping = self.f.inventory["routes"]["sample"]
        mapping["target"].update(url=alias, redirectChain=[alias, TARGET])
        mapping["decision"] = {"basis": "approved-change", "reason": "Preserve an inbound alias to its verified replacement",
                               "evidence": self.f.save({"mapping": [alias, TARGET], "basis": "synthetic decision"})}
        for ref in self.f.navigation["surfaces"].values():
            self.f.change(ref, lambda d: d["links"][0].update(href=alias))
        for ref in self.f.navigation["routes"]["sample"].values():
            self.f.change(ref, lambda d: d.update(requestedUrl=alias, redirectChain=[alias, TARGET]))
        self.inventory()
        self.assertEqual(self.f.run(), [])

    def test_generated_surface_is_not_a_password_page(self):
        self.f.change(self.f.navigation["surfaces"]["footer-mobile"], lambda d: d.update(pageKind="password"))
        self.report()
        self.reject("not verified content")

    def test_generated_surface_wrong_route(self):
        self.f.change(self.f.navigation["surfaces"]["footer-mobile"], lambda d: d.update(finalUrl=TARGET))
        self.report()
        self.reject("generated surface route/canonical mismatch")

    def test_sitemap_only_route_still_requires_target_probe(self):
        surface = {"id": "sitemap", "url": "https://source.example/sitemap.xml", "region": "sitemap",
                   "viewport": "none", "state": "index"}
        self.f.change(self.f.plan["analysis"], lambda a: a["navigationSurfaces"].append(surface))
        snapshot = {**surface, "collectorVersion": "v1", "capturedAt": WHEN, "complete": True,
                    "httpStatus": 200, "pageKind": "content", "soft404": False,
                    "finalUrl": surface["url"], "canonical": surface["url"],
                    "artifact": self.f.save("<urlset>synthetic sitemap</urlset>", ".xml"),
                    "links": [{"id": "sitemap-only", "href": "/catalog/another"}]}
        self.f.inventory["surfaces"]["sitemap"] = self.f.save(snapshot)
        self.f.inventory["resolutions"]["sitemap:sitemap-only"] = {"action": "map", "routeId": "another"}
        mapping = copy.deepcopy(self.f.inventory["routes"]["sample"])
        mapping.update(sourceUrl="https://source.example/catalog/another", samplingRationale="same measured family; distinct route check")
        another = "https://target.example/products/another"
        mapping["target"].update(url=another, finalUrl=another, canonical=another, redirectChain=[another])
        self.f.inventory["routes"]["another"] = mapping
        self.inventory()
        self.reject("every mapped destination needs a route smoke check")

    def test_intentional_external_service_can_pass(self):
        external = "https://service.example/help"
        for ref in self.f.inventory["surfaces"].values():
            self.f.change(ref, lambda d: d["links"][0].update(href=external))
        for item in self.f.inventory["resolutions"].values():
            item.clear()
            item.update(action="retain-external")
        self.f.inventory["routes"].clear()
        self.f.navigation["routes"].clear()
        for ref in self.f.navigation["surfaces"].values():
            self.f.change(ref, lambda d: d["links"][0].update(href=external))
        self.inventory()
        self.assertEqual(self.f.run(), [])

    def test_source_host_retained_without_decision_is_blocked(self):
        self.f.inventory["resolutions"]["footer-mobile:primary"] = {"action": "retain-external"}
        self.inventory()
        self.reject("nonempty string required")

    def test_app_without_resource_owner_is_blocked(self):
        self.f.inventory["routes"]["sample"]["target"]["kind"] = "app"
        for ref in self.f.navigation["routes"]["sample"].values():
            self.f.change(ref, lambda d: d["binding"].update(kind="app"))
        self.inventory()
        self.binding(kind="app", id=None)
        self.reject("nonempty string required")

    def test_source_failure_from_unrelated_url_cannot_remove_link(self):
        proof = self.f.save({"httpStatus": 404, "pageKind": "not-found", "requestedUrl": "https://source.example/unrelated",
                             "capturedAt": WHEN, "artifact": self.f.save("source 404", ".html")})
        self.f.inventory["resolutions"]["footer-mobile:primary"] = {"action": "remove", "decision": {
            "basis": "source-broken", "reason": "fixture", "evidence": proof}}
        self.inventory()
        self.reject("source failure evidence belongs to another route")

    def test_local_preflight_mapping(self):
        f = self.f
        f.stage = "preflight"
        f.manifest["stage"] = f.navigation["stage"] = "preflight"
        local = "http://localhost:4000/products/sample"
        f.plan["routes"]["sample"]["localTarget"] = {"url": local, "canonical": local}
        f.inventory["routes"]["sample"]["localTarget"] = {"url": local, "finalUrl": local,
                                                             "canonical": local, "redirectChain": [local]}
        f.change(f.plan["analysis"], lambda a: [s.update(localTarget={"url": "http://localhost:4000/",
            "canonical": "http://localhost:4000/"}) for s in a["navigationSurfaces"]])
        for ref in f.navigation["surfaces"].values():
            f.change(ref, lambda d: d.update(url="http://localhost:4000/", finalUrl="http://localhost:4000/",
                                             canonical="http://localhost:4000/"))
        for ref in f.navigation["routes"]["sample"].values():
            f.change(ref, lambda d: d.update(requestedUrl=local, finalUrl=local, canonical=local, redirectChain=[local]))
        for records in f.manifest["routes"]["sample"]["viewports"].values():
            for record in records["states"].values():
                f.change(record["target"], lambda d: d.update(requestedUrl=local, finalUrl=local, canonical=local))
        self.inventory()
        self.assertEqual(f.run(), [])

    def test_cli_blocks_missing_inventory(self):
        import subprocess
        import sys
        from pathlib import Path
        del self.f.plan["routeInventory"]
        self.f.seal()
        result = subprocess.run([sys.executable, "-B", str(Path(__file__).with_name("validate_evidence_coverage.py")),
            "--plan", str(self.f.root / "capture-plan.json")], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("artifact reference required", result.stdout)


if __name__ == "__main__":
    unittest.main()
