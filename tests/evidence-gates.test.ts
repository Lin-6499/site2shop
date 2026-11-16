import test from "node:test";
import assert from "node:assert/strict";
import {
  hasCurrentProductEvidenceState,
  hasCurrentProductEvidenceReport,
  PRODUCT_EVIDENCE_COLLECTOR_VERSION,
  PRODUCT_EVIDENCE_CONTRACT_VERSION,
  PRODUCT_EVIDENCE_SCHEMA_VERSION,
} from "../src/product-family-evidence.js";
import { compareOptionSelects } from "../src/option-control-contracts.js";

const currentState = () => ({
  evidence: {
    schemaVersion: PRODUCT_EVIDENCE_SCHEMA_VERSION,
    contractVersion: PRODUCT_EVIDENCE_CONTRACT_VERSION,
    collectorVersion: PRODUCT_EVIDENCE_COLLECTOR_VERSION,
  },
  workflow: {fields: [], nextPresent: true},
  optionSelects: [],
  layout: {
    informationColumn: {
      metric: { box: { width: 400, height: 900 } },
      scroll: { mode: "document-flow" },
    },
  },
});

test("current product evidence requires versioned information-column behavior", () => {
  assert.equal(hasCurrentProductEvidenceState(currentState()), true);
});

test("legacy or incomplete product evidence is invalidated instead of reused", () => {
  const legacy = currentState();
  legacy.evidence.schemaVersion = 1;
  assert.equal(hasCurrentProductEvidenceState(legacy), false);

  const missingBehavior = currentState();
  delete (missingBehavior.layout.informationColumn as any).scroll;
  assert.equal(hasCurrentProductEvidenceState(missingBehavior), false);
  const missingWorkflow = currentState();
  delete (missingWorkflow as any).workflow;
  assert.equal(hasCurrentProductEvidenceState(missingWorkflow), false);
  const missingSelectEvidence = currentState();
  delete (missingSelectEvidence as any).optionSelects;
  assert.equal(hasCurrentProductEvidenceState(missingSelectEvidence), false);
});

test("aggregate evidence reports must use the current schema, contract, and collector", () => {
  const report = {
    schemaVersion: PRODUCT_EVIDENCE_SCHEMA_VERSION,
    contractVersion: PRODUCT_EVIDENCE_CONTRACT_VERSION,
    collectorVersion: PRODUCT_EVIDENCE_COLLECTOR_VERSION,
  };
  assert.equal(hasCurrentProductEvidenceReport(report), true);
  assert.equal(hasCurrentProductEvidenceReport({ ...report, collectorVersion: "1.0.0" }), false);
  assert.equal(hasCurrentProductEvidenceReport({ ...report, contractVersion: "old" }), false);
});

test("a residual overlay scroll lock cannot become valid product evidence", () => {
  const locked = currentState();
  locked.layout.informationColumn.scroll.mode = "invalid-scroll-lock";
  assert.equal(hasCurrentProductEvidenceState(locked), false);
});

test("native select evidence rejects missing captures, radio substitution and lost dependent availability", () => {
  const source = [{ key: "model", tag: "select", multiple: false, disabled: false, options: [{ value: "A", disabled: false }, { value: "B", disabled: true }] }];
  assert.equal(compareOptionSelects(source, structuredClone(source)).passed, true);
  assert.equal(compareOptionSelects(undefined, []).passed, false);
  assert.equal(compareOptionSelects(source, []).passed, false);
  assert.equal(compareOptionSelects(source, [{ ...source[0], tag: "radio" }]).passed, false);
  assert.equal(compareOptionSelects(source, [{ ...source[0], options: source[0].options.map(option => ({ ...option, disabled: false })) }]).passed, false);
  assert.equal(compareOptionSelects(source, [source[0], source[0]]).passed, false);
  assert.equal(compareOptionSelects([], []).passed, true);
});
