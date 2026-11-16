import postcss from 'postcss';
import {load} from 'cheerio';
import {digest} from './artifacts.js';

/** Repackage shared component HTML/CSS for an explicitly provisional custom block.
 * This is a transport adapter, not a second page implementation or accepted build.
 */
export function compileCustomBlock(input:{id:string;html:string;css:string;assetMap?:Record<string,string>;routeMap?:Record<string,string>;rootAttributes?:Record<string,string>;styleStatesHtml?:string[]}){
 if(!/^[a-z][a-z0-9-]+$/.test(input.id))throw Error('Invalid owned block ID');
 const scope=`#vr-block-${input.id}`;
 const html=input.html.replace(/\{\{(asset|route):([^{}]+)\}\}/g,(_,kind,key)=>{
  const value=(kind==='asset'?input.assetMap:input.routeMap)?.[key];if(!value)throw Error(`Block requires a verified ${kind} mapping: ${key}`);return value;
 });
 if(/\{\{/.test(html))throw Error('Unexpanded custom block input');
 const $=load(`<div id="vr-block-${input.id}" class="bg-[#f4f5f7] text-neutral-900 font-sans antialiased">${html}</div>`,null,false),css=postcss.parse(input.css);
 for(const[key,value]of Object.entries(input.rootAttributes||{})){
  if(!/^data-vr-[a-z-]+$/.test(key))throw Error('Only owned data-vr root attributes are supported');
  $(scope).attr(key,value);
 }
 const styleProbe=input.styleStatesHtml?.length?load($.html(),null,false):$;
 if(styleProbe!==$)styleProbe(scope).append(input.styleStatesHtml!.join(''));
 const keyframes=(rule:any)=>{for(let p=rule.parent;p;p=p.parent)if(p.type==='atrule'&&/keyframes$/.test(p.name))return true;return false;};
 // Escaped ampersands in Tailwind arbitrary-variant class names are ordinary
 // selector characters, not nesting operators. They still need the owned scope.
 const nested=(selector:string)=>{let attribute=0,quote='';for(let i=0;i<selector.length;i++){const char=selector[i];if(char==='\\'){i++;continue;}if(quote){if(char===quote)quote='';continue;}if(char==='"'||char==="'"){quote=char;continue;}if(char==='[')attribute++;else if(char===']')attribute--;else if(char==='&'&&attribute===0)return true;}return false;};
 css.walkRules(rule=>{
  if(keyframes(rule)||nested(rule.selector))return;
  const selector=rule.selector;
  if(/:root|:host|^html\b|^body\b/.test(selector))return;
  // Test actual shared markup; nested dynamic selectors remain with their matched parent.
  try{if(!styleProbe(selector.replace(/:(hover|active|focus-visible|focus-within|focus|visited)(?![\w-])/g,'')).length)rule.remove();}catch{/* Preserve unfamiliar CSS rather than silently omit it. */}
 });
 css.walkRules(rule=>{
  if(keyframes(rule)||nested(rule.selector))return;
  rule.selector=rule.selectors.map(s=>{
   const selector=s.replace(/:root|:host|\bhtml\b|\bbody\b/g,scope);
   return selector.includes(scope)?selector:`${scope} ${selector}`;
  }).join(',');
 });
 // Host theme styles are unlayered; flatten source layers while retaining their order.
 css.walkAtRules('layer',rule=>{if(rule.nodes)rule.replaceWith(...rule.nodes);else rule.remove();});
 const animations=new Set<string>();css.walkDecls(d=>{if(/^animation(?:-name)?$/.test(d.prop))d.value.split(/[ ,]/).forEach(v=>animations.add(v));});
 css.walkAtRules(rule=>{if(/keyframes$/.test(rule.name)&&!animations.has(rule.params))rule.remove();});
 // Source measurements use a 16px root. A merchant theme's different html size
 // must not rescale this component's shared rem dimensions or breakpoints.
 const pixels=(value:string)=>value.replace(/(-?(?:\d*\.)?\d+)rem\b/g,(_,n)=>`${Number(n)*16}px`);
 css.walkDecls(d=>{d.value=pixels(d.value);});css.walkAtRules(a=>{a.params=pixels(a.params);});
 css.walkComments(n=>{n.remove();});
 const host=`.block_html:has(> ${scope}){padding:0!important;max-width:none!important;width:100%!important}[id^="block-section-"]:has(> .block_html > ${scope}){margin:0!important;padding:0!important}`;
 const block=`<!-- Void Research ${input.id}: provisional draft component; no publication approval -->\n<style>${css.toString()}\n${host}\n${scope}{font-size:16px;font-family:var(--font-sans);line-height:1.5;color:var(--color-neutral-900);background:#f4f5f7;text-align:left;overflow:visible} ${scope},${scope} *{box-sizing:border-box}</style>\n${$.html()}`;
 return{html:block,sha256:digest(block),characters:block.length,scope,sourceHtmlSha256:digest(input.html),sourceCssSha256:digest(input.css)};
}
