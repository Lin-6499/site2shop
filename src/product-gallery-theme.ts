export const productGalleryScript = String.raw`(()=>{
  const roots=document.querySelectorAll('[data-s2s-family-product],[data-s2s-portrait-product]');
  roots.forEach(root=>{
    if(root.dataset.s2sGalleryReady)return;
    root.dataset.s2sGalleryReady='true';
    const slides=[...root.querySelectorAll('[data-family-slide],[data-portrait-slide]')];
    const thumbs=[...root.querySelectorAll('[data-family-thumb],[data-portrait-thumb]')];
    const viewport=root.querySelector('[data-family-thumbs-viewport],[data-portrait-thumbs-viewport]');
    const track=root.querySelector('[data-family-thumbs-track],[data-portrait-thumbs-track]');
    const previous=root.querySelector('[data-family-previous],[data-portrait-previous]');
    const next=root.querySelector('[data-family-next],[data-portrait-next]');
    if(!slides.length||!thumbs.length||!viewport||!track)return;
    let current=Math.max(0,thumbs.findIndex(thumb=>thumb.hasAttribute('aria-current'))),start=0,size=0,perPage=1,frame=0,pointerStart=null;
    const render=()=>{const inset=start===0&&root.hasAttribute('data-s2s-harold-workflow')&&matchMedia('(max-width:575.98px)').matches?12:0;track.style.transform='translate3d('+(inset-start*(size+12))+'px,0,0)'};
    const reveal=index=>{
      if(root.hasAttribute('data-s2s-harold-workflow'))start=index;
      else if(index<start)start=index;
      else if(index>=start+perPage)start=index-perPage+1;
      start=Math.max(0,Math.min(start,Math.max(0,thumbs.length-perPage)));
      render();
    };
    const show=index=>{
      current=(Number(index)+slides.length)%slides.length;
      slides.forEach((slide,itemIndex)=>slide.hidden=itemIndex!==current);
      thumbs.forEach((thumb,itemIndex)=>{
        thumb.classList.toggle('is-active',itemIndex===current);
        if(itemIndex===current)thumb.setAttribute('aria-current','true');
        else thumb.removeAttribute('aria-current');
      });
      reveal(current);
    };
    const layout=()=>{
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{
        const width=viewport.clientWidth;
        const preferred=matchMedia('(max-width: 480px)').matches?114:matchMedia('(max-width: 800px)').matches?130:140;
        const nextPerPage=Math.max(1,Math.min(thumbs.length,Math.round((width+12)/(preferred+12))));
        const nextSize=Math.max(1,Math.min(preferred,(width-12*(nextPerPage-1))/nextPerPage));
        if(nextPerPage!==perPage||Math.abs(nextSize-size)>.1){perPage=nextPerPage;size=nextSize;viewport.style.setProperty('--s2s-thumb-size',size+'px')}
        reveal(current);
      });
    };
    previous?.addEventListener('click',()=>show(current-1));
    next?.addEventListener('click',()=>show(current+1));
    thumbs.forEach((thumb,index)=>thumb.addEventListener('click',()=>show(index)));
    viewport.addEventListener('keydown',event=>{
      if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight'&&event.key!=='Home'&&event.key!=='End')return;
      event.preventDefault();
      if(event.key==='Home')show(0);
      else if(event.key==='End')show(slides.length-1);
      else show(current+(event.key==='ArrowLeft'?-1:1));
      thumbs[current]?.focus({preventScroll:true});
    });
    viewport.addEventListener('pointerdown',event=>{if(event.pointerType!=='mouse')pointerStart=event.clientX},{passive:true});
    viewport.addEventListener('pointerup',event=>{if(pointerStart===null)return;const distance=event.clientX-pointerStart;pointerStart=null;if(Math.abs(distance)>36)show(current+(distance<0?1:-1))},{passive:true});
    root.addEventListener('s2s:media:show',event=>show(event.detail?.index||0));
    layout();
    show(current);
    if('ResizeObserver'in window)new ResizeObserver(layout).observe(viewport);
    else addEventListener('resize',layout,{passive:true});
  });
})();`;

export const productGalleryStyles = String.raw`[data-family-thumbs-viewport],[data-portrait-thumbs-viewport]{overflow:hidden;touch-action:pan-y}[data-family-thumbs-track],[data-portrait-thumbs-track]{contain:layout paint style;will-change:auto}@media(prefers-reduced-motion:reduce){[data-family-thumbs-track],[data-portrait-thumbs-track]{transition:none!important}}`;

export const portraitProductScript = String.raw`(()=>{
  const MAX=10485760,VALID=/^(image\/jpeg|image\/png|image\/webp)$/;
  let commerce={};
  try{commerce=JSON.parse(document.querySelector('#s2s-commerce-config')?.textContent||'{}')}catch{}
  const t=(key,fallback)=>commerce.text?.[key]||fallback;
  const cartRoot=commerce.root||window.Shopify?.routes?.root||'/';
  const request=async(path,options={})=>{const response=await fetch(cartRoot+path,{credentials:'same-origin',...options});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.description||data.message||t('failed','Could not add this product. Please try again.'));return data};
  const post=(path,data)=>request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  document.querySelectorAll('[data-s2s-portrait-product]').forEach(root=>{
    if(root.dataset.s2sPortraitReady)return;
    root.dataset.s2sPortraitReady='true';
    const form=root.querySelector('.s2s-portrait-form');
    if(!form)return;
    let variants=[];
    try{variants=JSON.parse(form.querySelector('[data-s2s-variants]')?.textContent||'[]')}catch{}
    let variantMedia={};
    try{variantMedia=JSON.parse(form.querySelector('[data-s2s-variant-media-map]')?.textContent||'{}')}catch{}
    let busy=false;
    const groups=[...form.querySelectorAll('[data-s2s-option-group]')],id=form.querySelector('[data-s2s-variant-id]'),submit=form.querySelector('[data-s2s-submit]'),status=form.querySelector('[data-s2s-status]'),price=root.querySelector('[data-s2s-price]'),subtotals=[...root.querySelectorAll('[data-s2s-subtotal]')],compare=root.querySelector('[data-s2s-compare]'),files=[...form.querySelectorAll('[data-s2s-photo]')],steps=[...form.querySelectorAll('[data-portrait-step]')],extraInputs=[...form.querySelectorAll('[data-s2s-addon]')],framingModes=[...form.querySelectorAll('[data-s2s-framing-mode]')],frameGroup=form.querySelector('.s2s-portrait-frame-styles');
    const money=cents=>new Intl.NumberFormat(document.documentElement.lang||'en-US',{style:'currency',currency:window.Shopify?.currency?.active||'USD'}).format(Number(cents||0)/100);
    const selected=()=>{const values=groups.map(group=>group.querySelector('input:checked')?.value||'');return variants.find(item=>item.options.every((value,index)=>value===values[index]))};
    const syncId=variant=>{if(!id)return;id.value=variant?.id||'';if(variant)id.setAttribute('value',String(variant.id));else id.removeAttribute('value')};
    if(id)new MutationObserver(()=>{const variant=selected();if(variant&&id.getAttribute('value')!==String(variant.id))syncId(variant)}).observe(id,{attributes:true,attributeFilter:['value']});
    extraInputs.forEach(input=>{let addon=[];try{addon=JSON.parse(form.querySelector('[data-s2s-addon-product="'+input.dataset.s2sAddon+'"]')?.textContent||'[]')}catch{}const variant=addon.find(item=>item.available)||addon[0];input.disabled=!variant?.available;input.value=variant?.id||'';input.dataset.price=variant?.price||'0';const amount=form.querySelector('label[for="'+input.id+'"] .money');if(amount&&variant)amount.textContent=money(variant.price)});
    const update=event=>{
      const values=groups.map(group=>group.querySelector('input:checked')?.value||'');
      groups.forEach((group,index)=>{const label=group.querySelector('[data-option-label]');if(label)label.textContent=values[index]||''});
      const variant=selected();
      syncId(variant);
      if(price)price.textContent=variant?money(variant.price):'';
      const total=(variant?.price||0)+extraInputs.filter(input=>input.checked&&!input.disabled).reduce((sum,input)=>sum+Number(input.dataset.price||0),0);
      subtotals.forEach(subtotal=>subtotal.textContent=variant?money(total):'');
      if(compare){const visible=variant?.compare_at_price>variant?.price;compare.hidden=!visible;if(visible)compare.textContent=money(variant.compare_at_price)}
      if(submit)submit.disabled=busy||!variant?.available;
      if(status)status.textContent=variant?'':t('unavailable','This combination is unavailable. Choose another option.');
      const mediaKey=variant?.options?.map(String).join('\u001f')||'';
      const mappedIndex=variant?Number(variantMedia[mediaKey]??variantMedia[String(variant.id)]):NaN;
      if(Number.isInteger(mappedIndex)&&mappedIndex>=0)root.dispatchEvent(new CustomEvent('s2s:media:show',{detail:{index:mappedIndex}}));
      else if(event?.target?.dataset.s2sOption==='0'){const position=[...groups[0].querySelectorAll('input')].findIndex(input=>input.checked);if(position>=0)root.dispatchEvent(new CustomEvent('s2s:media:show',{detail:{index:position}}))}
    };
    framingModes.forEach(mode=>mode.addEventListener('change',()=>{if(!mode.checked||!frameGroup)return;const options=[...frameGroup.querySelectorAll('input[data-s2s-option]')],poster=options.find(input=>/poster|no.?frame/i.test(input.value)),framed=options.find(input=>!(/poster|no.?frame/i.test(input.value))&&input.dataset.s2sLastFrame==='true')||options.find(input=>!(/poster|no.?frame/i.test(input.value)));const next=/no.?frame/i.test(mode.value)?poster:framed;if(next){next.checked=true;next.dispatchEvent(new Event('change',{bubbles:true}))}}));
    frameGroup?.querySelectorAll('input[data-s2s-option]').forEach(input=>input.addEventListener('change',()=>{if(!input.checked)return;const poster=/poster|no.?frame/i.test(input.value);frameGroup.querySelectorAll('input[data-s2s-option]').forEach(item=>delete item.dataset.s2sLastFrame);if(!poster)input.dataset.s2sLastFrame='true';const mode=framingModes.find(item=>poster?/no.?frame/i.test(item.value):!(/no.?frame/i.test(item.value)));if(mode)mode.checked=true}));
    const initialFrame=frameGroup?.querySelector('input[data-s2s-option]:checked');if(initialFrame&&!(/poster|no.?frame/i.test(initialFrame.value)))initialFrame.dataset.s2sLastFrame='true';const initialPoster=Boolean(initialFrame&&/poster|no.?frame/i.test(initialFrame.value));const initialMode=framingModes.find(item=>initialPoster?/no.?frame/i.test(item.value):!(/no.?frame/i.test(item.value)));if(initialMode)initialMode.checked=true;
    form.addEventListener('change',update);
    update();
    submit?.addEventListener('pointerdown',()=>syncId(selected()),true);
    submit?.addEventListener('click',()=>syncId(selected()),true);
    let currentStep=1;
    const showStep=number=>{currentStep=Math.max(1,Math.min(steps.length,number));steps.forEach(step=>step.hidden=Number(step.dataset.portraitStep)!==currentStep);root.dataset.s2sPortraitStep=String(currentStep);steps.find(step=>!step.hidden)?.querySelector('input,button,select')?.focus({preventScroll:true})};
    const validPhoto=file=>{const selectedFile=file?.files?.[0];return Boolean(selectedFile&&VALID.test(selectedFile.type)&&selectedFile.size>0&&selectedFile.size<=MAX)};
    const validPhotos=()=>files.length>0&&files.every(validPhoto);
    form.querySelectorAll('[data-portrait-next]').forEach(button=>button.addEventListener('click',()=>{if(currentStep===3&&!validPhotos()){if(status)status.textContent=t('invalid_photo','Choose a JPG, PNG or WebP photo up to 10 MB for every pet.');files.find(file=>!validPhoto(file))?.focus();return}if(status)status.textContent='';showStep(currentStep+1)}));
    form.querySelectorAll('[data-portrait-previous]').forEach(button=>button.addEventListener('click',()=>showStep(currentStep-1)));
    files.forEach(file=>{let previewUrl='';const instance=file.dataset.s2sPhotoInstance||'',preview=form.querySelector('[data-s2s-photo-preview="'+instance+'"]'),image=preview?.querySelector('.s2s-photo-image'),fileName=preview?.querySelector('[data-s2s-photo-name]');file.addEventListener('change',()=>{const selectedFile=file.files?.[0];if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=''}if(!selectedFile){if(preview)preview.hidden=true;return}if(!validPhoto(file)){file.value='';if(status)status.textContent=t('invalid_photo','Choose a JPG, PNG or WebP photo up to 10 MB.');if(preview)preview.hidden=true;return}if(status)status.textContent='';previewUrl=URL.createObjectURL(selectedFile);if(image)image.src=previewUrl;if(fileName)fileName.textContent=selectedFile.name;if(preview)preview.hidden=false})});
    showStep(1);
    const rollback=async group=>{const cart=await request('cart.js');const updates=Object.fromEntries(cart.items.filter(item=>item.properties?._s2s_group===group).map(item=>[item.key,0]));if(Object.keys(updates).length)await post('cart/update.js',{updates})};
    form.addEventListener('submit',async event=>{
      const variant=selected();
      syncId(variant);
      if(!variant?.available||!validPhotos()||!form.checkValidity()){
        event.preventDefault();
        if(status)status.textContent=!validPhotos()?t('invalid_photo','Choose a JPG, PNG or WebP photo up to 10 MB for every pet.'):t('unavailable','Choose an available option.');
        if(!validPhotos())showStep(3);
        form.reportValidity();
        return;
      }
      event.preventDefault();
      if(busy)return;
      busy=true;form.setAttribute('aria-busy','true');update();
      if(status)status.textContent=t('processing','Adding your product…');
      const picked=extraInputs.filter(input=>input.checked&&!input.disabled&&input.value),group=crypto.randomUUID();
      try{
        const existing=await request('cart.js');
        if(existing.items.some(item=>item.properties?._s2s_group===group))throw new Error(t('uncertain','Please check your cart before trying again.'));
        const data=new FormData(form);
        data.set('id',variant.id);
        data.set('quantity',String(Math.max(1,Number(data.get('quantity')||1))));
        data.set('properties[_s2s_group]',group);
        data.set('properties[_s2s_role]','portrait');
        const added=await request('cart/add.js',{method:'POST',body:data});
        const shared={};
        Object.entries(added.properties||{}).forEach(([key,value])=>{if(key.charAt(0)!=='_'&&value)shared[key]=value});
        const quantity=Math.max(1,Number(data.get('quantity')||1));
        const items=picked.map(input=>({id:Number(input.value),quantity,properties:{...shared,_s2s_group:group,_s2s_role:'addon'}}));
        if(items.length)await post('cart/add.js',{items});
        const cart=await request('cart.js'),attempt=cart.items.filter(item=>item.properties?._s2s_group===group);
        if(attempt.length!==items.length+1)throw new Error(t('uncertain','Please check your cart before trying again.'));
        location.assign(cartRoot+'cart');
      }catch(error){try{await rollback(group);if(status)status.textContent=error.message||t('failed','Could not add this product. Please try again.')}catch{if(status)status.textContent=t('uncertain','Please check your cart before trying again.')}busy=false;form.removeAttribute('aria-busy');update()}
    },true);
  });
})();`;
