"""Required presentation assertions and source-to-generator traceability.

Measurements are normalized by project adapters; this module checks coverage and
provenance, not whether a browser observation or generator-use claim is honest.
"""
from __future__ import annotations

import math


PIXEL_FIELDS = (
    "widthPx", "leftInsetPx", "rightInsetPx",
    "paddingTopPx", "paddingRightPx", "paddingBottomPx", "paddingLeftPx",
    "marginTopPx", "marginRightPx", "marginBottomPx", "marginLeftPx",
    "gapBeforePx", "gapAfterPx",
)
STRUCTURED_FIELDS = ("visible", "placement", "topology", "overflow")
FIELDS = PIXEL_FIELDS + STRUCTURED_FIELDS


def need(condition, message):
    if not condition:
        raise ValueError("presentation: " + message)


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def read_pointer(value, path):
    need(nonempty(path) and path.startswith("/"), "invalid measurement pointer")
    for part in path[1:].split("/"):
        part = part.replace("~1", "/").replace("~0", "~")
        value = value[int(part)] if isinstance(value, list) else value[part]
    return value


def profile(component):
    acceptance = component.get("acceptance")
    need(isinstance(acceptance, dict), f"{component['id']}: missing acceptance classification")
    need(acceptance.get("kind") in ("rendered", "nonvisual"), "unknown acceptance kind")
    if acceptance["kind"] == "nonvisual":
        need(nonempty(acceptance.get("reason")), "nonvisual exclusion needs an evidenced reason")
        return None
    need(acceptance.get("profile") == "box-v1", "rendered component requires box-v1")
    for key in ("sourcePointer", "targetPointer"):
        value = acceptance.get(key)
        need(nonempty(value) and value.startswith("/") and not value.endswith("/"),
             "missing presentation root pointer")
    limits = acceptance.get("tolerances")
    need(isinstance(limits, dict) and set(limits) == set(PIXEL_FIELDS), "pixel tolerance coverage incomplete")
    for field, limit in limits.items():
        need(isinstance(limit, dict), f"{field}: invalid tolerance")
        need(all(finite(limit.get(k)) and limit[k] >= 0 for k in ("absolute", "relative")),
             f"{field}: invalid tolerance")
        need(nonempty(limit.get("reason")), f"{field}: tolerance needs source evidence rationale")
    return acceptance


def check_node(components, node):
    """Check against independent discovery, before any passing captures exist."""
    informational = node.get("informationalPresentationFields", {})
    need(isinstance(informational, dict), "informational presentation fields must be an object")
    for cid in node["components"]:
        spec = profile(components[cid])
        if spec is None:
            continue
        component_informational = informational.get(cid, {})
        need(isinstance(component_informational, dict), f"{cid}: informational fields must be an object")
        need(set(component_informational).issubset(set(FIELDS)), f"{cid}: unknown informational field")
        need(all(nonempty(reason) for reason in component_informational.values()),
             f"{cid}: informational field needs an evidenced reason")
        for field in FIELDS:
            source = spec["sourcePointer"] + "/" + field
            target = spec["targetPointer"] + "/" + field
            matches = [r for r in node["rules"]
                       if r.get("sourcePointer") == source and r.get("targetPointer") == target]
            if field in component_informational:
                need(len(matches) == 0, f"{cid}/{field}: informational field cannot also be a hard assertion")
                continue
            need(len(matches) == 1, f"{cid}/{field}: expected one measured assertion, got {len(matches)}")
            rule = matches[0]
            need(rule["operator"] == ("numeric" if field in PIXEL_FIELDS else "equal"),
                 f"{cid}/{field}: wrong measurement comparator")
            if field in PIXEL_FIELDS:
                limit, tolerance = spec["tolerances"][field], rule.get("tolerance", {})
                need(all(finite(tolerance.get(k)) and 0 <= tolerance[k] <= limit[k]
                         for k in ("absolute", "relative")),
                     f"{cid}/{field}: rule exceeds independently declared tolerance")


def check_measurements(observations, components, node, side):
    for cid in node["components"]:
        spec = profile(components[cid])
        if spec is None:
            continue
        box = read_pointer(observations, spec[side + "Pointer"])
        need(isinstance(box, dict), f"{cid}: missing normalized box")
        for field in PIXEL_FIELDS:
            need(finite(box.get(field)), f"{cid}/{field}: missing finite measurement")
        need(type(box.get("visible")) is bool, f"{cid}: missing visibility")
        need(box["widthPx"] >= 0 and (not box["visible"] or box["widthPx"] > 0),
             f"{cid}: visible component has invalid width")
        for key, fields in (
            ("placement", ("parent", "previous", "next")),
            ("topology", ("display", "flow", "tracks")),
            ("overflow", ("x", "y")),
        ):
            value = box.get(key)
            need(isinstance(value, dict) and all(nonempty(value.get(k)) for k in fields),
                 f"{cid}/{key}: incomplete structured relationship")
        need(type(box["overflow"].get("nativeScrollbarX")) is bool,
             f"{cid}: missing native scrollbar observation")


def check_bindings(record, components, node, root, artifact):
    """Require current-source lineage plus generator and generated-file evidence."""
    expected = {cid for cid in node["components"] if profile(components[cid]) is not None}
    bindings = record.get("presentationBindings", {})
    need(isinstance(bindings, dict) and set(bindings) == expected,
         "generator binding coverage differs from rendered component inventory")
    for cid in expected:
        spec, binding = profile(components[cid]), bindings[cid]
        need(isinstance(binding, dict), f"{cid}: invalid generator binding")
        need(binding.get("mode") in ("contract", "provider-configuration"),
             f"{cid}: provisional/default layout cannot pass acceptance")
        need(binding.get("sourceCaptureSha256") == record["source"]["sha256"] and
             binding.get("sourcePointer") == spec["sourcePointer"], f"{cid}: stale source-to-generator binding")
        measures = binding.get("measures")
        need(isinstance(measures, list) and len(measures) == len(FIELDS) and set(measures) == set(FIELDS),
             f"{cid}: generator has unconsumed presentation requirements")
        need(nonempty(binding.get("owner")), f"{cid}: missing generator symbol/config location")
        artifact(binding["generator"], root, parse=False)
        artifact(binding["generated"], root, parse=False)


def check_context(observations, components, node, viewport):
    """Compare CSS geometry only under a verified, compatible render context."""
    if not any(profile(components[cid]) is not None for cid in node["components"]):
        return
    contexts = []
    for side, data in observations.items():
        context = data.get("presentationContext")
        need(isinstance(context, dict), f"{side}: missing measured render context")
        need(context.get("cssViewport") == viewport, f"{side}: measured viewport differs from plan")
        for key in ("documentClientWidth", "devicePixelRatio", "visualViewportScale", "rootZoom"):
            need(finite(context.get(key)) and context[key] > 0, f"{side}: invalid render context {key}")
        need(context["documentClientWidth"] <= viewport["width"], f"{side}: invalid document client width")
        contexts.append({key: context[key] for key in (
            "cssViewport", "documentClientWidth", "devicePixelRatio", "visualViewportScale", "rootZoom")})
    need(all(c == contexts[0] for c in contexts), "incompatible render contexts; recapture at matching settings")
