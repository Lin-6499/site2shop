import{digest}from'./artifacts.js';
export type SourceNativeCheckboxContract={scope:string;selector:'input[type="checkbox"]';sourceAppearance:'auto';sourceEvidence:{file:string;sha256:string};sourceFocusVisibleOutline?:'auto';sourceFocusEvidence?:{file:string;sha256:string};observedClasses:string;observedDimensions:{width:number;height:number}};
/** Explicit source-observed UA control paint restoration inside one owned block. No global reset or guessed border. */
export function sourceNativeCheckboxAdapter(contract:SourceNativeCheckboxContract){
 if(!/^#vr-block-[a-z][a-z0-9-]*$/.test(contract.scope)||contract.selector!=='input[type="checkbox"]'||contract.sourceAppearance!=='auto'||!contract.sourceEvidence?.file||!/^[a-f0-9]{64}$/.test(contract.sourceEvidence.sha256)||!contract.observedClasses.trim()||contract.observedDimensions?.width!==16||contract.observedDimensions?.height!==16)throw Error('Explicit scoped observed native-checkbox contract required');
 if(contract.sourceFocusVisibleOutline!==undefined&&(contract.sourceFocusVisibleOutline!=='auto'||!contract.sourceFocusEvidence?.file||!/^[a-f0-9]{64}$/.test(contract.sourceFocusEvidence.sha256)))throw Error('Observed source native focus outline evidence required');
 const selector=contract.scope+' '+contract.selector;const css=contract.scope+' '+contract.selector+'{appearance:auto;-webkit-appearance:auto}'+(contract.sourceFocusVisibleOutline==='auto'?selector+':focus-visible{outline:revert}':'');
 return{kind:'source-native-checkbox-paint-adapter',contract,css,sha256:digest(css),policy:'Only restore source observed UA appearance; preserve source geometry, accent, state, semantics and source-native border paint. No theme-global/input/text/select reset.'};
}
