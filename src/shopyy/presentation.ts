import {verifyFullPageGeometry} from './screenshot-geometry.js';
import {verifyReusedSourceSession} from './source-reuse.js';
import { join } from 'node:path';
import { applies, type Capture, type Plan } from './contracts.js';
import { canonical, jsonFile, readRef } from './artifacts.js';
import {createStylesheetBindingVerifier,PRESENTATION_STYLE_FIELDS} from './stylesheet-binding.js';

const CSS_FIELDS = ['width','height','fontSize','lineHeight','paddingTop','paddingRight','paddingBottom','paddingLeft','gap','gridTemplateColumns','display','flexDirection','overflowX','overflowY'];

/** A binding must consume a current observation, not merely mention its hash. */
export async function presentationCss(contract:any, plan:Plan, evidenceRoot:string,reuseContext?:Parameters<typeof verifyReusedSourceSession>[0],stylesheetContext?:Parameters<typeof createStylesheetBindingVerifier>[0]) {
  if(contract.schemaVersion!==2 || !Array.isArray(contract.bindings))throw Error('Verified presentation bindings required');
  const sourceEvidence=await jsonFile(join(evidenceRoot,'source.json'));
  const css:string[]=[], emitted:{selector:string;property:string;value:string;min:number;max:number;state:string}[]=[];
  const verifyStylesheets=stylesheetContext?createStylesheetBindingVerifier(stylesheetContext):null;
  for(const [rid,route] of Object.entries(plan.routes))for(const [vp,size] of Object.entries(plan.viewports))for(const [sid,state] of Object.entries(route.states)){
    if(!applies(state,vp))continue;
    for(const cid of state.components){
      const rows=contract.bindings.filter((b:any)=>b.route===rid&&b.viewport===vp&&b.state===sid&&b.component===cid);
      if(rows.length!==1)throw Error(`Exactly one consumed binding required: ${rid}/${vp}/${sid}/${cid}`);
      const b=rows[0],cap:Capture=JSON.parse((await readRef(evidenceRoot,b.sourceCapture)).toString());
      verifyFullPageGeometry(cap.captureEnvironment);
      const exported=contract.captures.find((c:any)=>c.route===rid&&c.viewport===vp&&c.state===sid);
      const session=sourceEvidence.sessions.find((s:any)=>s.route===rid&&s.viewport===vp);
      let sourcePlanSha=contract.planSha256;if(session?.sourceReuse){if(!reuseContext||sourceEvidence.planSha256!==contract.planSha256)throw Error('Current source reuse context required');sourcePlanSha=(await verifyReusedSourceSession(reuseContext,session)).planSha256;}
      const current=session?.checks.find((c:any)=>c.id===`state:${sid}`)?.before.source;
      if(!exported || canonical(current)!==canonical(b.sourceCapture)||canonical(exported.sourceCapture)!==canonical(b.sourceCapture)||cap.side!=='source'||cap.route!==rid||cap.viewport!==vp||cap.state!==sid||cap.planSha256!==sourcePlanSha)throw Error('Stale/unrelated binding observation');
      const selector=route.components[cid].selectorsByViewport?.[vp]?.target||route.components[cid].target;
      if(b.selector!==selector || /[{}<>]/.test(selector) || !Number.isFinite(b.range?.min)||!Number.isFinite(b.range?.max)||b.range.min>size.width||b.range.max<size.width)throw Error('Binding selector or breakpoint range mismatch');
      if(!Object.keys(b.styles||{}).length)throw Error('Binding has no consumed presentation properties');
      const literal=b.mode==='verified-source-stylesheet';
      if(b.mode!==undefined&&!literal)throw Error('Unsupported presentation binding mode');
      if(literal){
        const fields=PRESENTATION_STYLE_FIELDS.filter(field=>cap.components[cid]?.[field]!==undefined);
        if(!fields.length||canonical(Object.keys(b.styles).sort())!==canonical([...fields].sort()))throw Error('Stylesheet binding must retain all actual presentation fields');
        if(!verifyStylesheets)throw Error('Generated stylesheet consumer context required');
        await verifyStylesheets(evidenceRoot,cap,b,route);
      }
      const declarations=Object.entries<any>(b.styles).map(([property,value])=>{
        if(!CSS_FIELDS.includes(property)||value.field!==property||!['identity','px'].includes(value.transform))throw Error('Unsupported presentation mapping');
        const observed=cap.components[cid]?.[value.field];
        if(observed===undefined || canonical(observed)!==canonical(value.observed))throw Error(`Invented presentation value: ${cid}/${property}`);
        if(value.transform==='px'&&!Number.isFinite(observed))throw Error('px transform requires measured number');
        const actual=value.transform==='px'?`${observed}px`:String(observed);
        if(/[{};<>]/.test(actual))throw Error('Unsafe CSS value');
        if(!literal){for(const prior of emitted)if(prior.selector===selector&&prior.property===property&&prior.min<=b.range.max&&b.range.min<=prior.max&&prior.value!==actual)throw Error(`Conflicting state presentation requires an independently verified conditional mapping: ${rid}/${cid}/${property} (${prior.state} vs ${sid})`);
        emitted.push({selector,property,value:actual,min:b.range.min,max:b.range.max,state:sid});}
        return `${property.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())}:${actual}`;
      });
      css.push(literal?`/* verified-source-stylesheet ${rid}/${vp}/${sid}/${cid} ${b.sourceCapture.sha256} */`:`/* ${rid}/${vp}/${sid}/${cid} ${b.sourceCapture.sha256} */\n@media(min-width:${b.range.min}px) and (max-width:${b.range.max}px){${selector}{${declarations.join(';')}}}`);
    }
  }
  return css.join('\n');
}
