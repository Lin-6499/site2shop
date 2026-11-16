'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]),pipeline='verification/incremental-draft-504457/pipeline/';
const read=async f=>JSON.parse(await fs.readFile(path.join(root,f),'utf8'));
const ref=async file=>({file,sha256:crypto.createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex')});
(async()=>{
 const file='verification/content-after-cleanup-root-isolation-r2/report.json',report=await read(file);
 assert.equal(report.passed,true);assert.equal(report.rows.length,18);assert.ok(report.rows.every(r=>r.passed));
 const baseline='verification/coa-directory-cleanup-r5/native-trials/r1-coa-directory-cleanup-native-1c090c1bd591/fresh37-baseline.json';
 assert.equal((await ref(baseline)).sha256,'e98ddab4fdc66fef31a446b84892b69a9adff1eadcfdea0db110d1bfeb43f911');
 await fs.writeFile(path.join(root,'verification/content-after-cleanup-root-isolation-r2/root-review.json'),JSON.stringify({reviewer:'/root',report:await ref(file),baseline:await ref(baseline),passed:true,cases:18,scope:'Actual three-device six-route content isolation and member checkbox/policy tab after COA cleanup R6; two representative COA details only. Not full visual or business acceptance.',published:false,remoteWrites:false},null,2));
 const registryFile=pipeline+'page-status-registry.json',reg=await read(registryFile),row=reg.workstreams.find(x=>x.name==='共享内容组修复后独立回归');
 Object.assign(row,{version:'content-after-cleanup-root-isolation-r2',generation:'R6 cleanup保存后三端6路由18实际观察',review:'根独立18/18通过；会员checkbox往返/政策tab切换及两个COA代表详情',readback:'当前37含COA12=799203、Contact3=92c765；R6 e98ddab4基线',acceptance:'18/18共享隔离有限通过；整站视觉及业务未验收',wait:'本批完成；后续4槽预览候选仍须同组回归，不继承此次验收'});
 await fs.writeFile(path.join(root,registryFile),JSON.stringify(reg,null,2));
 await require('./lib/shopyy-progress.cjs').sync(path.join(root,pipeline+'writer-queue'));
 console.log(JSON.stringify({cases:18,passed:true,published:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
