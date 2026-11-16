"""Control/event coverage and measured post-action effects; no button-label assumptions."""


def need(ok, message):
    if not ok:
        raise ValueError("interaction: " + message)


def snapshots(plan, route_id, root, artifact):
    analysis = artifact(plan["analysis"], root)
    discovered = next(r for r in analysis["routes"] if r["id"] == route_id)
    need("interactionInventory" in discovered, "independent control inventory missing")
    inventory = artifact(discovered["interactionInventory"], root)
    need(inventory.get("schemaVersion") == 1 and inventory.get("routeId") == route_id,
         "inventory schema/route mismatch")
    need(inventory.get("collectorVersion") == plan["collectorVersion"], "stale control inventory")
    result = {}
    for item in inventory["snapshots"]:
        key = (item["stateId"], item["viewport"])
        need(key not in result, "duplicate control snapshot")
        artifact(item["evidence"], root, parse=False)
        controls = item["controls"]
        need(isinstance(controls, list), "controls must be an array")
        need(controls or isinstance(item.get("emptyReason"), str) and bool(item["emptyReason"].strip()),
             "zero controls require an observed reason; no implicit pass")
        ids = set()
        for c in controls:
            need(isinstance(c.get("id"), str) and bool(c["id"]) and c["id"] not in ids,
                 "missing/duplicate control identity")
            ids.add(c["id"])
            need(all(isinstance(c.get(k), str) and c[k].strip() for k in ("componentId", "role", "label")),
                 "control semantic identity missing")
            need(type(c.get("enabled")) is bool, "control enabled state missing")
            need(isinstance(c.get("events"), list) and c["events"] and
                 all(isinstance(e, str) and e.strip() for e in c["events"]) and
                 len(c["events"]) == len(set(c["events"])), "control event inventory missing/duplicate")
            if not c["enabled"]:
                need(isinstance(c.get("disabledReason"), str) and bool(c["disabledReason"].strip()),
                     "disabled control needs observed reason")
        result[key] = item
    return result


def check_plan(plan, root, artifact, node_viewports):
    for rid, rp in plan["routes"].items():
        inventory = snapshots(plan, rid, root, artifact)
        expected = {(sid, vp) for sid, state in rp["states"].items()
                    for vp in node_viewports(state, plan["viewports"])}
        need(set(inventory) == expected, "state/viewport control snapshots differ from plan")
        for (sid, vp), snapshot in inventory.items():
            controls = {c["id"]: c for c in snapshot["controls"]}
            need(all(c["componentId"] in rp["states"][sid]["components"] for c in controls.values()),
                 "control is not mapped to a state component")
            outgoing = {eid: edge for eid, edge in rp["transitions"].items()
                        if edge["from"] == sid and vp in node_viewports(edge, plan["viewports"])}
            covered = set()
            for eid, edge in outgoing.items():
                contract = edge.get("interaction", {})
                cid, event = contract.get("controlId"), contract.get("event")
                need(cid in controls and event in controls[cid]["events"] and controls[cid]["enabled"],
                     f"{eid}: transition has no discovered enabled control/event")
                covered.add((cid, event))
                rules = {r["id"] for r in edge["rules"]}
                effects = contract.get("effects")
                need(isinstance(effects, list) and bool(effects), f"{eid}: post-action effects missing")
                need(len({e.get("ruleId") for e in effects}) == len(effects), "duplicate effect rule")
                for effect in effects:
                    need(effect.get("ruleId") in rules and effect.get("kind") in ("changed", "unchanged"),
                         "effect must name a comparison rule and changed/unchanged expectation")
                    need(isinstance(effect.get("reason"), str) and bool(effect["reason"].strip()),
                         "effect expectation needs source-grounded reason")
            required = {(c["id"], event) for c in controls.values() if c["enabled"] for event in c["events"]}
            need(required <= covered, f"{rid}/{sid}/{vp}: discovered control/event has no planned transition")


def check_capture(plan, root, rid, vp, kind, nid, observations, state_records, artifact, pointer, compare):
    rp = plan["routes"][rid]
    if kind == "states":
        expected = snapshots(plan, rid, root, artifact)[(nid, vp)]["controls"]
        fields = ("id", "role", "label", "enabled")
        normalized = lambda values: sorted([{k: c[k] for k in fields} for c in values], key=lambda c: c["id"])
        for side, values in observations.items():
            actual = values.get("interactionControls")
            need(isinstance(actual, list) and normalized(actual) == normalized(expected),
                 f"{side}: missing/extra/changed control after action; revise discovery/plan")
        return
    edge = rp["transitions"][nid]
    rules = {r["id"]: r for r in edge["rules"]}
    for side, values in observations.items():
        before = artifact(state_records[edge["from"]][side], root)["observations"]
        after = artifact(state_records[edge["to"]][side], root)["observations"]
        for effect in edge["interaction"]["effects"]:
            rule = rules[effect["ruleId"]]
            field = rule["sourcePointer" if side == "source" else "targetPointer"]
            first, last, observed = pointer(before, field), pointer(after, field), pointer(values, field)
            need(compare(rule, last, observed), f"{side}: transition result differs from captured after-state")
            same = compare(rule, first, last)
            need(same == (effect["kind"] == "unchanged"),
                 f"{side}: expected {effect['kind']} post-action effect failed: {effect['ruleId']}")
