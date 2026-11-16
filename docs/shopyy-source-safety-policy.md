# Read-only source capture safety and readiness

This policy is collector infrastructure, not source-site acceptance. It does not
authorize checkout, cart, account changes, identity declarations, or publication.
Existing capture-plan/source-scope review, hash, route, assertion and gate checks
remain mandatory. No plan/capture schema fields were changed.

## Network safety

`src/shopyy/source-safety-policy.ts` provides one auditable URL mutation denylist.
Formal source capture (global and scoped), component inspection, automated source
storage/check/preference sessions use it before any existing precise POST
exception. GET, HEAD and OPTIONS are **not** proof of read-only behavior.

Known Woo cart/remove/undo/wishlist/compare/logout/coupon/checkout operations,
plugin `action` values and mutating cart endpoints are denied, as are unknown
`wc-ajax` operation names. Recognized read AJAX names do not authorize a POST.
Sort/view query parameters and image dimensions/format/cache query values are
not denied merely because they contain generic `action`, `id`, or version keys.
Asset resource type/extension cannot override an actual mutation key.

All other non-GET/HEAD/OPTIONS requests remain blocked except existing precise
reviewed display-query and token-refresh policies. This is a known-operation
denylist, not a claim to recognize every possible backend mutation: source actions
still need independent read-only review. Manual `source-session --open` remains
human-controlled sign-in, not an automated read-only session.

## Explicit natural image readiness (project workflow configuration)

Existing state `ready` CSS can express disappearance, for example a uniquely
matched product container with `:not(:has(.gz-lazy-load))`; state `count` assertions
can require zero loading nodes. Existing assertions cannot test image `complete`
and **both** natural dimensions. For that case, declare project-owned policy:

The existing `workflow.sourceReadiness` field retains its path-to-selector string
map semantics for discovery/inspection. It is not parsed as a media policy, does
not activate media waits, and must not be converted to the object below. The new
independent field is `workflow.sourceMediaReadiness`; both may coexist. When that
new field is explicitly configured, missing/empty rules or an unmatched exact path
fail closed rather than falling back to the legacy map.

```json
{
  "workflow": {
    "sourceMediaReadiness": {
      "schemaVersion": 1,
      "rationale": "Independently observed loader must resolve naturally before capture",
      "rules": [{
        "paths": ["/shop/", "/shop/?orderby=price"],
        "absent": [".products .gz-lazy-load"],
        "requiredImages": [{"selector": ".products img.product-image", "minCount": 8}]
      }]
    }
  }
}
```

Selectors/counts above are **examples**, not verified selectors or product counts
for any real source. Independently verify the selector semantics at all devices,
then freeze project/plan/scope hashes and obtain review. Every final exact
pathname+query visited under an enabled policy must have a rule. All matching
rules apply. `minCount` prevents an empty selector from passing; every matched
element must be an image with `complete`, `naturalWidth > 0`, `naturalHeight > 0`.
Use existing assertions for exact product count/order and selected sort/view.

The collector only waits and reads. It does not remove loading classes, change
opacity, rewrite image attributes, eager-load or scroll images into readiness.
Below-fold lazy resources that never naturally resolve therefore time out.
Stable layout or stable 0.01-opacity pixels are not readiness. The configured
loading selector must cover the actual overlay/ancestor/pseudo-element owner;
there is no implicit opacity heuristic or automatic source DOM projection.

Formal capture records `sourceReadinessPolicySha256` in its capture environment;
the whole project file is also hash-bound by source-scope review. It waits before
measurement and immediately rechecks after screenshots, so later recovery cannot
validate earlier unready pixels. Failure does not create a successful capture or
transition check. Planning inspection uses the same wait/recheck when configured.

## Opt-in initial navigation readiness

Default navigation remains `domcontentloaded`. For a verified DCL stall:

```json
{
  "workflow": {
    "sourceNavigation": {
      "waitUntil": "commit",
      "rationale": "Observed document commit is reliable; semantic readiness is separately required",
      "readySelector": "main .independently-verified-ready-state"
    }
  }
}
```

Only `commit` or `domcontentloaded` is accepted, with nonempty rationale and a
strict, visible semantic ready selector. This controls initial formal/inspection
and automated source-storage/check navigation, not browser history or manual login.
Response status, blocked UI, exact final URL/canonical, state assertions, fonts,
image readiness, layout and source gates are still checked. `commit` is not an
acceptance shortcut, nor a guarantee to solve every navigation timeout.

## Failed action journals

Formal attempts are written before dispatch and after every action result to:

```
<evidence-root>/attempts/<sha256(canonical({rid,vp,id}))>.json
```

Each action has the original action, `op`, `startedAt`, `status`, then `endedAt`,
`result` and sanitized `error` on failure. Earlier performed actions survive a
later action or destination snapshot failure. The attempt has route/viewport/edge,
start/end/status/error and `kind: transition-attempt-not-success-check`.
A process interruption can leave a truthful `started` row; it is not success.
No failed attempt is inserted into `session.checks`. Successful action logs retain
their existing shape plus additive fields. Inspection also writes incremental
planning action journals and failure diagnostic artifacts.

Journals are diagnostics, not acceptance input, and cannot reopen a failed gate.
Normal source-scope attempt uniqueness is unchanged; do not delete failed attempts
or reuse scope intent directories. Storage/filesystem failure itself is not
recoverable evidence and must be reported rather than claimed persisted.

## Isolated regressions

```
npx tsx --test tests/shopyy-source-safety-policy.test.ts
npx tsx --test tests/shopyy-source-refresh-guard.test.ts tests/shopyy-read-queries.test.ts tests/shopyy-source-session.test.ts tests/shopyy-history-actions.test.ts
npm run typecheck
```

These are synthetic requests and local fixtures, not real-source validation.
