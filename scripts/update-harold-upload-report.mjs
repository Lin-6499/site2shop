import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const out = resolve('../haroldhome-skill-test-20261022');
const supplemental = {
  testedAt: new Date().toISOString(),
  source: 'https://haroldhome.co/products/custom-house-portrait',
  authorization: 'User explicitly allowed a file upload. No add-to-cart or checkout authorization was inferred.',
  testFile: {
    name: 'desktop-home-initial.png',
    size: '95 KB',
    privacy: 'Generated test screenshot with no user personal data',
  },
  upload: {
    providerState: 'idle',
    accepted: true,
    visibleErrors: [],
    nextStateReached: 'Any Extras?',
  },
  addOns: [
    { name: 'Want your order sooner?', price: 15, subtotal: 105 },
    { name: 'Digital Download', price: 10, subtotal: 115 },
    { name: 'Add a Pet', price: 10, subtotal: 125, dynamicContract: 'properties[Pet photo] becomes required' },
  ],
  backNavigation: {
    uploadRetained: true,
    fileState: 'idle',
    forwardAgainSucceeded: true,
    visibleErrors: [],
  },
  completion: 'blocked',
  remainingBlocker: 'Add to cart and checkout were not authorized or executed.',
};

await writeFile(resolve(out, 'upload-workflow-evidence.json'), JSON.stringify(supplemental, null, 2), 'utf8');

const reportPath = resolve(out, 'report.html');
const report = await readFile(reportPath, 'utf8');
const marker = '<h2>正确阻断</h2>';
const replacement = '<h2>授权后的上传路径</h2><p class="ok">测试图片已被 FilePond 接受并进入 <code>idle</code> 状态；随后成功进入 <code>Any Extras?</code>。附加项小计依次更新为 $105、$115、$125；选择 Add a Pet 后，<code>properties[Pet photo]</code> 变为必填。返回上传步骤时文件保持，再次前进无错误。</p><p><a href="upload-workflow-evidence.json">查看上传及附加项结构化证据</a></p><h2>正确阻断</h2>';
const updated = report
  .replace(marker, replacement)
  .replace('本次没有上传文件，也没有加入购物车。完整成功路径仍应判为 <strong>blocked</strong>，不能伪装成通过。', '已完成上传与上传后状态验证，但没有加入购物车或结账。完整交易路径仍应判为 <strong>blocked</strong>，不能伪装成通过。')
  .replace('<li>A complete successful product workflow requires a real file upload; no upload was performed without explicit user confirmation.</li>', '')
  .replace('<li>Add-to-cart and checkout were intentionally not executed because this was a source-site capture test, not a transaction request.</li>', '<li>Add-to-cart and checkout were not authorized or executed.</li>')
  .replace('查看完整结构化证据', '查看三端结构化证据');
await writeFile(reportPath, updated, 'utf8');
