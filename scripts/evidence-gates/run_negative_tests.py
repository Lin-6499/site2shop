"""Execute per-rule fault injection on real observations; never invent pass logs.

This tests the measurement comparator, not the website's business behavior. The
full evidence and paired-agent gates remain required after this command.
"""
import argparse
import copy
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from validate_evidence_coverage import artifact, check_plan, compare, node_viewports, pointer, require


def leaf(value, path):
    parts = [p.replace("~1", "/").replace("~0", "~") for p in path[1:].split("/")]
    for p in parts[:-1]:
        value = value[int(p)] if isinstance(value, list) else value[p]
    return value, int(parts[-1]) if isinstance(value, list) else parts[-1]


def accepts(rule, source, target):
    try:
        return compare(rule, pointer(source, rule["sourcePointer"]), pointer(target, rule["targetPointer"]))
    except (ValueError, KeyError, IndexError, TypeError):
        return False


def exercise(rule, source, target):
    require(accepts(rule, source, target), "baseline comparison failed: " + rule["id"])
    log = []
    for mutation in ("missing-source", "missing-target", "mismatch"):
        s, t = copy.deepcopy(source), copy.deepcopy(target)
        if mutation.startswith("missing"):
            parent, key = leaf(s if mutation == "missing-source" else t,
                               rule["sourcePointer"] if mutation == "missing-source" else rule["targetPointer"])
            del parent[key]
        else:
            parent, key = leaf(t, rule["targetPointer"])
            value = pointer(s, rule["sourcePointer"])
            if rule["operator"] == "numeric":
                delta = max(rule["tolerance"]["absolute"], abs(value) * rule["tolerance"]["relative"])
                parent[key] = value + delta + max(1, abs(value))
            elif rule["operator"] == "unordered":
                parent[key] = value + [{"__fault_injection__": True}]
            else:
                parent[key] = {"__fault_injection__": [value]}
        rejected = not accepts(rule, s, t)
        log.append({"mutation": mutation, "rejected": rejected})
        require(rejected, "negative mutation escaped: " + rule["id"] + "/" + mutation)
    return log


def run(plan_path, coverage_path):
    root = plan_path.parent.resolve()
    require(coverage_path.resolve().parent == root, "coverage must be beside capture-plan.json")
    raw = plan_path.read_bytes()
    plan, coverage = json.loads(raw), json.loads(coverage_path.read_bytes())
    check_plan(plan, root)
    digest = hashlib.sha256(raw).hexdigest()
    require(coverage["planSha256"] == digest, "stale plan hash")
    require(coverage["stage"] in ("preflight", "online") and coverage.get("buildId"), "target coverage/build required")
    pending = []
    baseline_errors = []
    for rid, route in plan["routes"].items():
        if rid not in coverage["routes"]:
            require(rid not in coverage.get("incremental", {}).get("routeIds", []), "incremental required route missing")
            require(bool(coverage.get("incremental", {}).get("routeIds")), "full coverage route missing")
            continue
        for vp in plan["viewports"]:
            for kind in ("states", "transitions"):
                for nid, node in route[kind].items():
                    if vp not in node_viewports(node, plan["viewports"]):
                        continue
                    record = coverage["routes"][rid]["viewports"][vp][kind][nid]
                    source = artifact(record["source"], root)["observations"]
                    target_data = artifact(record["target"], root)
                    require(target_data["buildId"] == coverage["buildId"], "stale target build")
                    for rule in node["rules"]:
                        try:
                            log = exercise(rule, source, target_data["observations"])
                        except (ValueError, KeyError, IndexError, TypeError) as error:
                            baseline_errors.append(
                                f"{rid}/{vp}/{kind}/{nid}/{rule['id']}: {error}"
                            )
                            continue
                        pending.append((record, rule, {"route": rid, "viewport": vp, "kind": kind, "node": nid, "results": log}))
    require(not baseline_errors, "baseline comparisons failed:\n" + "\n".join(baseline_errors))
    # Do not change the coverage manifest if any planned test failed.
    def save(value):
        data = json.dumps(value, ensure_ascii=False, allow_nan=False).encode()
        sha = hashlib.sha256(data).hexdigest()
        path = Path("planned-evidence") / "negative-tests" / (sha + ".json")
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        (root / path).write_bytes(data)
        return {"path": path.as_posix(), "sha256": sha}
    for record, rule, log in pending:
        proof = {"id": rule["negativeTest"], "ruleId": rule["id"], "status": "passed", "planSha256": digest,
                 "buildId": coverage["buildId"], "runner": "site2shop/run_negative_tests.py/v1",
                 "executedAt": datetime.now(timezone.utc).isoformat(),
                 "rejectedMutations": [r["mutation"] for r in log["results"]], "log": save(log)}
        record.setdefault("negativeTests", {})[rule["id"]] = save(proof)
    coverage_path.write_text(json.dumps(coverage, ensure_ascii=False, indent=2), encoding="utf-8")
    return len(pending)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("coverage", type=Path)
    parser.add_argument("--plan", required=True, type=Path)
    args = parser.parse_args()
    try:
        count = run(args.plan, args.coverage)
        print(json.dumps({"passed": True, "rulesExecuted": count, "errors": []}))
    except (ValueError, KeyError, IndexError, TypeError, OSError) as error:
        print(json.dumps({"passed": False, "errors": [str(error)]}))
        raise SystemExit(1)
