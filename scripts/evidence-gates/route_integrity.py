"""Portable link/resource checks used by the evidence gate; never crawls or writes a store."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

RESOURCE_KINDS = {"product", "collection", "page", "policy", "blog", "article", "app", "platform", "custom"}


def need(ok, message):
    if not ok:
        raise ValueError("navigation: " + message)


def text(value):
    need(isinstance(value, str) and bool(value.strip()), "nonempty string required")
    return value


def read_ref(ref, root, parse=True):
    need(isinstance(ref, dict), "artifact reference required")
    relative = Path(text(ref.get("path")))
    path = (Path(root) / relative).resolve()
    need(not relative.is_absolute() and path.is_relative_to(Path(root).resolve()), "artifact escapes evidence root")
    raw = path.read_bytes()
    need(bool(raw) and hashlib.sha256(raw).hexdigest() == ref.get("sha256"), "artifact hash mismatch or empty")
    return json.loads(raw) if parse else raw


def stamp(value):
    need(datetime.fromisoformat(text(value).replace("Z", "+00:00")).tzinfo is not None, "timestamp needs timezone")


def url_key(value, ignored=(), fragment=False):
    u = urlsplit(text(value))
    need(u.scheme in ("http", "https") and u.hostname and not u.username and not u.password, "invalid web URL")
    query = urlencode(sorted((k, v) for k, v in parse_qsl(u.query, keep_blank_values=True) if k not in ignored))
    return urlunsplit((u.scheme.lower(), u.netloc.lower(), u.path.rstrip("/") or "/", query,
                       u.fragment if fragment else ""))


def origin(value):
    u = urlsplit(url_key(value))
    return u.scheme + "://" + u.netloc


def content(data):
    need(type(data.get("httpStatus")) is int and 200 <= data["httpStatus"] < 300, "non-success route")
    need(data.get("pageKind") == "content" and data.get("soft404") is False, "not verified content (404/interstitial)")
    for field in ("finalUrl", "canonical"):
        need(not re.search(r"/(password|challenge|checkpoint)(/|$)", urlsplit(text(data[field])).path, re.I),
             "interstitial URL")


def decision(record, root, source_url=None):
    value = record.get("decision", {})
    text(value.get("reason"))
    need(value.get("basis") in ("source-broken", "scope", "approved-change"), "explicit disposition basis required")
    proof = read_ref(value.get("evidence"), root)
    if value["basis"] == "source-broken":
        need(proof.get("pageKind") in ("not-found", "gone") and proof.get("httpStatus") in (200, 404, 410),
             "timeout, password or challenge is not a broken source")
        need(source_url is not None and url_key(proof["requestedUrl"]) == url_key(source_url),
             "source failure evidence belongs to another route")
        stamp(proof["capturedAt"])
        read_ref(proof["artifact"], root, parse=False)
    return value


def check_inventory(plan, analysis, root):
    """Check discovery independently of successful captures, including sitemap-only routes."""
    ref = plan.get("routeInventory")
    inv = read_ref(ref, root)
    need(isinstance(inv, dict), "route inventory object required")
    need(inv.get("schemaVersion") == 1, "route inventory schemaVersion 1 required; regenerate legacy plans")
    need(inv.get("collectorVersion") == plan["collectorVersion"], "stale inventory collector")
    surfaces = analysis.get("navigationSurfaces")
    need(isinstance(surfaces, list) and surfaces, "independently planned navigation surfaces missing")
    planned = {text(s["id"]): s for s in surfaces}
    need(len(planned) == len(surfaces), "duplicate surface ID")
    need(set(inv["surfaces"]) == set(planned), "surface inventory differs from analysis")
    source_origins = {origin(u) for u in inv["sourceOrigins"]}
    target_origins = {origin(u) for u in inv["targetOrigins"]}
    need(source_origins and target_origins, "source/target origin scope missing")
    ignored = inv.get("ignoredQueryKeys", {})
    need(isinstance(ignored, dict), "ignored query keys need documented reasons")
    for key, reason in ignored.items():
        text(key)
        text(reason)
    observed, snapshots = {}, {}
    for sid, expected in planned.items():
        snapshot = read_ref(inv["surfaces"][sid], root)
        snapshots[sid] = snapshot
        for key in ("url", "region", "viewport", "state"):
            need(snapshot.get(key) == expected[key], f"surface identity mismatch: {sid}/{key}")
        need(origin(expected["url"]) in source_origins, "surface outside source scope")
        need(expected["region"] == "sitemap" or expected["viewport"] in plan["viewports"], "unknown surface viewport")
        if expected["region"] != "sitemap":
            for key in ("url", "canonical"):
                need(origin(expected["target"][key]) in target_origins, "target surface outside intended store")
        need(snapshot.get("complete") is True and snapshot.get("collectorVersion") == plan["collectorVersion"],
             "incomplete/stale surface extraction")
        stamp(snapshot["capturedAt"])
        content(snapshot)
        need(url_key(snapshot["finalUrl"]) == url_key(expected["url"]), "surface redirected to another route")
        need(url_key(snapshot["canonical"]) == url_key(expected.get("canonical", expected["url"])),
             "source surface canonical mismatch")
        read_ref(snapshot["artifact"], root, parse=False)
        need(isinstance(snapshot.get("links"), list), "extracted link list missing")
        if not snapshot["links"]:
            text(snapshot.get("emptyReason"))
        for link in snapshot["links"]:
            lid = sid + ":" + text(link["id"])
            need(lid not in observed, "duplicate extracted link ID")
            observed[lid] = (expected, link, urljoin(expected["url"], text(link["href"])))
    resolutions = inv["resolutions"]
    need(set(resolutions) == set(observed), "every extracted link needs a disposition, including links absent from sitemap")
    routes = inv["routes"]
    used = set()
    for lid, (surface, link, resolved) in observed.items():
        item = resolutions[lid]
        action = item.get("action")
        local_action = link["href"].startswith("#") or urlsplit(resolved).scheme not in ("http", "https")
        if action == "map":
            need(not local_action and origin(resolved) in source_origins, "map requires an internal web destination")
            rid = item.get("routeId")
            need(rid in routes, f"link missing target resource plan: {lid}")
            need(url_key(resolved, ignored) == url_key(routes[rid]["sourceUrl"], ignored), "source link/resource mismatch")
            used.add(rid)
        elif action == "remove":
            decision(item, root, resolved)
        elif action == "retain-external":
            need(not local_action, "external link must be a web URL")
            if origin(resolved) in source_origins:
                decision(item, root, resolved)
        elif action == "interaction":
            need(local_action, "internal landing URL cannot be classified as a non-navigation action")
            route = plan["routes"].get(item.get("captureRouteId"), {})
            need(item.get("transitionId") in route.get("transitions", {}), "action requires an executable workflow probe")
        else:
            need(False, f"unresolved link disposition: {lid}")
    need(set(routes) == used, "resource inventory contains unreferenced or omitted mappings")
    for rid, route in routes.items():
        need(origin(route["sourceUrl"]) in source_origins, "resource outside source scope")
        target = route["target"]
        need(target.get("kind") in RESOURCE_KINDS, "explicit resource kind required (policy is not page)")
        for key in ("url", "finalUrl", "canonical"):
            need(origin(target[key]) in target_origins, "target resource points outside intended store")
        chain = target.get("redirectChain")
        need(isinstance(chain, list) and chain, "declared redirect chain required, including direct routes")
        keys = [url_key(u, ignored) for u in chain]
        need(len(keys) == len(set(keys)), "redirect cycle")
        need(keys[0] == url_key(target["url"], ignored) and keys[-1] == url_key(target["finalUrl"], ignored),
             "redirect endpoints disagree with mapping")
        if len(chain) > 1 or url_key(target["canonical"], ignored) != keys[-1]:
            decision(route, root, route["sourceUrl"])
        need(all(origin(u) in target_origins for u in chain), "redirect leaves intended store")
        representative = plan["routes"].get(route.get("captureRouteId"))
        need(representative is not None and representative["family"] == route.get("family"), "missing family capture assignment")
        if url_key(representative["source"]["url"], ignored) != url_key(route["sourceUrl"], ignored):
            text(route.get("samplingRationale"))
        else:
            need(url_key(representative["target"]["url"], ignored) == url_key(target["finalUrl"], ignored) and
                 url_key(representative["target"]["canonical"], ignored) == url_key(target["canonical"], ignored),
                 "capture plan and resource mapping disagree")
        if "localTarget" in route:
            local = route["localTarget"]
            for key in ("url", "finalUrl", "canonical"):
                url_key(local[key], ignored)
            chain = [url_key(u, ignored) for u in local["redirectChain"]]
            need(chain and len(chain) == len(set(chain)) and chain[0] == url_key(local["url"], ignored) and
                 chain[-1] == url_key(local["finalUrl"], ignored), "invalid local redirect mapping")
    return inv, planned, observed


def check_coverage(plan, analysis, manifest, root, stage, build_id, theme_id):
    inv, surfaces, observed = check_inventory(plan, analysis, root)
    if stage == "source":
        return
    report = read_ref(manifest.get("navigation"), root)
    need(report.get("schemaVersion") == 1 and report.get("inventorySha256") == plan["routeInventory"]["sha256"],
         "stale/missing navigation coverage")
    need(report.get("stage") == stage and report.get("buildId") == build_id, "stale navigation build/stage")
    if stage == "online":
        need(report.get("themeId") == theme_id, "wrong navigation preview theme")
    ignored = inv.get("ignoredQueryKeys", {})
    expected_surfaces = {sid for sid, s in surfaces.items() if s["region"] != "sitemap"}
    need(set(report["surfaces"]) == expected_surfaces, "generated navigation surface missing")
    for sid in expected_surfaces:
        data = read_ref(report["surfaces"][sid], root)
        location = surfaces[sid].get("localTarget", surfaces[sid]["target"]) if stage == "preflight" else surfaces[sid]["target"]
        need(data.get("buildId") == build_id and data.get("viewport") == surfaces[sid]["viewport"] and
             data.get("state") == surfaces[sid]["state"], "wrong generated surface identity")
        if stage == "online":
            need(data.get("themeId") == theme_id, "wrong generated surface theme")
        stamp(data["capturedAt"])
        content(data)
        need(url_key(data["url"], ignored) == url_key(location["url"], ignored) and
             url_key(data["finalUrl"], ignored) == url_key(location["url"], ignored) and
             url_key(data["canonical"], ignored) == url_key(location["canonical"], ignored),
             "generated surface route/canonical mismatch")
        read_ref(data["artifact"], root, parse=False)
        links = {text(x["id"]): x for x in data["links"]}
        need(len(links) == len(data["links"]), "duplicate generated link ID")
        expected_links = {lid[len(sid) + 1:]: item for lid, item in inv["resolutions"].items()
                          if lid.startswith(sid + ":") and item["action"] != "remove"}
        need(set(links) == set(expected_links), "generated links missing, extra, or removed link still visible")
        for link_id, item in expected_links.items():
            href = text(links[link_id]["href"])
            source_href = observed[sid + ":" + link_id][2]
            if item["action"] == "map":
                route = inv["routes"][item["routeId"]]
                location = route.get("localTarget", route["target"]) if stage == "preflight" else route["target"]
                desired = location["url"]
                # Anchors and non-HTTP actions need their own workflow probes.
                if urlsplit(source_href).fragment:
                    desired += "#" + urlsplit(source_href).fragment
                need(url_key(urljoin(data["url"], href), ignored, True) == url_key(desired, ignored, True),
                     f"generated link points to wrong destination: {sid}/{link_id}")
            elif item["action"] == "retain-external":
                need(url_key(urljoin(data["url"], href), ignored, True) == url_key(source_href, ignored, True),
                     "external destination changed without a decision")
            else:
                need(href == observed[sid + ":" + link_id][1]["href"], "non-navigation action changed")
    need(set(report["routes"]) == set(inv["routes"]), "every mapped destination needs a route smoke check")
    for rid, route in inv["routes"].items():
        target = route["target"]
        location = route.get("localTarget", target) if stage == "preflight" else target
        checks = report["routes"][rid]
        need(set(checks) == set(plan["viewports"]), f"route viewport coverage missing: {rid}")
        for vp, ref in checks.items():
            data = read_ref(ref, root)
            need(data.get("buildId") == build_id and data.get("viewport") == {"name": vp, **plan["viewports"][vp]},
                 "stale/wrong route probe identity")
            stamp(data["capturedAt"])
            content(data)
            read_ref(data["artifact"], root, parse=False)
            for actual, expected in (("requestedUrl", "url"), ("finalUrl", "finalUrl"), ("canonical", "canonical")):
                need(url_key(data[actual], ignored) == url_key(location[expected], ignored), f"route probe mismatch: {rid}/{actual}")
            need([url_key(u, ignored) for u in data["redirectChain"]] ==
                 [url_key(u, ignored) for u in location["redirectChain"]], "unexpected redirect chain")
            if stage == "online":
                need(data.get("themeId") == theme_id, "wrong route probe theme")
                binding = data.get("binding", {})
                need(binding.get("kind") == target["kind"], "wrong resource kind (page cannot satisfy policy)")
                text(binding.get("id"))
                need(binding.get("readBack") is True and binding.get("published") is True, "resource unavailable or not read back")
                need(url_key(binding["url"], ignored) == url_key(target["finalUrl"], ignored), "bound resource does not own landing URL")
                if "templateSuffix" in target:
                    need("templateSuffix" in binding and binding["templateSuffix"] == target["templateSuffix"], "wrong resource template")
