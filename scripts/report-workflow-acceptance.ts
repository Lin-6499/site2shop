import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {access} from 'node:fs/promises';
import {readJson,write,escapeHtml as esc} from '../src/util.js';
const out=resolve('../westandwillow-phase3/acceptance-20261022-workflow');
const [source,target,audit]=await Promise.all(['product-family-source-evidence.json','product-family-target-evidence.json','product-family-visual-audit.json'].map(file=>readJson<any>(resolve(out,file))));
const rows:string[]=[];
for(const family of source.families) for(const viewport of ['desktop','tablet','mobile']) {
  const s=family.viewports.find((v:any)=>v.name===viewport);
  const tf=target.families.find((f:any)=>f.suffix===family.suffix);
  const t=tf?.viewports.find((v:any)=>v.name===viewport);
  const checks=audit.contractChecks.filter((c:any)=>c.suffix===family.suffix&&c.viewport===viewport);
  const failures=checks.filter((c:any)=>!c.passed);
  const links=(states:any[]) => (states||[]).map(state=>state.files?.form?`<a href="${esc(pathToFileURL(state.files.form).href)}">${esc(state.state)}</a>`:`${esc(state.state)}（截图缺失）`).join(' · ');
  const partial=async(mode:string)=>{
    const file=resolve(out,'product-family-evidence',mode,family.suffix,viewport,'initial-form.png');
    return await access(file).then(()=>`采集未完成：<a href="${esc(pathToFileURL(file).href)}">仅初始截图</a>（不计为通过）`).catch(()=>'缺失');
  };
  rows.push(`<tr><td>${esc(family.suffix)}<br><small>${esc(family.representative)}</small></td><td>${viewport}</td><td>${s?links(s.states):await partial('source')}</td><td>${t?links(t.states):await partial('target')}</td><td>${failures.length}/${checks.length}<br>${failures.map((f:any)=>esc(f.check)).join('<br>')}</td></tr>`);
}
const summary={sourceFamilies:source.families.length,sourceViewports:source.families.reduce((n:number,f:any)=>n+f.viewports.length,0),targetViewports:target.families.reduce((n:number,f:any)=>n+f.viewports.length,0),checks:audit.contractChecks.length,failed:audit.contractChecks.filter((c:any)=>!c.passed).length,sourceErrors:source.families.flatMap((f:any)=>f.errors.map((e:any)=>({family:f.suffix,error:e}))),targetErrors:target.families.flatMap((f:any)=>f.errors.map((e:any)=>({family:f.suffix,error:e})))};
const workflowFinding=`<h2>已直接复现：双宠商品 NEXT 工作流缺失</h2><table><tr><th>操作</th><th>原站</th><th>当前草稿</th></tr><tr><td>第一次 NEXT</td><td>进入尺寸/装框步骤；有返回、下一步</td><td>一次展开所有后续字段；直接显示 Add to cart</td></tr><tr><td>进入照片步骤</td><td>两组照片上传、两个名字、Artwork Preview</td><td>只有一组上传和一个名字</td></tr><tr><td>空照片继续</td><td>显示必填错误并留在当前步骤</td><td>没有同样的多步骤路径</td></tr></table><p>修复应先采集完整分支和返回路径，再在生成器中实现按商品族组合的步骤控制器；1/2/3/4 宠等边界样本须分别验证。<a href="${esc(pathToFileURL(resolve(out,'two-pet-workflow-diagnosis.json')).href)}">直接浏览器诊断记录</a></p>`;
await write(resolve(out,'acceptance-summary.json'),JSON.stringify(summary,null,2));
await write(resolve(out,'acceptance-report.html'),`<!doctype html><meta charset="utf-8"><title>商品族三端交互验收</title><style>body{font:15px/1.5 system-ui;max-width:1500px;margin:32px auto;padding:0 20px;color:#18262a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:10px;text-align:left;vertical-align:top}h1{font-size:28px}small{color:#65747a}a{color:#146581}code{word-break:break-all}.warning{background:#fff0dc;padding:16px}</style><h1>商品族三端交互验收：未通过</h1><p>${esc(audit.checkedAt)} · 源站 ${summary.sourceViewports}/${source.families.length*3} 组 · 目标 ${summary.targetViewports}/${source.families.length*3} 组 · 检查 ${summary.checks} 项，${summary.failed} 项失败。</p><p class="warning">本轮为诊断结果。仅覆盖采集器实际执行的初始、一个选项切换、可达 Next 步骤和附加项状态。必填上传阻止后续步骤时标记不完整；未执行成功上传、完整返回路径、全部选项组合或真实加购。像素差异仅作诊断，不能代表完整视觉验收通过。目标为已有草稿，部署记录与本地最新构建不一致，禁止据此批准发布。</p><p>直接浏览器复现：双宠源站按背景 → 尺寸/装框 → 两组照片/名字展开；现有草稿一次展开全部后续字段，且只有一组上传和名字。生成器需按产品工作流重建状态与校验。</p><table><tr><th>商品族/样本</th><th>视口</th><th>源站表单截图</th><th>草稿表单截图</th><th>失败检查</th></tr>${rows.join('')}</table><h2>采集错误</h2><pre>${esc(JSON.stringify({source:summary.sourceErrors,target:summary.targetErrors},null,2))}</pre>`);
const reportPath=resolve(out,'acceptance-report.html');
const {readFile}=await import('node:fs/promises');
await write(reportPath,(await readFile(reportPath,'utf8')).replace('<table><tr><th>商品族/样本',workflowFinding+'<h2>三端采集与验收清单</h2><table><tr><th>商品族/样本'));
console.log(JSON.stringify(summary,null,2));
