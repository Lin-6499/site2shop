/** Only owned content routes use the verified editor preview rendering context. */
export function shopyyDraftRoute(href:string):string {
  if(!href.startsWith('/')||href.startsWith('//'))return href;
  const url=new URL(href,'https://pepsss.zenshop.cn');
  if(!(url.pathname==='/'||/^\/(products|collections|pages|search|blogs)(\/|$)/.test(url.pathname)))return href;
  for(const [key,value] of Object.entries({theme_id:'504457',preview:'1',is_theme_edit:'1'}))url.searchParams.set(key,value);
  return url.pathname+url.search+url.hash;
}
