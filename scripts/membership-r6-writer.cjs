'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
class MembershipR6Writer{
 constructor(o){this.o=o;this.target={origin:'https://pepsss.zenshop.cn',skinId:'504457',role:'draft',pageGroup:'自定义页面',viewId:'default'};this.before=[];this.after=[];this.writes=[];}
 async open(){
  this.leases=require('./lib/shopyy-writer-leases.cjs');const leased=await this.leases.assertLease(this.o.lease,{origin:this.target.origin,scope:'theme-group',skinId:this.target.skinId,group:this.target.pageGroup,viewId:'default'});const task=JSON.parse(await fs.readFile(leased.taskFile,'utf8'));if(task.manifestSha256!==this.o.manifestSha256||task.packageVersion!=='r6-membership-native-bddb76eb66f4')throw Error('Lease task must bind exact reviewed package');
  const mb=await fs.readFile(path.join(this.o.packageDirectory,'manifest.json'));if(hash(mb)!==this.o.manifestSha256)throw Error('Fixed manifest changed');this.m=JSON.parse(mb);
  if(this.m.version!=='r6-membership-native-bddb76eb66f4'||this.m.publicationAllowed!==false||this.m.parts.length!==6)throw Error('Wrong fixed package');
  this.old=JSON.parse(await fs.readFile(path.join(this.o.root,'staging/local-inner-candidates/r3-membership-native-abbc9d1a8a50/manifest.json'),'utf8'));
  for(const p of this.m.parts)if(hash(await fs.readFile(path.join(this.o.packageDirectory,p.file)))!==p.sha256)throw Error('Changed part');
  await fs.mkdir(this.o.out,{recursive:true});const {chromium}=require('playwright');this.browser=await chromium.launch({headless:true});this.context=await this.browser.newContext({storageState:'D:/Documents/deepseek-harness/默认工作区/shopyy-login/zenshop-state.json',viewport:{width:1440,height:1000},locale:'en-US',timezoneId:'Asia/Shanghai'});this.page=await this.context.newPage();
  const{DraftEditor}=require('./lib/shopyy-draft-editor.cjs');this.DraftEditor=DraftEditor;this.editor=new DraftEditor(this.page,this.target,{writerLease:this.o.lease});await this.page.goto(this.target.origin+'/admin/card?theme_id=504457',{waitUntil:'domcontentloaded',timeout:25000});await this.editor.ensureGroup();this.count=await this.page.locator('span[title="自定义"]').count();return{group:this.target.pageGroup,count:this.count};
 }
 async baselineStep(){
  if(this.before.length>=this.count)throw Error('Baseline complete');await this.leases.heartbeat(this.o.lease);const index=this.before.length,html=await this.editor.select(index),id=html.match(/<(?:template|div) id="([^"]+)"/)?.[1];const row={index,id,sha256:hash(html),characters:html.length,file:'before-'+index+'.html'};
  if(id?.startsWith('vr-membership-')){const old=this.old.parts.find(p=>p.id===id);if(!old||old.sha256!==row.sha256)throw Error('Membership does not match exact installed r3 at '+index);}
  await fs.writeFile(path.join(this.o.out,row.file),html);this.before.push(row);return row;
 }
 async replaceStep(){
  if(this.before.length!==this.count||this.before.filter(p=>p.id?.startsWith('vr-membership-')).length!==6||this.m.parts.some(p=>this.before.filter(b=>b.id===p.id).length!==1))throw Error('All six unique old scopes and other consumers must be backed up');
  const filename=['shared-styles.html','dispatcher.html'][this.writes.length];if(!filename)throw Error('All replacements complete');await this.leases.heartbeat(this.o.lease);
  if(!this.writes.length)await this.leases.transition(this.o.lease,'writing');const p=this.m.parts.find(p=>p.file===filename),old=this.old.parts.find(p=>p.file===filename),baseline=this.before.filter(b=>b.id===p.id);if(baseline.length!==1)throw Error('Unique expected scope absent');
  const html=await fs.readFile(path.join(this.o.packageDirectory,p.file),'utf8');const result=await this.editor.writeVerified({version:this.m.version+'-'+filename.replace('.html',''),target:this.target,sourceManifestSha256:this.o.manifestSha256,component:{id:p.id,scope:'#'+p.id,sha256:p.sha256}},html,this.o.out,{reuseIndex:baseline[0].index,expectedPreviousSha:old.sha256,expectedPreviousRoot:old.id});this.writes.push(result);await this.leases.progress(this.o.lease,{completedParts:this.writes.length,totalParts:2,lastPart:filename,exact:true});return result;
 }
 async freshOpen(){if(this.writes.length!==2)throw Error('Two exact saves required');this.readerPage=await this.context.newPage();await this.readerPage.goto(this.target.origin+'/admin/card?theme_id=504457',{waitUntil:'domcontentloaded',timeout:25000});this.reader=new this.DraftEditor(this.readerPage,this.target);await this.reader.ensureGroup();if(await this.readerPage.locator('span[title="自定义"]').count()!==this.count)throw Error('Group count changed');return{freshServer:true,count:this.count};}
 async freshStep(){await this.leases.heartbeat(this.o.lease);const i=this.after.length,b=this.before[i];if(!b)throw Error('Fresh complete');const html=await this.reader.select(i,b.id),part=this.m.parts.find(p=>p.id===b.id),expected=part?part.sha256:b.sha256;if(hash(html)!==expected)throw Error('Fresh server mismatch at '+i);const row={index:i,id:b.id,sha256:hash(html),characters:html.length,exact:true,otherConsumerPreserved:!part,file:'fresh-'+i+'.html'};await fs.writeFile(path.join(this.o.out,row.file),html);this.after.push(row);return row;}
 async finish(){if(this.after.length!==this.count)throw Error('All blocks must independently reopen exact');const report={version:this.m.version,manifestSha256:this.o.manifestSha256,target:this.target,before:this.before,after:this.after,writes:this.writes,allExact:true,saveOutcomeKnown:true,published:false,publicationAllowed:false};const file=path.join(this.o.out,'writer-readback.json');await fs.writeFile(file,JSON.stringify(report,null,2));await this.leases.transition(this.o.lease,'server-readback',{saveOutcomeKnown:true,reportFile:file});return{file,allExact:true};}
 async close(){if(this.browser)await this.browser.close();}
}
module.exports={MembershipR6Writer};
