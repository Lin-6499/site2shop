#!/usr/bin/env python3
"""Read-only, plan-driven evidence validation. No browser or authenticity claims."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
import unittest
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

from route_integrity import check_inventory, check_coverage, url_key, origin
from presentation_integrity import profile, check_node, check_measurements, check_bindings, check_context
from interaction_integrity import check_plan as check_interaction_plan, check_capture as check_interaction_capture

VERSION = 2
FORM_FACTORS = {"desktop", "tablet", "mobile"}
FAILURE_STATUSES = {"blocked", "failed", "missing", "invalid", "timeout"}


class Invalid(ValueError):
    pass


def require(ok, message):
    if not ok:
        raise Invalid(message)


def obj(value):
    require(isinstance(value, dict), "expected object")
    return value


def string(value):
    require(isinstance(value, str) and bool(value.strip()), "expected nonempty string")
    return value


def numeric(value):
    require(type(value) in (float, int) and math.isfinite(value), "expected finite number")
    return value


def ids(values):
    require(isinstance(values, list), "expected array")
    result = {}
    for value in values:
        key = string(obj(value).get("id"))
        require(key not in result, f"duplicate id: {key}")
        result[key] = value
    return result


def artifact(ref, root, *, parse=True):
    ref = obj(ref)
    relative = Path(string(ref.get("path")))
    require(not relative.is_absolute(), "artifact path must be relative")
    path = (root / relative).resolve()
    require(path.is_relative_to(root.resolve()), "artifact escapes evidence root")
    require(path.is_file(), f"artifact missing: {relative}")
    data = path.read_bytes()
    digest = string(ref.get("sha256"))
    require(re.fullmatch(r"[a-f0-9]{64}", digest), "invalid artifact hash")
    require(bool(data) and hashlib.sha256(data).hexdigest() == digest,
            f"artifact hash mismatch or empty: {relative}")
    return json.loads(data) if parse else data


def route(url):
    u = urlsplit(string(url))
    require(u.scheme in ("http", "https") and u.hostname and not u.username and not u.password,
            "invalid route URL")
    path = u.path.rstrip("/") or "/"
    require(not re.search(r"/(password|challenge|checkpoint)(/|$)", path, re.I),
            "interstitial route is not evidence")
    return u.scheme, u.netloc.lower(), path


def timestamp(value):
    require(datetime.fromisoformat(string(value).replace("Z", "+00:00")).tzinfo is not None,
            "capture/test timestamp must include timezone")


def pointer_syntax(path):
    require(isinstance(path, str) and path.startswith("/") and not re.search(r"~(?![01])", path),
            "expected non-root JSON pointer with valid escapes")


def pointer(value, path):
    pointer_syntax(path)
    for part in path[1:].split("/"):
        part = part.replace("~1", "/").replace("~0", "~")
        value = value[int(part)] if isinstance(value, list) else obj(value)[part]
    require(value is not None, f"null observation: {path}")
    return value


def compare(rule, source, target):
    op = rule["operator"]
    if op == "numeric":
        tolerance = obj(rule["tolerance"])
        absolute, relative = numeric(tolerance["absolute"]), numeric(tolerance["relative"])
        require(absolute >= 0 and relative >= 0, "negative tolerance")
        string(rule.get("toleranceReason"))
        return abs(numeric(source) - numeric(target)) <= max(absolute, abs(source) * relative)
    if op == "unordered":
        require(isinstance(source, list) and isinstance(target, list), "unordered needs arrays")
        # A multiset, not a set: two upload controls must not equal one.
        return sorted(json.dumps(x, sort_keys=True, allow_nan=False) for x in source) == sorted(
            json.dumps(x, sort_keys=True, allow_nan=False) for x in target)
    require(op == "equal", "unsupported comparator")
    return json.dumps(source, sort_keys=True, allow_nan=False) == json.dumps(
        target, sort_keys=True, allow_nan=False)


def node_viewports(node, viewports):
    node = obj(node)
    value = node.get("viewports", list(viewports))
    require(isinstance(value, list) and value and all(isinstance(x, str) for x in value),
            "node viewports must be a nonempty list")
    require(len(value) == len(set(value)) and set(value) <= set(viewports), "invalid node viewports")
    if set(value) != set(viewports):
        string(node.get("viewportReason"))
    return set(value)


def interaction_viewports(component, viewports):
    if not component["interactive"]:
        require(not component.get("interactionViewports"), "noninteractive component declares interaction viewports")
        return set()
    return node_viewports({"viewports": component.get("interactionViewports", list(viewports)),
                           "viewportReason": component.get("interactionViewportReason")}, viewports)


def check_plan(plan, root):
    obj(plan)
    require(plan.get("schemaVersion") == VERSION, "plan requires schemaVersion 2; recapture legacy evidence")
    for key in ("planId", "contractVersion", "collectorVersion"):
        string(plan.get(key))
    require(type(plan.get("revision")) is int and plan["revision"] > 0, "invalid plan revision")
    viewports = obj(plan["viewports"])
    require(FORM_FACTORS <= set(viewports), "plan missing required form factor")
    for vp in viewports.values():
        for axis in ("width", "height"):
            require(type(obj(vp).get(axis)) is int and vp[axis] > 0, "invalid viewport size")
    for limit in ("maxActionsPerRoute", "maxMinutesPerRoute"):
        require(numeric(obj(plan["limits"])[limit]) > 0, "invalid discovery budget")
    analysis = obj(artifact(plan["analysis"], root))
    require(analysis.get("schemaVersion") == 1, "unsupported analysis schema")
    require(analysis.get("unresolved") == [], "reconnaissance has unresolved capture requirements")
    platform = obj(analysis["platform"])
    string(platform["name"])
    string(platform["confidence"])
    artifact(platform["evidence"], root, parse=False)
    capabilities = ids(analysis["capabilities"])
    require(bool(capabilities), "capability inventory missing")
    for capability in capabilities.values():
        require(capability.get("capture") == "supported", "capture adapter unavailable")
        require(capability.get("implementation") in ("supported", "needs-adapter", "unknown"),
                "invalid implementation capability")
        artifact(capability["evidence"], root, parse=False)
    discovered = ids(analysis["routes"])
    routes = obj(plan["routes"])
    require(bool(routes) and set(routes) == set(discovered), "planned/discovered route inventory mismatch")
    if "requiredRouteExpansion" in plan:
        expansion = obj(artifact(plan["requiredRouteExpansion"], root))
        required_routes = ids(expansion["routes"])
        require(set(required_routes) == set(routes),
                "required route expansion has not been reconciled into executable route/state plans")
        for rid, required_route in required_routes.items():
            require(route(routes[rid]["source"]["url"]) == route(required_route["source"]) and
                    route(routes[rid]["target"]["url"]) == route(required_route["target"]),
                    "expanded route resource mapping changed")
            require(set(required_route["devices"]) == set(viewports),
                    "expanded route lacks required form factors")
    inventory, _, _ = check_inventory(plan, analysis, root)
    for rid, rp in routes.items():
        rp = obj(rp)
        string(rp["family"])
        string(rp["samplingRationale"])
        require(rp["family"] == discovered[rid]["family"], "family identity mismatch")
        require(route(rp["source"]["url"]) == route(discovered[rid]["url"]), "source route changed")
        for side in ("source", "target") + (("localTarget",) if "localTarget" in rp else ()):
            route(rp[side]["url"])
            route(rp[side]["canonical"])
        components = ids(discovered[rid]["components"])
        require(bool(components), "component inventory missing")
        for component in components.values():
            require(type(component.get("interactive")) is bool, "component interactive flag missing")
            interaction_viewports(component, viewports)
            artifact(component["evidence"], root, parse=False)
            profile(component)
        states, transitions = obj(rp["states"]), obj(rp["transitions"])
        require("initial" in states and node_viewports(states["initial"], viewports) == set(viewports),
                "initial state missing a viewport")
        for kind, nodes in (("states", states), ("transitions", transitions)):
            for nid, node in nodes.items():
                string(nid)
                node = obj(node)
                node_viewports(node, viewports)
                assigned = node["components"]
                require(isinstance(assigned, list) and assigned and set(assigned) <= set(components),
                        "node component mapping missing or unknown")
                rules = ids(node["rules"])
                require(bool(rules), "node must have assertions")
                for rule in rules.values():
                    require(rule.get("operator") in ("equal", "unordered", "numeric"), "invalid operator")
                    for key in ("sourcePointer", "targetPointer", "negativeTest"):
                        string(rule.get(key))
                    pointer_syntax(rule["sourcePointer"])
                    pointer_syntax(rule["targetPointer"])
                    if rule["operator"] == "numeric":
                        compare(rule, 0, 0)
                check_node(components, node)
                if kind == "transitions":
                    require(node["from"] in states and node["to"] in states, "unknown transition endpoint")
                    string(node["action"])
                    string(node["condition"])
                    if "navigation" in node:
                        navigation = obj(node["navigation"])
                        require(navigation.get("kind") == "internal", "unsupported transition navigation kind")
                        require(navigation.get("routeId") in inventory["routes"],
                                "internal transition destination is not in the route inventory")
                    for endpoint in (node["from"], node["to"]):
                        require(node_viewports(node, viewports) <= node_viewports(states[endpoint], viewports),
                                "transition endpoint unavailable at viewport")
        for vp in viewports:
            active_states = {k: v for k, v in states.items() if vp in node_viewports(v, viewports)}
            active_edges = {k: v for k, v in transitions.items() if vp in node_viewports(v, viewports)}
            covered = {c for n in [*active_states.values(), *active_edges.values()] for c in n["components"]}
            require(covered == set(components), f"component coverage missing at {vp}")
            interactive = {c for n in active_edges.values() for c in n["components"]}
            require(all(vp not in interaction_viewports(c, viewports) or cid in interactive for cid, c in components.items()),
                    f"interactive component without probe at {vp}")
            reached = {"initial"}
            for _ in active_states:
                reached |= {e["to"] for e in active_edges.values() if e["from"] in reached}
            require(reached == set(active_states), f"unreachable planned state at {vp}")
    check_interaction_plan(plan, root, artifact, node_viewports)
    return analysis, inventory


def check_transition_navigation(edge, trace, side, stage, inventory):
    """Validate a planned cross-route action against the source/target resource mapping."""
    planned = edge.get("navigation")
    if planned is None:
        require("navigation" not in trace, "unplanned transition navigation")
        return
    planned = obj(planned)
    require(planned.get("kind") == "internal", "unsupported transition navigation kind")
    mapping = obj(inventory["routes"][planned["routeId"]])
    observed = obj(trace.get("navigation"))
    require(observed.get("kind") == "internal", "internal transition navigation evidence missing")
    chain = observed.get("redirectChain")
    require(isinstance(chain, list) and chain, "transition redirect chain missing")
    if side == "source":
        expected_requested = expected_final = expected_canonical = mapping["sourceUrl"]
        expected_chain = [mapping["sourceUrl"]]
        expected_origin = origin(mapping["sourceUrl"])
    else:
        location = mapping.get("localTarget", mapping["target"]) if stage == "preflight" else mapping["target"]
        expected_requested, expected_final, expected_canonical = (
            location["url"], location["finalUrl"], location["canonical"])
        expected_chain = location["redirectChain"]
        expected_origin = origin(location["finalUrl"])
    require(origin(observed["finalUrl"]) == expected_origin,
            "internal transition left the intended site")
    for actual, expected, label in (
        (observed["requestedUrl"], expected_requested, "requestedUrl"),
        (observed["finalUrl"], expected_final, "finalUrl"),
        (observed["canonical"], expected_canonical, "canonical"),
    ):
        require(url_key(actual) == url_key(expected), f"transition destination mismatch: {label}")
    require([url_key(value) for value in chain] == [url_key(value) for value in expected_chain],
            "transition redirect chain mismatch")


def capture(ref, root, plan, rid, vp, kind, nid, side, stage, build_id, theme_id,
            endpoints=None, inventory=None, source_plan=None):
    data = obj(artifact(ref, root))
    require(data.get("status") not in FAILURE_STATUSES,
            f"capture {data.get('status')}: {data.get('reason', 'reason not supplied')}")
    expected = {"schemaVersion": VERSION, "routeId": rid, "kind": kind, "nodeId": nid, "side": side}
    identity_plan = source_plan if side == "source" and source_plan is not None else plan
    expected.update({k: identity_plan[k] for k in ("planId", "revision", "contractVersion", "collectorVersion")})
    expected["viewport"] = {"name": vp, **plan["viewports"][vp]}
    for key, value in expected.items():
        require(data.get(key) == value, f"capture identity mismatch: {key}")
    timestamp(data["capturedAt"])
    require(type(data.get("httpStatus")) is int and 200 <= data["httpStatus"] < 300, "non-success page")
    require(data.get("pageKind") == "content", "password/challenge/interstitial is not evidence")
    route_plan = plan["routes"][rid]
    location = route_plan.get("localTarget", route_plan["target"]) if side == "target" and stage == "preflight" else route_plan[side]
    require(route(data["requestedUrl"]) == route(location["url"]) and
            route(data["finalUrl"]) == route(location["url"]) and
            route(data["canonical"]) == route(location["canonical"]), "route/canonical mismatch")
    if side == "target":
        require(data.get("buildId") == build_id, "stale target build")
        if stage == "online":
            require(data.get("themeId") == theme_id, "wrong preview theme")
    assets = obj(data["artifacts"])
    if kind == "states":
        artifact(assets["dom"], root, parse=False)
        artifact(assets["screenshot"], root, parse=False)
    else:
        trace = obj(artifact(assets["trace"], root))
        edge = route_plan[kind][nid]
        for key in ("from", "to", "action", "condition"):
            require(trace.get(key) == edge[key], f"transition trace mismatch: {key}")
        require(trace.get("status") == "performed", "transition not performed")
        check_transition_navigation(edge, trace, side, stage, inventory)
        require(trace.get("beforeArtifactHash") == endpoints[edge["from"]][side]["sha256"] and
                trace.get("afterArtifactHash") == endpoints[edge["to"]][side]["sha256"],
                "transition endpoint evidence mismatch")
    return obj(data["observations"])


def validate(plan, manifest, root, *, plan_sha256=None, stage="source", build_id=None, theme_id=None,
             diagnostic_continue_after_route_integrity=False, route_ids=None):
    errors = []
    try:
        root = Path(root)
        analysis, inventory = check_plan(plan, root)
        if manifest is None:
            return []
        obj(manifest)
        require(stage in ("source", "preflight", "online"), "invalid gate stage")
        require(manifest.get("schemaVersion") == VERSION, "coverage requires schemaVersion 2")
        require(bool(plan_sha256) and manifest.get("planSha256") == plan_sha256, "stale/missing plan hash")
        require(manifest.get("stage") == stage, "gate stage mismatch")
        if stage != "source":
            require(bool(build_id) and manifest.get("buildId") == build_id, "expected build identity required")
            require(all(c["implementation"] == "supported" for c in analysis["capabilities"]),
                    "implementation adapter unavailable")
        if stage == "online":
            require(bool(theme_id) and manifest.get("themeId") == theme_id, "expected theme identity required")
        selected = set(route_ids) if route_ids is not None else set(plan["routes"])
        require(bool(selected) and selected <= set(plan["routes"]), "invalid scoped route inventory")
        if route_ids is not None:
            require(stage != "source" and manifest.get("incremental", {}).get("routeIds") == sorted(selected), "scoped evidence must explicitly declare its partial coverage")
        elif diagnostic_continue_after_route_integrity:
            try:
                check_coverage(plan, analysis, manifest, root, stage, build_id, theme_id)
            except (KeyError, ValueError, TypeError, IndexError, OSError, AttributeError) as exc:
                errors.append(f"route integrity (diagnostic continuation): {exc}")
        else:
            check_coverage(plan, analysis, manifest, root, stage, build_id, theme_id)
        result_routes = obj(manifest["routes"])
        require(set(result_routes) == selected, "route coverage differs from plan")
        for rid, rp in plan["routes"].items():
            if rid not in selected:
                continue
            components = ids(next(r for r in analysis["routes"] if r["id"] == rid)["components"])
            results = obj(result_routes[rid]["viewports"])
            require(set(results) == set(plan["viewports"]), f"{rid}: viewport coverage differs from plan")
            for vp, result in results.items():
                source_plan = None
                if result.get("sourceProvenance"):
                    from source_capture_contract import source_capture_contract
                    source_plan = artifact(result["sourceProvenance"], root)
                    source_analysis = artifact(source_plan["analysis"], root)
                    require(source_capture_contract(source_plan, source_analysis, rid, vp) ==
                            source_capture_contract(plan, analysis, rid, vp), "source provenance contract changed")
                for kind in ("states", "transitions"):
                    records = obj(result[kind])
                    required = {nid for nid, node in rp[kind].items() if vp in node_viewports(node, plan["viewports"])}
                    require(set(records) == required, f"{rid}/{vp}/{kind}: inventory differs from plan")
                    for nid in required:
                        prefix = f"{rid}/{vp}/{kind}/{nid}"
                        try:
                            record, node = obj(records[nid]), rp[kind][nid]
                            require(record.get("status") not in FAILURE_STATUSES,
                                    f"record {record.get('status')}: {record.get('reason', 'reason not supplied')}")
                            observations = {}
                            for side in (("source",) if stage == "source" else ("source", "target")):
                                observations[side] = capture(record[side], root, plan, rid, vp, kind, nid,
                                                            side, stage, build_id, theme_id, result["states"], inventory, source_plan)
                                check_measurements(observations[side], components, node, side)
                            check_context(observations, components, node, plan["viewports"][vp])
                            check_interaction_capture(plan, root, rid, vp, kind, nid, observations, result["states"], artifact, pointer, compare)
                            if stage != "source":
                                check_bindings(record, components, node, root, artifact)
                            for rule in node["rules"]:
                                s = pointer(observations["source"], rule["sourcePointer"])
                                require(compare(rule, s, s), f"invalid source value: {rule['id']}")
                                if stage != "source":
                                    t = pointer(observations["target"], rule["targetPointer"])
                                    require(compare(rule, s, t), f"comparison failed: {rule['id']}")
                                    proof = obj(artifact(record["negativeTests"][rule["id"]], root))
                                    require(proof.get("id") == rule["negativeTest"] and proof.get("ruleId") == rule["id"] and
                                            proof.get("planSha256") == plan_sha256 and proof.get("buildId") == build_id and
                                            proof.get("status") == "passed", "negative test proof mismatch")
                                    require(set(proof["rejectedMutations"]) >= {"missing-source", "missing-target", "mismatch"},
                                            "negative test coverage missing")
                                    timestamp(proof["executedAt"])
                                    string(proof["runner"])
                                    artifact(proof["log"], root, parse=False)
                        except (KeyError, ValueError, TypeError, IndexError, OSError) as exc:
                            errors.append(f"{prefix}: {exc}")
    except (KeyError, ValueError, TypeError, IndexError, OSError, AttributeError) as exc:
        errors.append(f"evidence gate: {exc}")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, nargs="?")
    parser.add_argument("--plan", type=Path)
    parser.add_argument("--stage", choices=("source", "preflight", "online"), default="source")
    parser.add_argument("--build-id")
    parser.add_argument("--theme-id")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--scoped-route", action="append", help="partial evidence only; release wrapper must verify sealed baseline and computed dependency closure")
    parser.add_argument(
        "--diagnostic-continue-after-route-integrity",
        action="store_true",
        help="report downstream presentation/interaction failures after route-integrity failure; never acceptance-eligible",
    )
    args = parser.parse_args()
    if args.self_test:
        suite = unittest.defaultTestLoader.discover(str(Path(__file__).parent), pattern="test_*gates.py")
        require(suite.countTestCases() > 0, "self-tests missing")
        return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1
    if not args.plan:
        parser.error("--plan is required; schema-1 status-only evidence is not accepted")
    try:
        raw = args.plan.read_bytes()
        plan = json.loads(raw)
        manifest = json.loads(args.manifest.read_bytes()) if args.manifest else None
        errors = validate(plan, manifest, args.plan.parent, plan_sha256=hashlib.sha256(raw).hexdigest(),
                          stage=args.stage, build_id=args.build_id, theme_id=args.theme_id,
                          diagnostic_continue_after_route_integrity=args.diagnostic_continue_after_route_integrity,
                          route_ids=args.scoped_route)
    except (OSError, ValueError) as exc:
        errors = [str(exc)]
    print(json.dumps({
        "passed": not errors and not args.diagnostic_continue_after_route_integrity,
        "acceptanceEligible": not args.diagnostic_continue_after_route_integrity and not args.scoped_route,
        "scope": args.scoped_route,
        "errors": errors,
    }, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
