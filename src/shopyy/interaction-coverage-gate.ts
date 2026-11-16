import {readRef} from './artifacts.js';
import {validCoverageRef,validateInteractionCoverage,validateCoverageSourceMatrix,type CoveragePlan,type CoverageStage} from './interaction-coverage.js';

/** Call in gate() immediately after validatePlan(), BEFORE its plan/findings early return.
 * Ref is optional for old projects. The main's new full-site plan MUST carry its fixed Ref.
 * Call for every stage; requireReview:false and scoped capture cannot bypass this hook.
 * On integration change imports to ./artifacts.js and ./interaction-coverage.js.
 */
export async function interactionCoverageFindings(root:string,plan:CoveragePlan,stage:CoverageStage):Promise<string[]>{
 if(plan.interactionCoverage===undefined)return[];
 try{
  const contract=JSON.parse((await readRef(root,plan.interactionCoverage)).toString());
  const errors=validateInteractionCoverage(plan,contract,stage);
  if(!validCoverageRef(contract.sourceMatrix))return errors;
  try{const snapshot=JSON.parse((await readRef(root,contract.sourceMatrix)).toString());errors.push(...validateCoverageSourceMatrix(contract,snapshot));}
  catch(error){errors.push('interaction-coverage: sourceMatrix readRef failed: '+String(error));}
  return errors;
 }catch(error){return['interaction-coverage: contract readRef/JSON failed: '+String(error)];}
}
