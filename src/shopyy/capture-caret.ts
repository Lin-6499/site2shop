import type {Page} from 'playwright';
/** Hide the one focused editable caret once, avoiding screenshot's repeated whole-tree inline-style rewrites. */
export async function captureCaretScope(page:Page){
 const handle:any=await page.evaluateHandle(String.raw`(() => {
  let node=document.activeElement;while(node&&node.shadowRoot&&node.shadowRoot.activeElement)node=node.shadowRoot.activeElement;
  const editable=node&&(node.isContentEditable||node.tagName==='TEXTAREA'||node.tagName==='INPUT'&&!['button','submit','reset','checkbox','radio','range','color','file','image','hidden'].includes(node.type));
  if(!editable)return{node:null};
  const entry={node,style:node.getAttribute('style'),cssText:node.style.cssText,value:node.style.getPropertyValue('caret-color'),priority:node.style.getPropertyPriority('caret-color')};
  node.style.setProperty('caret-color','transparent','important');return entry;
 })()`);
 return{async close(){try{await handle.evaluate((entry:any)=>{if(!entry.node?.isConnected)return;if(entry.value)entry.node.style.setProperty('caret-color',entry.value,entry.priority);else entry.node.style.removeProperty('caret-color');if(entry.node.style.cssText===entry.cssText){if(entry.style===null)entry.node.removeAttribute('style');else entry.node.setAttribute('style',entry.style);}});}finally{await handle.dispose();}}};
}
