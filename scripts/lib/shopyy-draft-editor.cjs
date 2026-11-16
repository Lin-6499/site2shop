const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

// Only standard visible editor controls. No HTTP mutations, Vue internals or publication actions.
class DraftEditor {
  constructor(page, target, options={}) { this.page=page; this.target=target; this.lastClick=Date.now(); this.lockFile=options.lockFile||options.writerLease?.readerLockFile||null; this.writerLease=options.writerLease||null; }
  async assertWritable() {
    await this.assertIdentity();
    await require('./shopyy-writer-leases.cjs').assertLease(this.writerLease,{origin:this.target.origin,scope:'theme-group',skinId:this.target.skinId,group:this.target.pageGroup||'首页',viewId:this.target.viewId||'default'});
    if(!this.lockFile)throw Error('Reader lock registry required for writer');
    let locks;try{locks=JSON.parse(await fs.readFile(this.lockFile,'utf8'));}catch(e){if(e.code==='ENOENT')return;throw e;}
    if(locks.target?.origin!==this.target.origin||locks.target?.skinId!==this.target.skinId)throw Error('Page lock target mismatch');
    if(!locks.active||!locks.groups.includes(this.target.pageGroup||'首页'))return;
    let release;try{release=JSON.parse(await fs.readFile(locks.releaseFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    if(release?.batchId===locks.batchId&&release.writerMayResume===true)return;
    throw Error('Page group is locked for independent readonly verification: '+locks.batchId);
  }
  async ensureGroup() {
    const group=this.target.pageGroup||'首页',field=this.page.locator('input[placeholder="请选择"]').first();
    await field.waitFor({state:'visible',timeout:45000});
    // Actual initial index/index data can take 28 seconds. Switching earlier
    // lets its late response replace the requested page's already-loaded list.
    await this.page.locator('span[title="头部"]').waitFor({state:'visible',timeout:45000});
    const actualTitle={'商品详情页':'商品详情','专辑详情':'专辑详情','自定义页面':'自定义详情'}[group];
    if(await field.inputValue()===group&&actualTitle&&!await this.page.locator('span[title="'+actualTitle+'"]').isVisible()){
      // Recover an observed dropdown/content mismatch through real UI only.
      // Await the matching data response before selecting a different group.
      const homeData=this.waitForThemeData('index/index').catch(error=>({error}));
      await this.click(field);await this.click(this.page.locator('.el-select-dropdown__item').filter({hasText:/^首页$/}).filter({visible:true}));
      const result=await homeData;if(result?.error)throw result.error;
      await this.page.waitForFunction(()=>document.querySelector('input[placeholder="请选择"]')?.value==='首页'&&!document.querySelector('span[title="自定义详情"],span[title="商品详情"],span[title="专辑详情"]')&&!!document.querySelector('span[title="头部"]'),undefined,{timeout:45000});
    }
    if(await field.inputValue()!==group){
      const contentData=group==='自定义页面'?this.waitForThemeData('page/detail').catch(error=>({error})):null;
      await this.click(field);const option=this.page.locator('.el-select-dropdown__item').filter({hasText:new RegExp('^'+group+'$')}).filter({visible:true});await option.waitFor({state:'visible',timeout:7000});await this.click(option);
      // Product/collection now require selecting their real template subgroup.
      // This is an editor-context picker, never create/bind/rename a group.
      if(['商品详情页','专辑详情'].includes(group)){
        const picker=this.page.getByRole('dialog').filter({visible:true}).filter({has:this.page.getByText('选择分组',{exact:true})});
        await picker.waitFor({state:'visible',timeout:7000});
        // Observed async table: the name cell contains default and a separate
        // count cell describes unbound records. Wait for the actual data row,
        // rather than counting before the picker has loaded its radio/table.
        const row=picker.locator('tbody tr').filter({has:this.page.locator('td[data-col-key="name"]').filter({hasText:/^\s*default\s*$/})});
        await row.waitFor({state:'visible',timeout:12000});
        if(await row.count()!==1)throw Error('Observed default template subgroup is missing or ambiguous');
        const radio=row.locator('input[type="radio"]');
        if(await radio.count()!==1)throw Error('Default template subgroup radio is ambiguous');
        if(!await radio.isChecked())await this.click(row.locator('label.n-radio'));
        if(!await radio.isChecked())throw Error('Default subgroup selection not confirmed');
        await this.click(picker.getByRole('button',{name:'确定',exact:true}));await picker.waitFor({state:'hidden',timeout:7000});
      }
      await this.page.waitForFunction(expected=>document.querySelector('input[placeholder="请选择"]')?.value===expected,group,{timeout:7000});
      if(contentData){const result=await contentData;if(result?.error)throw result.error;}
      await this.page.waitForTimeout(1200);
    }
    if(actualTitle)await this.page.locator('span[title="'+actualTitle+'"]').waitFor({state:'visible',timeout:45000});
    await this.assertIdentity();
  }
  async waitForThemeData(route){
    const response=await this.page.waitForResponse(r=>{const u=new URL(r.url());return u.origin===this.target.origin&&u.pathname==='/api/themes/'+this.target.skinId+'/data'&&u.searchParams.get('route')===route&&r.status()===200;},{timeout:45000});
    const data=await response.json();
    if(data.code!==0||!data.data?.sections||typeof data.data.sections!=='object'||Object.keys(data.data.sections).length===0)throw Error('Editor page data did not contain actual sections for '+route);
    return{route,sections:Object.keys(data.data.sections).length};
  }
  async assertIdentity() {
    const u=new URL(this.page.url());
    if(this.target.role!=='draft'||u.origin!==this.target.origin||u.pathname!=='/admin/card'||u.searchParams.size!==1||u.searchParams.getAll('theme_id').length!==1||u.searchParams.get('theme_id')!==this.target.skinId) throw Error('Draft editor identity mismatch');
    if((this.target.viewId||'default')!=='default'||await this.page.getByText('默认视角',{exact:true}).filter({visible:true}).count()!==1)throw Error('Only observed default editor view is owned');
    const selected=await this.page.locator('input[placeholder="请选择"]').first().inputValue();
    if(selected!==(this.target.pageGroup||'首页')) throw Error('This writer does not own the selected page group');
  }
  async click(locator) {
    // The real editor ignores rapid successive selections; verify state after each meaningful click.
    const remaining=1150-(Date.now()-this.lastClick);
    if(remaining>0) await this.page.waitForTimeout(remaining);
    const visible=locator.filter({visible:true});
    if(await visible.count()!==1) throw Error('Editor control is absent or ambiguous');
    await visible.click({timeout:7000}); this.lastClick=Date.now();
  }
  async select(index, expectedRoot) {
    await this.assertIdentity();
    await this.click(this.page.locator('span[title="自定义"]').nth(index));
    try { await this.page.waitForFunction(i=>[...document.querySelectorAll('span[title="自定义"]')][i]?.parentElement.classList.contains('active'),index,{timeout:2500}); }
    catch(error) {
      if(error.name!=='TimeoutError'||await this.page.getByRole('dialog').filter({visible:true}).count())throw error;
      await this.assertIdentity();
      await this.click(this.page.locator('span[title="自定义"]').nth(index));
      await this.page.waitForFunction(i=>[...document.querySelectorAll('span[title="自定义"]')][i]?.parentElement.classList.contains('active'),index,{timeout:5000});
    }
    const field=this.page.locator('textarea[placeholder="请输入代码"]');
    await field.waitFor({state:'visible',timeout:5000});
    if(expectedRoot) await this.page.waitForFunction(id=>document.querySelector('textarea[placeholder="请输入代码"]')?.value.includes(`id="${id}"`),expectedRoot,{timeout:5000});
    return field.inputValue();
  }
  async create() {
    await this.assertWritable();
    const before=await this.page.locator('span[title="自定义"]').count();
    await this.click(this.page.getByText('添加积木块',{exact:true}));
    const item=this.page.getByRole('listitem',{name:'点击插入卡片',exact:true}).filter({hasText:/^自定义$/});
    try { await item.waitFor({state:'visible',timeout:2500}); }
    catch(error) {
      if(error.name!=='TimeoutError'||await this.page.getByRole('heading',{name:'基础积木',exact:true}).isVisible()||await this.page.locator('span[title="自定义"]').count()!==before) throw error;
      // An ignored click is observable: the palette is closed and no block was added.
      await this.assertIdentity();
      await this.click(this.page.getByText('添加积木块',{exact:true}));
      await item.waitFor({state:'visible',timeout:5000});
    }
    await this.click(item);
    await this.page.waitForFunction(n=>document.querySelectorAll('span[title="自定义"]').length===n+1,before,{timeout:5000});
    await this.page.locator('textarea[placeholder="请输入代码"]').waitFor({state:'visible',timeout:5000});
    await this.page.waitForFunction(i=>[...document.querySelectorAll('span[title="自定义"]')][i]?.parentElement.classList.contains('active')&&document.querySelector('textarea[placeholder="请输入代码"]')?.value.length===136,before,{timeout:5000});
    return before;
  }
  async install(packageDirectory, verificationDirectory, options={}) {
    await this.assertIdentity();
    const manifest=JSON.parse(await fs.readFile(path.join(packageDirectory,'manifest.json'),'utf8'));
    if(manifest.publicationAllowed!==false||manifest.target?.origin!==this.target.origin||manifest.target?.skinId!==this.target.skinId||manifest.target?.role!=='draft') throw Error('Package target or publication boundary mismatch');
    const component=manifest.component;
    if(!component||!/^#[a-zA-Z0-9_-]+$/.test(component.scope)||path.basename(component.file)!==component.file) throw Error('Unsupported package');
    const html=await fs.readFile(path.join(packageDirectory,component.file),'utf8');
    if(digest(html)!==component.sha256||html.includes('site2shop-assets.invalid')) throw Error('Unverified package or unresolved hosted asset');
    return this.writeVerified(manifest,html,verificationDirectory,options);
  }
  async installPart(packageDirectory, verificationDirectory, filename, options={}) {
    await this.assertIdentity();
    const raw=await fs.readFile(path.join(packageDirectory,'manifest.json'),'utf8'),manifest=JSON.parse(raw);
    if(this.target.pageGroup!=='自定义页面'||manifest.publicationAllowed!==false||manifest.target?.origin!==this.target.origin||manifest.target?.skinId!==this.target.skinId||manifest.target?.pathname!=='/pages/Contact-Us')throw Error('Content part target mismatch');
    const part=manifest.parts?.find(p=>p.file===filename);
    if(!part||path.basename(filename)!==filename||!manifest.installationOrder.includes(filename))throw Error('Unknown content part');
    const html=await fs.readFile(path.join(packageDirectory,filename),'utf8');
    if(digest(html)!==part.sha256||html.length!==part.characters||html.includes('site2shop-assets.invalid'))throw Error('Content part drift or unresolved asset');
    const roots=[...html.matchAll(/<(?:template|div) id="(vr-contact-[a-z-]+)"/g)];
    if(roots.length!==1)throw Error('Content part must have exactly one stable owned root');
    const match=roots[0];
    return this.writeVerified({version:manifest.version+'-'+filename.replace('.html',''),target:manifest.target,sourceManifestSha256:digest(raw),component:{id:filename,scope:'#'+match[1],sha256:part.sha256}},html,verificationDirectory,options);
  }
  async writeVerified(manifest,html,verificationDirectory,options={}) {
    await this.assertWritable();
    const component=manifest.component;
    const index=options.reuseIndex===undefined?await this.create():options.reuseIndex;
    if(options.reuseIndex!==undefined) await this.select(index);
    const field=this.page.locator('textarea[placeholder="请输入代码"]');
    const original=await field.inputValue();
    const blank=original.length===136&&original.includes('Heading')&&original.includes('Body content');
    const previousRoot=options.expectedPreviousRoot||component.scope.slice(1);
    if(!/^[a-zA-Z0-9_-]+$/.test(previousRoot)||!blank&&(!options.expectedPreviousSha||digest(original)!==options.expectedPreviousSha||!original.includes(`id="${previousRoot}"`)))throw Error('Refusing unknown or drifted nonempty block');
    await fs.mkdir(verificationDirectory,{recursive:true});
    if(!blank)await fs.writeFile(path.join(verificationDirectory,`before-${manifest.version}-${digest(original)}.html`),original);
    const full=this.page.getByRole('switch').first(),originalFullWidth=await full.getAttribute('aria-checked');
    await this.assertWritable();
    await field.fill(html);
    await field.press('Tab');
    await this.page.waitForTimeout(1200);
    if(await full.getAttribute('aria-checked')!=='true') await this.click(full);
    await this.page.waitForTimeout(1500);
    const verificationPage=await this.page.context().newPage();
    let result;
    try {
      await verificationPage.goto(this.page.url(),{waitUntil:'domcontentloaded',timeout:25000});
      const reader=new DraftEditor(verificationPage,this.target);
      await reader.ensureGroup();
      await verificationPage.locator('span[title="自定义"]').nth(index).waitFor({state:'visible',timeout:15000});
      const readback=await reader.select(index,component.scope.slice(1));
      if(digest(readback)!==component.sha256) throw Error('Saved package readback mismatch');
      await fs.mkdir(verificationDirectory,{recursive:true});
      const readbackFile=`saved-${manifest.version}.html`;
      await fs.writeFile(path.join(verificationDirectory,readbackFile),readback);
      result={version:manifest.version,sourceManifestSha256:manifest.sourceManifestSha256,component:component.id,index,characters:readback.length,sha256:digest(readback),readbackFile,exact:true,target:this.target,capturedAt:new Date().toISOString(),wholeSiteAccepted:false,published:false};
      await fs.writeFile(path.join(verificationDirectory,`saved-${manifest.version}.json`),JSON.stringify(result,null,2));
    } catch(error) {
      // Restore the exact pre-write content for both new blocks and verified replacements.
      await this.assertWritable();
      await this.select(index);
      await field.fill(original);
      await field.press('Tab');
      if(await full.getAttribute('aria-checked')!==originalFullWidth)await this.click(full);
      throw error;
    } finally { await verificationPage.close(); }
    return result;
  }
}
module.exports={DraftEditor};
