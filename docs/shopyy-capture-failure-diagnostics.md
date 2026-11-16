# Formal capture failure checkpoints and hidden postconditions

This is a collector repair, not an acceptance decision for any real source.
No timeout, assertion, visual rule or tolerance is weakened. Font readiness is
still required; a performed action and stable geometry are not proof of a ready
state. Source-scope attempts still require fresh reviewed, hash-bound inputs.

## Explicit `Action.waitAfter.hidden`

```json
{
  "op": "click",
  "selector": ".independently-verified-backdrop",
  "effect": "read-only",
  "waitAfter": { "hidden": ".independently-verified-overlay" }
}
```

The selectors above are placeholders, not verified selectors for a real site.
`perform()` calls Playwright `locator.waitFor({state: 'hidden', timeout})` after
dispatch. The node may remain attached; `visibility:hidden`, `display:none`,
zero layout box, or detachment satisfy Playwright's hidden semantics. Opacity
alone does not. `absent` still means detached; `visible` retains its original
semantics. All declared waits apply, in the order visible, absent, hidden.

No force click, DOM/class/style changes or fixed sleep is added. The source-only
validator accepts the new key but rejects null/false/empty objects, unknown keys,
non-string and whitespace-only selectors. Omitting `waitAfter` still works. The
bilateral v2 validator and schemas are otherwise unchanged.

The exact original action, including `waitAfter.hidden`, is retained in the
incremental started/performed/failed journal and successful action log. Existing
scoped verification binds the entire action object; removing or changing hidden
cannot reuse the reviewed action's evidence. A hidden timeout is a failed action,
not a performed action with a successful transition.

## Failed-state diagnostics

Every failure inside formal `capture()` attempts to save a content-addressed JSON
artifact under the current global/scoped evidence root:

```text
artifacts/<sha256>.json
kind: failed-state-diagnostic-not-capture
accepted: false
```

It records route, viewport, state, side, sanitized error, failed checkpoint and
the timestamped history of entered checkpoints:

- `state-ready`: the plan's visible ready selector;
- `media`: the explicit natural source media readiness policy;
- `fonts`: the unchanged `document.fonts.status === 'loaded'` wait;
- `stability`: animation context and repeated component measurements;
- `identity`: source block/privacy checks or document status/route/canonical/
  actual viewport/target identity checks;
- `assertions`: actual state postconditions;
- `screenshot`: screenshot capture and immediate post-screenshot media recheck.

An entered checkpoint is not a claim that it passed. The thrown error names the
failed checkpoint and diagnostic artifact path. For visibility/count assertion
failure it also names selector, read, expected and actual, rather than merely
"state postcondition failed". This error/reference is preserved in session errors
and the existing failed transition attempt journal.

### Timing and privacy

Diagnostics reuse only the most recent component observation already read before
failure, labelled `pre-failure-measurement` with `readAt`. They do **not** re-sample
after failure or wait for recovery. If media/fonts/state-ready failed before any
component observation, `observation` is null and the reason is explicit. This is
not a claim to have measured the failed pixels. Assertion rows preserve their
individual read timestamps/results; unexecuted rows say `not-read`, and read
errors remain distinguished from an actual false result.

Only planned state components are retained, with a whitelist of geometry, style,
visibility, topology and image-loaded flags. No body, controls, arbitrary DOM,
cookies, image URLs/alt text, component text or input values are saved in the
diagnostic. Assertion rows include selector/read/expected/actual/passed/status;
text/value expected and actual are explicitly redacted, while visibility/count
results remain literal. The actual URL is recorded with credentials, fragment
and query values removed/redacted. Error URLs/header fields are also sanitized.
Successful capture formats and their existing privacy policy are unchanged.

Diagnostics have no capture schema, screenshot binding or successful check.
They are not appended to `session.checks`, cannot be exported as captures and
cannot reopen a failed scope/gate. Screenshot artifacts written before a later
failure remain orphans, not accepted captures. If diagnostic persistence itself
fails, the thrown error reports both failures and does not claim a saved artifact.

## Isolated regressions

`tests/shopyy-capture-failure-diagnostics.test.ts` uses only localhost fixtures:

- finite CSS opacity fade with delayed `visibility:hidden` and stable geometry:
  no hidden wait fails, declared hidden wait passes all three devices;
- failed assertion artifact retains actual `visible: true` without body/input
  sentinel leakage or post-failure recovery measurements;
- a held local font request distinguishes `fonts` timeout from a natural media
  loader timeout at `media`; neither produces a successful transition;
- performed action journals survive capture failure;
- scoped verifier binds `hidden` exactly and rejects changed action evidence;
- malformed waitAfter is rejected and legacy optional/visible/absent forms pass.

These fixtures validate implementation only. They do not diagnose the cause of a
past real-site timeout, and do not upgrade existing failed evidence.
