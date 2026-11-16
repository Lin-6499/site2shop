import { assertExecutableEvidence, loadEvidencePlan } from "./evidence-gate.js";
import { assertAgentVisualReview, type AgentVisualReviewStage } from "./agent-visual-review.js";
import { assertOptionMediaAcceptance } from "./option-media-gate.js";

// Both independent gates run, even when one fails. An absent review must not
// conceal a measured media defect, nor may a green objective audit waive review.
// These are local, non-publishing checks; all external work stays after the join.
export async function assertReviewedReleaseEvidence(out: string, stage: AgentVisualReviewStage, optionMedia: boolean, options: {full?:boolean} = {}) {
  await loadEvidencePlan(out);
  const results = await Promise.allSettled([
    (async () => {
      const objective=await assertExecutableEvidence(out, stage, options);
      if (optionMedia) await assertOptionMediaAcceptance(out, stage, 'routeIds' in objective ? objective.routeIds as string[] : undefined);
    })(),
    assertAgentVisualReview(out, stage, options),
  ]);
  const errors = results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map(r => r.reason);
  if (errors.length) throw new AggregateError(errors, errors.map(error => String(error)).join("\n"));
  return (results[1] as PromiseFulfilledResult<any>).value;
}
