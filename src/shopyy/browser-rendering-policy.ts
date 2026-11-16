import type {LaunchOptions,Page} from 'playwright';
type Project={workflow?:{preserveClassicScrollbars?:boolean;ownedBrowserChannel?:'chrome'}};
/** Rendering-only policy for browsers owned by this workflow; attached Chrome is never relaunched. */
export function ownedHeadlessOptions(project:Project):LaunchOptions{
 if(project.workflow?.ownedBrowserChannel!==undefined&&project.workflow.ownedBrowserChannel!=='chrome')throw Error('Unsupported owned browser channel');
 return{headless:true,...(project.workflow?.ownedBrowserChannel?{channel:project.workflow.ownedBrowserChannel}:{}),...(project.workflow?.preserveClassicScrollbars===true?{ignoreDefaultArgs:['--hide-scrollbars']}:{})};
}
export async function observeScrollbarEnvironment(page:Page,project:Project,owned:boolean){
 const actual=await page.evaluate(()=>({innerWidth,innerHeight,clientWidth:document.documentElement.clientWidth,clientHeight:document.documentElement.clientHeight,bodyWidth:document.body.getBoundingClientRect().width,scrollHeight:document.documentElement.scrollHeight,verticalScrollbarWidth:innerWidth-document.documentElement.clientWidth}));
 return{ownedBrowserChannel:owned?(project.workflow?.ownedBrowserChannel||'bundled-chromium'):'existing-browser-unchanged',policy:owned?(project.workflow?.preserveClassicScrollbars===true?'owned-headless-preserve-classic-scrollbars':'owned-browser-defaults'):'existing-browser-unchanged',preserveClassicScrollbarsRequested:project.workflow?.preserveClassicScrollbars===true,...actual};
}
