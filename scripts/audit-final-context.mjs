import fs from 'node:fs/promises';
import { load } from 'cheerio';
const out = process.argv[2];
const report = JSON.parse(await fs.readFile(`${out}/paired-review-work/online/incremental/paired-review-complete-hat.json`));
for (const side of ['source','target']) {
 const capture = JSON.parse(await fs.readFile(`${out}/${report.sessions[0].checks[0].before[side].path}`));
 const html = await fs.readFile(`${out}/${capture.artifacts.dom.path}`, 'utf8');
 const dom = load(html);
 dom('script').remove(); dom('[data-variants]').removeAttr('data-variants');
 console.log(JSON.stringify({side, capturedAt:capture.capturedAt, currency:html.match(/Shopify\.currency[^;]+/g)?.[0],country:html.match(/Shopify\.country[^;]+/g)?.[0],content:dom('#product-content-area').html()},null,2));
}
