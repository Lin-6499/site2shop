# Explicit source-only plans (schema 1)

This is a separate, deliberately non-promotable plan contract for source work when
there is no honest target/composer/owner design yet. It is **not** a relaxed Plan
v2, a projection into v2, a generator adapter, or global acceptance. The existing
`validatePlan()` v2 requirements are unchanged.

## Input and entrypoints

A dedicated source project needs only:

```json
{
  "sourceUrl": "https://example.invalid",
  "capturePlanFile": "plans/collection-source-r1.json",
  "workflow": { "evidenceDirectory": "evidence" }
}
```

No `pageContractsFile`, output directory, target origin, composer or fake owner is
required. Source session, query/privacy, media readiness and navigation policies
remain project-owned and retain their existing protections. The evidence directory
must be an explicit project-relative path with no traversal or symlink ancestry.

```powershell
npm run shopyy:workflow -- source-plan-validate --project $project
# After an actual independent reviewer has approved the exact intent:
npm run shopyy:workflow -- source-scope --project $project --scope scopes/collection-source.json
npm run shopyy:workflow -- source-scope-verify --project $project --scope scopes/collection-source.json --evidence-root $root --index source-scope.json
npm run shopyy:workflow -- contracts-scope --project $project --scope scopes/collection-source.json --evidence-root $root --index source-scope.json --output "$root/exports/collection-r1"
```

The validator is offline/read-only. It checks plan structure and the full
hash-bound inventory, including all retained provenance refs and the source-family
classification of every planned route. It does not issue capture review approval.
`source-scope` remains the only source-only capture entry: global capture and
global contracts explicitly reject this mode. Scoped verification/export stay
offline and never write global source/contracts/ledgers.

## SourceOnlyPlan schema 1

The TypeScript schema and executable validator are in `src/shopyy/source-plan.ts`.
Only the following properties are accepted; unknown target/owner fields fail
closed rather than being silently discarded.

```text
schemaVersion: 1
kind: source-only-plan
revision: nonempty version/revision string
sourceUrl: HTTP(S) source identity, without credentials/fragment/mutation URL
inventory: { path, sha256 }          # full Inventory v2 snapshot, project-relative
viewports: exactly desktop/tablet/mobile, each positive integer width/height
limits: { timeoutMs: 1..60000, maxActionsPerRoute: positive integer,
          maxRoutes: positive integer }
environment: { locale, timezoneId, optional infiniteAnimations,
               optional rasterizeInfiniteFrameZero }
routes:
  <route-id>:
    family, rationale, sourcePath
    components:
      <component-id>:
        source: unique source CSS selector
        selectorsByViewport?: { <device>: { source: selector } }
        topology?: physical | component-tree
        requiredFields: nonempty unique field array containing all VISUAL_FIELDS
        rules: exactly one rule per required field, no extra rules
          [{ field, compare: equal | number, tolerance?, rationale? }]
    states:
      initial: <state>
      <state-id>:
        viewports?: nonempty unique subset of the three devices
        components: nonempty unique component IDs
        paths: { source: exact path/query }
        canonical?: { source: exact absolute same-origin HTTP(S) URL | null }
        ready: { source: visible-ready selector }
        assertions: { source: [{ selector, read: text|value|count|visible,
                                 expected: string|integer|boolean }] }
    transitions:
      <edge-id>:
        viewports?: nonempty unique subset of the three devices
        from, to, input: source state IDs and semantic string input
        actions: { source: [<Action>, ...] }
        actionsByViewport?: { <device>: { source: [<Action>, ...] } }
    sequence: ordered edge IDs
    sequencesByViewport?: { <device>: ordered edge IDs }
```

`VISUAL_FIELDS` are visible, x/y/width/height, display, fontSize, lineHeight,
overflowX/overflowY, parent and order. Numeric comparison tolerances must be finite,
nonnegative and justified in advance. Rules are retained for future explicitly
reviewed comparison policy, not a claim that a target has been compared.

Additional required measurements must come from the current real `OBSERVE`
surface (`SOURCE_OBSERVATION_FIELDS`): fontFamily, topologyMode, physicalParent,
physicalOrder, paddingTop/Right/Bottom/Left, gap, gridTemplateColumns, flexDirection,
text, tag, role, value, checked, disabled, images, scrollWidth, clientWidth,
scrollLeft. No arbitrary attribute/opacity/options measurement is silently
assumed to exist. Numeric rules are restricted to actual numeric observation
fields; unsupported measurements require an implemented, reviewed collector
adapter rather than a plan-only field name.

Each device starts at `initial`; its sequence must be continuous, reach every
applicable state, and execute every applicable edge exactly once, within the
source action budget. This conservative source-only schema additionally requires
each device sequence to end back at `initial`, using explicit real reverse/reset
edges, so removing both a reverse edge and its sequence entry still fails. Do not
invent a reset if no read-only reverse operation exists: that workflow stays
unsupported until explicitly designed and reviewed. State component
selectors must be distinct, and the real collector additionally requires each
selector to match **exactly one DOM node**. Hidden components remain observations,
not omitted coverage. Empty transition sets are valid only for an initial-only
page with an explicit empty sequence; interactive completeness is reviewer-owned.

Only existing real Action operations are allowed, each with `effect: read-only`.
Source selector/scroll/history prerequisites, exact history destinations, shared
input for fill/select/press and optional visible/absent wait conditions are
validated. Known mutation destinations are rejected, and the real browser keeps
the shared request guards, natural media readiness checks and durable failed-edge
journals. This schema does not authorize source submissions or invent an adapter.

There is **no** target selector, target path, target action, target assertion,
target viewport binding, target identity or generator owner in this plan.

### Explicit state canonical expectations (source-only)

An optional `canonical: { "source": "https://example.invalid/shop/" }` on a
source-only state declares the **exact observed canonical**, independently of that
state's strict requested/final path and query. For example, a state can have
`paths.source: "/shop?orderby=menu_order&view=list"` and that explicit canonical
ending in `/shop/`. No trailing-slash normalization or query dropping is performed.

The expected URL must be absolute HTTP(S), use the same origin as `sourceUrl`,
contain no credentials/fragment, and already have its exact WHATWG URL spelling.
Actual canonical must equal the declaration byte-for-byte, including query and
trailing slash. `canonical: { "source": null }` requires **actual observed absence**;
it is not a wildcard. Missing or extra declaration members are rejected.

Omitting `canonical` preserves the old strict source pathname/origin behavior and
the independent verifier's default canonical-query rule. Legacy Plan v2 ignores
this new source-only feature and retains its previous behavior. The field is part
of the raw plan hash bound by the reviewed intent, so adding, changing or removing
it invalidates existing review/evidence identity. It does not change requested or
final URL verification, collector identity, global eligibility or output roots.

## Full inventory without fabricated target mapping

Continue to bind the whole known Inventory v2 snapshot, not a selected-route
truncation. `complete:false`, pending/failed surfaces, unresolved occurrences and
unvisited routes must be retained honestly. All recorded refs are hash/containment
checked; ok sources and captured surfaces require evidence. Sitemap and rendered
source records are mandatory (an absent/failed status is not silently promoted).

A selected route has a separate source classification:

```json
{
  "/shop/": {
    "disposition": "unresolved",
    "rationale": "Target mapping has not been designed",
    "source": {
      "family": "collection",
      "representative": "collection",
      "rationale": "Reviewed source-only collection representative",
      "evidence": { "path": "observations/collection.json", "sha256": "<64 lowercase hex>" }
    }
  }
}
```

`source.family` must equal the selected RoutePlan family; `source.representative`
must equal that route ID; the nonempty rationale and hashed source evidence are
required. Selected dispositions may be unresolved or already mapped, but this mode
does not require or infer targetPath. It does not introduce a novel disposition
that might accidentally pass old global inventory gates. Existing global gates
continue to treat unresolved target mappings as blockers.

## Source-only scope/review schema 2

Legacy bilateral Plan v2 still uses the existing scope/review v1, unchanged.
The source-only plan instead requires:

```text
scope:
  schemaVersion: 2
  role: source-only
  planMode: source-only-v1
  scopeId, projectSha256, planSha256, inventory, routeIds, viewports,
  sourceActionPolicy: read-only, review: Ref

review:
  schemaVersion: 2
  role: source-only
  planMode: source-only-v1
  kind: source-scope-review
  verdict: approved-for-source-capture-only
  reviewer, reviewedAt, intentSha256, projectSha256, planSha256,
  inventorySha256, routeIds, viewports, sourceActionPolicy: read-only
```

All remaining fields retain the v1 scope rules: raw-byte hashes for files, ordered
review route/device arrays, exact three devices, complete selected-route graphs,
and real independent review. The canonical `sourceScopeIntent()` hash now includes
schemaVersion, role and planMode for schema 2. Do not manually omit these keys or
reuse a v1 review. Mode/schema mismatches fail before browser execution or export.

## Evidence, export, global boundary and later promotion

Capture and Evidence remain source schema 2, but their collector identity is
`shopyy-source-only-plan-v1-browser-v2`, distinct from bilateral collection.
The scoped index additionally carries `scope.planMode: source-only-v1` and
`scope.role: source-only`. Source captures have null buildId/servedBuildId and no
target identity. Source-only collection completion invokes the independent offline
verifier, not just capture result booleans.

The independent export schema described in `shopyy-scoped-contracts.md` is retained
with explicit `planMode: source-only-v1` and `role: source-only`. Source routes,
all captures/logs, complete scope provenance and nested refs remain intact. Nothing
is copied to global `source.json` or `pageContractsFile`. Its global plan status is
explicitly blocked with `plan:source-only-not-global`, irrespective of whether the
inventory is eventually complete. This is mode ineligibility, not a fabricated
whole-site gate execution or global source pass.

Later bilateral work requires a **new Plan v2**, actual target/composer ownership,
new hashes, a new reviewed scope/attempt and independent target/build/preflight/
online gates. Changing schemaVersion, stripping a mode marker, adding placeholder
target fields, copying a scoped index, or changing flags is not promotion.
No automatic promotion, evidence rewriting, target contract export or target
rendering adapter is provided here. Existing evidence remains immutable.

### Renderer and prototype rejection boundary

The SHOPYY renderer now checks the input role directly inside its adapter build
entry, before calling a gate or performing any generation, cleanup, mkdir, or
output write. This applies to normal and prototype builds, CLI `platform-build`
and `platform-serve`, dispatch through `buildPlatform`, and direct adapter calls.
Source-only kind/role/planMode markers are rejected even when schemaVersion is
changed to 2; a source-only v1 route dictionary is also rejected if its kind is
removed. Scoped source indices/exports cannot be supplied as global build inputs.
The check covers project, capture plan, content, design and page-contract inputs;
it never converts, deletes or fills target fields.

The existing v2 gate requirements and the frozen legacy family-array prototype
path remain unchanged. Prototype generation of a legitimate bilateral/prototype
project is still possible, but a source-only plan is not such a project. The
source scope/verifier/exporter paths remain available independently. This scoped
workflow does not invoke or grant permission for target generation or publication.

Synthetic localhost regressions establish implementation behavior only; they do
not establish real source fidelity, independent real-site review or SHOPYY native
compatibility.
