# Offline scoped source verification and contracts

These commands are **source-only, non-global**. They neither authorize a build,
handoff, native SHOPYY validation nor publication. Existing `contracts`, `gate`,
and build commands retain their whole-site requirements. An incomplete inventory
may still permit a reviewed source scope, but continues to block global acceptance.

## CLI

From the site2shop directory (all arguments below are explicit):

```powershell
$project = 'E:/project/shopyy.project.json'
$root = 'evidence/source-scopes/collection-r1/0123456789ab'

npm run shopyy:workflow -- source-scope-verify --project $project --scope scopes/collection.json --evidence-root $root --index source-scope.json

npm run shopyy:workflow -- contracts-scope --project $project --scope scopes/collection.json --evidence-root $root --index source-scope.json --output "$root/exports/collection-r1"
```

`scope`, `evidence-root`, and `output` are relative to the project file's directory,
not the shell directory. `index` is relative to the scope evidence root and must
currently be `source-scope.json`. The explicit root must equal the collector's
`<global-evidence>/source-scopes/<scopeId>/<intentSha256[0:12]>` directory.
The example hash is a placeholder, not valid project evidence.

Verification is offline/read-only and prints JSON on success. Invalid inputs
throw and cause a nonzero CLI exit. It never calls `recordGate`, reads the success
flags in `scope-report.json`, writes a report, or changes the global ledger.
Its `globalPlanGate` is recomputed by the read-only plan gate and is informative;
it is not a global source verdict.

Export requires a **fresh** direct child directory of that root's `exports/`,
whose name matches `^[a-z][a-z0-9-]{1,63}$`. It cannot target global `source.json`,
project page contracts, ledger, build output, or arbitrary destinations. Existing
directories, contracts and symlinks are never replaced. Validation precedes all
output writes. The file is fully written and synced to a private exclusive temp
file, then committed via a no-clobber hard link as `contracts.json`. On unsupported
filesystems, or an I/O failure, export fails closed; a reserved empty directory or
temp diagnostic may remain, but there is no partial successful contract. Use a new
attempt directory, never erase existing attempts to make a rerun pass.
If only post-commit temp cleanup fails, the successful result explicitly includes
`tempCleanupPending` with that temp path; it is not reported as validation failure.

## Accepted input schemas

- Current project and full structurally valid proposed Plan/Evidence/Capture v2.
- Alternatively, the independent `source-only-plan` v1 plus explicit scope/review
  v2 mode contract, documented in `shopyy-source-only-plan.md`; no target/owner
  placeholders are created and the legacy v2 validator is not relaxed.
- Existing SourceScopeSpec v1: scope ID, exact raw-byte project/plan/inventory
  identities, route IDs, exactly desktop/tablet/mobile, read-only action policy,
  and hash-bound independent review Ref. This command does not create reviews.
- Existing source-scope-review v1, approved-for-source-capture-only, exact intent
  and input hashes, ordered route/device arrays, reviewer and valid reviewedAt.
- Collector's frozen `inputs/scope.json` and `inputs/review.json` must still match
  the current scope/review bytes. No success boolean is accepted as evidence.

Every selected route's entire applicable device/state/edge graph is required.
The verifier checks exact session/check sets, actual sequential capture chaining,
source-only identity, expected requested/final paths and query, canonical origin
and pathname (query absent or exactly the state query, matching collector policy),
status, viewport, scroll/control inventory, assertions, required measurements,
current session/query/privacy/animation policies, all capture/image/action hashes,
valid ordered before → each action → after times, and exact performed actions.
Source `buildId` **and** `servedBuildId` must be null, with no target identity.
The capture's `sourceReadinessPolicySha256` is recomputed through the shared
`sourceReadinessPolicy(project, path)` helper (the explicit schema-1 media policy
is `workflow.sourceMediaReadiness`, separate from existing navigation readiness).
Missing/stale media policy hashes fail closed, in addition to the project hash.
Canonical may be null only as an explicit observed absence, per Capture v2.
All Ref containment checks use realpath, including nested screenshot/fullPage
and log references; symlinks escaping their declared root are rejected. Output
ancestry rejects symlinks even when they resolve inside the project.

Inventory can remain incomplete. Its schema/source identity, exact selected
family/target mappings and all recorded nested provenance refs are rechecked.
This is not a replacement for whole-site discovery/review or global source gating.

## Export schema v1

The exported JSON is the verifier's verified snapshot:

```text
schemaVersion: 1
kind: reviewed-scoped-source-only
passed: true                    # only this offline source verifier's result
globalAccepted: false
formalBuildAllowed: false
published: false
status: source-only-needs-generator-binding-not-global-acceptance
roots: { project: absolute-path, scopeEvidence: absolute-path }
provenance:
  project, plan, scope, inventory, review: Ref (relative to roots.project)
  index: Ref (relative to roots.scopeEvidence)
  intentSha256: canonical intent digest
  references: [{ root: project|scope, ref: Ref }, ...]
scope: SourceScopeIntent v1
sourceUrl, environment, viewports: frozen current plan values
routes: selected complete RoutePlans, including states/edges/components/rules/owners
captures: [{ route, viewport, check, phase, sourceCapture: Ref, value: Capture v2 }]
transitions: [{ route, viewport, id, actionLog: Ref, value: raw-action-log }]
bindings: []
globalPlanGate: { passed, findingIds }
planMode: bilateral-v2 | source-only-v1
role: source-only
```

All capture `sourceCapture`, nested screenshot/fullPage and transition actionLog
Refs resolve against **roots.scopeEvidence**, never global evidence or the export
directory. Reference hashes are preserved, not rewritten. Full captures and action
logs are included for provenance; repeated capture refs across state/edge phases
are intentional. A consumer must reverify current input and artifact hashes and
must explicitly support this schema; moving files or rewriting roots is not a
promotion to global contracts. Existing renderer/presentation consumers do not
consume these scoped exports and are deliberately unchanged.
For source-only plans, the global plan status is explicitly ineligible
(`plan:source-only-not-global`); it is not a whole-site gate run. Legacy bilateral
scopes continue to report the independently read-only whole-site plan gate.

Hash consistency and synthetic regression fixtures do not prove real-site
fidelity, real visual review, safe backend behavior, or SHOPYY compatibility.
The verifier checks stored assertions and recorded action semantics; it cannot
retroactively prove that a collector genuinely operated a browser or that an
apparently read-only network action had no server-side effects. Browser guards,
readiness adapters, honest independent reviews and authorized real capture remain
separate requirements. No Defacto source capture or acceptance is implied.

## Isolated regression commands

```powershell
npx tsx --test tests/shopyy-source-scope.test.ts
npm run typecheck
```

The shared fixture serves only synthetic localhost HTML and runs the existing
three-device collector; it does not contact a real storefront or Shopify CLI.
