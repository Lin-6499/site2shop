"""Source-only identity. Must match src/capture-cache.ts; targets stay build-bound."""
import copy


def source_capture_contract(plan, analysis, rid, vp):
    route = copy.deepcopy(plan["routes"][rid])
    route.pop("target", None)
    route.pop("localTarget", None)
    for kind in ("states", "transitions"):
        route[kind] = {key: node for key, node in route[kind].items()
                       if "viewports" not in node or vp in node["viewports"]}
        for node in route[kind].values():
            node.pop("generatorBindings", None)
            for field in ("capture", "probe"):
                if node.get(field):
                    node[field].pop("target", None)
            for rule in node.get("rules", []):
                rule.pop("targetPointer", None)
    sequence = route.get("captureSequence")
    route["captureSequence"] = sequence.get(vp, sequence) if isinstance(sequence, dict) else sequence
    components = copy.deepcopy(next(r for r in analysis["routes"] if r["id"] == rid)["components"])
    for component in components:
        if component.get("acceptance"):
            component["acceptance"].pop("targetPointer", None)
    return {"schemaVersion": plan["schemaVersion"], "planId": plan["planId"],
                        "contractVersion": plan["contractVersion"], "collectorVersion": plan["collectorVersion"],
                        "sourceRevision": plan.get("sourceRevision"),
                        "viewport": {"name": vp, **plan["viewports"][vp]}, "limits": plan["limits"],
                        "route": route, "components": components}
