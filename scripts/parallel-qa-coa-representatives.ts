import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const root=path.resolve('../voidresearch-shopyy');
const dir=path.join(root,'verification/parallel-qa');
const index=JSON.parse(fs.readFileSync(path.join(dir,'coa-detail-review-index.json'),'utf8'));
const ids=['/coa/acc-2608170610','/coa/kvr-2026-146499','/coa/coa-2026-956935'];
const rows=index.rows.filter((x:any)=>ids.includes(x.sourcePath));
for(const row of rows)for(const ref of row.refs){const bytes=fs.readFileSync(path.join(root,ref.path));if(crypto.createHash('sha256').update(bytes).digest('hex')!==ref.sha256)throw Error(ref.path);}
const report={schemaVersion:1,reviewer:'/root/independent_qa',reviewedAt:new Date().toISOString(),scope:'Three laboratory-provider representative initial layouts across desktop, tablet and mobile. Directly inspected source and target viewport/full-page images only; not all25 page visual acceptance, PDF-content authenticity, live-source or target-platform acceptance.',reportSha256:index.reportSha256,developmentRenderSha256:index.developmentRenderSha256,rows:rows.map((x:any)=>({...x,visualReview:'pass-selected-initial-layout',observations:['Responsive columns/stack, verification panel and data rows remain aligned with frozen source.','Report image, Open PDF button, historical lot links and lower assurance/newsletter/footer regions are present without observed overlap or broken stitching.','ILS representative includes file fingerprint panel and Check this file control; visual presence does not prove its behavior.']})),openedImages:rows.flatMap((x:any)=>x.refs),directlyViewedImageCount:36,reviewedStateCount:9,remainingStateCount:66,pending:['Direct visual review of the remaining66 page/viewport sets.','Copy clipboard, provider links, PDF downloads and file-check checking/match/differs/read-error/retry interaction evidence (GET PDF hash verification, not a file-picker).','SHOPYY native implementation, destination mapping and saved-version three-device acceptance.'],verdict:'provisional-representative-static-layout-pass-only'};
fs.writeFileSync(path.join(dir,'coa-detail-three-device-representatives.review.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({reviewedStates:rows.length,openedImages:report.openedImages.length,remaining:66}));

