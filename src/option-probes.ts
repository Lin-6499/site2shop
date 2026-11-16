import type { Locator } from 'playwright';

/** Inventory first; failed clicks never shrink the planned denominator. */
export async function inventoryOptionGroups(scope:Locator){
 return await scope.evaluate(el=>{
  type RadioControl={key:string;value:string;id:string;label:string;index:number;disabled:boolean};
  const result:Array<{kind:'radio'|'select';name:string;id:string;baseline:string;values:string[];disabledValues:string[];disabled:boolean;controls?:RadioControl[]}>=[];
  const visible=Array.from(el.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter(input=>{
   const label=input.labels?.[0],box=label?.getBoundingClientRect(),style=label?getComputedStyle(label):null;
   return Boolean(input.name&&box?.width&&box.height&&style?.display!=='none'&&style?.visibility!=='hidden');
  });
  for(const name of [...new Set(visible.map(input=>input.name))]){
   const inputs=visible.filter(input=>input.name===name);
   const valueCounts=new Map<string,number>();
   for(const input of inputs)valueCounts.set(input.value,(valueCounts.get(input.value)||0)+1);
   const used=new Map<string,number>();
   const controls=inputs.map((input,index)=>{
    const label=(input.labels?.[0]?.textContent||'').replace(/\s+/g,' ').trim();
    let key=valueCounts.get(input.value)===1?input.value:(label||input.id||input.value);
    const occurrence=(used.get(key)||0)+1;used.set(key,occurrence);
    if(occurrence>1)key=`${key} [${occurrence}]`;
    return {key,value:input.value,id:input.id||'',label,index,disabled:input.disabled};
   });
   const checkedIndex=inputs.findIndex(input=>input.checked);
   result.push({kind:'radio',name,id:'',baseline:checkedIndex>=0?controls[checkedIndex].key:'',
    values:controls.filter(control=>!control.disabled).map(control=>control.key),
    disabledValues:controls.filter(control=>control.disabled).map(control=>control.key),disabled:false,controls});
  }
  for(const select of el.querySelectorAll<HTMLSelectElement>('select')){
   const b=select.getBoundingClientRect(),s=getComputedStyle(select);
   if(!b.width||!b.height||s.display==='none'||s.visibility==='hidden')continue;
   if(!select.id&&!select.name)throw Error('Visible select has no stable semantic locator');
   result.push({kind:'select',name:select.name,id:select.id,baseline:select.value,disabled:select.disabled,values:select.disabled?[]:[...select.options].filter(o=>!o.disabled).map(o=>o.value),disabledValues:[...select.options].filter(o=>o.disabled||select.disabled).map(o=>o.value)});
  }
  return result;
 });
}

export async function selectObservedOption(scope:Locator,group:Awaited<ReturnType<typeof inventoryOptionGroups>>[number],value:string){
 if(group.kind==='select'){
  const select=scope.locator(group.id?`select[id=${JSON.stringify(group.id)}]`:`select[name=${JSON.stringify(group.name)}]`);
  await select.selectOption(value);
  if(await select.inputValue()!==value)throw Error('Select did not retain observed value');
 }else{
  const control=group.controls?.find(item=>item.key===value);
  const input=control?.id
   ? scope.locator(`input[type="radio"][id=${JSON.stringify(control.id)}]`).first()
   : control
    ? scope.locator(`input[type="radio"][name=${JSON.stringify(group.name)}][value=${JSON.stringify(control.value)}]`).nth(control.index)
    : scope.locator(`input[type="radio"][name=${JSON.stringify(group.name)}][value=${JSON.stringify(value)}]`).first();
  if(!(await input.count()))throw Error(`Observed radio is no longer available: ${group.name}=${value}`);
  if(await input.isChecked())return;
  const id=await input.getAttribute('id');
  const explicit=id?scope.locator(`label[for=${JSON.stringify(id)}]`):null;
  try{
   if(explicit&&await explicit.count())await explicit.click({timeout:8000});
   else if(await input.locator('xpath=ancestor::label[1]').count())await input.locator('xpath=ancestor::label[1]').click({timeout:8000});
   else await input.check({timeout:8000});
  }catch{/* DOM click below preserves the same control event when overlays intercept pointer action. */}
  if(!(await input.isChecked().catch(()=>false)))await input.evaluate((node:HTMLInputElement)=>node.click());
  if(!(await input.isChecked().catch(()=>false))){
   try{await input.check({force:true,timeout:8000})}
   catch(error){throw Error(`Radio action failed for ${group.name}=${value}: ${String(error)}`)}
  }
  if(!(await input.isChecked().catch(()=>false)))throw Error(`Radio action did not select its observed value: ${group.name}=${value}`);
 }
}
