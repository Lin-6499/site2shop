import { join } from "node:path";
import { json, readJson } from "./util.js";
import { assertProductFamilyContracts } from "./product-family-contracts.js";
import { assertGeneratedThemeIntegrity } from "./theme-integrity.js";
import { assertReviewSystemViewportCoverage, assertVisualAuditPassed } from "./product-family-evidence.js";
import { assertPageFamilyDraftContracts } from "./page-family-contracts.js";
import { assertReviewedReleaseEvidence } from "./reviewed-release-evidence.js";

export async function approveRelease(out: string, reviewer: string) {
  if (!reviewer.trim()) throw new Error("A reviewer name is required.");
  const agentReview = await assertReviewedReleaseEvidence(out, "online", false);
  await assertGeneratedThemeIntegrity(out);
  await assertPageFamilyDraftContracts(out);
  await assertProductFamilyContracts(out);
  await assertReviewSystemViewportCoverage(out);
  await assertVisualAuditPassed(out);
  const [build, deployment, visual, preview] = await Promise.all([
    readJson<any>(join(out, "theme-build.json")),
    readJson<any>(join(out, "deployment.json")),
    readJson<any>(join(out, "product-family-visual-audit.json")),
    readJson<any>(join(out, "verification-shopify.json")).catch(() => readJson<any>(join(out, "verification.json"))),
  ]);
  if (deployment.role !== "unpublished" || deployment.published)
    throw new Error("Human approval is allowed only for an unpublished theme preview.");
  if (deployment.themeBuild !== build.id)
    throw new Error("The unpublished preview does not match the current generated build.");
  if (!preview.passed || preview.mode !== "shopify")
    throw new Error("Shopify preview verification has not passed.");
  const approval = {
    schemaVersion: 1,
    reviewer: reviewer.trim(),
    approvedAt: new Date().toISOString(),
    themeBuild: build.id,
    themeId: deployment.themeId,
    store: deployment.store,
    previewUrl: deployment.previewUrl,
    visualAuditCheckedAt: visual.checkedAt,
    agentVisualReviewCheckedAt: agentReview.reviewedAt,
    agentVisualEvidenceDigest: agentReview.evidenceDigest,
  };
  await json(join(out, "release-approval.json"), approval);
  return approval;
}

export async function assertReleaseApproval(out: string) {
  const [approval, build, deployment] = await Promise.all([
    readJson<any>(join(out, "release-approval.json")),
    readJson<any>(join(out, "theme-build.json")),
    readJson<any>(join(out, "deployment.json")),
  ]);
  if (approval.themeBuild !== build.id || String(approval.themeId) !== String(deployment.themeId) || approval.store !== deployment.store)
    throw new Error("Release approval is stale or belongs to another preview. Re-run preview tests and obtain human approval again.");
  return approval;
}
