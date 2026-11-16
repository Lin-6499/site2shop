import type { Page } from 'playwright';

export type InteractionCaptureAdapter = {
  scope: string;
  controls: Array<{id:string;selector:string;labelAliases?:Record<string,string>}>;
  customSelectors?: string[];
};

/** Closed-world extraction: unmapped visible controls are retained, never dropped. */
export async function captureInteractionControls(page: Page, adapter: InteractionCaptureAdapter) {
  return page.evaluate(config => {
    const roots=[...document.querySelectorAll(config.scope)];
    if(!roots.length) throw new Error('Interaction inventory scope missing: '+config.scope);
    const normalize=(value:string)=>(value||'').replace(/\s+/g,' ').trim();
    const visible=(n:Element)=>{
      if(n.closest('[hidden],[inert]'))return false;
      const s=getComputedStyle(n),b=n.getBoundingClientRect();
      return s.display!=='none'&&s.visibility!=='hidden'&&s.visibility!=='collapse'&&Number(s.opacity)!==0&&b.width>0&&b.height>0;
    };
    const queries=['button','a[href]','input:not([type=hidden])','select','textarea','summary','[role=button]','[role=tab]','[onclick]','[data-bs-toggle]',...(config.customSelectors||[])];
    const candidates=[...new Set(roots.flatMap(root=>[...root.querySelectorAll(queries.join(','))]))];
    const configured=config.controls.map(c=>({...c,nodes:[...document.querySelectorAll(c.selector)]}));
    return candidates.filter(n=>visible(n)||('labels'in n&&[...(n as HTMLInputElement).labels||[]].some(visible))).map((node,index)=>{
      const element=node as HTMLInputElement;
      const match=configured.find(c=>c.nodes.some(n=>n===node||('control'in n&&(n as HTMLLabelElement).control===node)));
      const role=node.getAttribute('role')||(node.tagName==='A'?'link':node.tagName==='SELECT'?'combobox':node.tagName==='TEXTAREA'?'textbox':node.tagName==='SUMMARY'?'disclosure':node.tagName==='BUTTON'?'button':element.type||node.tagName.toLowerCase());
      const raw=normalize(node.getAttribute('aria-label')||element.labels?.[0]?.innerText||(node as HTMLElement).innerText||node.getAttribute('title')||element.name||node.tagName.toLowerCase());
      const label=match?.labelAliases?.[raw]||raw;
      const enabled=!element.disabled&&node.getAttribute('aria-disabled')!=='true';
      return{id:match?.id||'unplanned:'+role+':'+(node.id||raw)+':'+index,role,label,enabled};
    });
  },adapter);
}
