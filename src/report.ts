import { join } from "node:path";
import { write, readJson, escapeHtml as esc } from "./util.js";
import type { SiteIR } from "./types.js";
export async function report(out: string) {
  const ir = await readJson<SiteIR>(join(out, "site-ir.json"));
  let checks = await readJson<any>(join(out, "verification.json")).catch(
    () => null,
  );
  const deploy = await readJson<any>(join(out, "deployment.json")).catch(
    () => null,
  );
  const plan = await readJson<any>(join(out, "catalog-plan.json")).catch(
    () => null,
  );
  const binding = await readJson<any>(join(out, "catalog-binding.json")).catch(
    () => null,
  );
  let commerce = await readJson<any>(
    join(out, "verification-commerce.json"),
  ).catch(() => null);
  const build = await readJson<any>(join(out, "theme-build.json")).catch(
    () => null,
  );
  if (build && checks?.themeBuild !== build.id) checks = null;
  if (build && commerce?.themeBuild !== build.id) commerce = null;
  const rows = (checks?.screenshots || [])
    .map(
      (s: any) =>
        `<article><h2>${esc(s.kind)} · ${s.width}px <span>${s.topDiffPercent === null ? "未比较" : s.topDiffPercent + "% 首屏差异"}</span></h2><div class="pair"><figure><figcaption>原站（营销弹窗已排除）</figcaption><a href="${s.source}"><img src="${s.source}" alt="原站 ${s.kind} ${s.width}px 完整截图" loading="lazy"></a></figure><figure><figcaption>${checks.mode === "shopify" ? "Shopify 预览" : "本地近似渲染"}</figcaption><a href="${s.target}"><img src="${s.target}" alt="生成页面 ${s.kind} ${s.width}px 完整截图" loading="lazy"></a></figure></div>${s.diff ? `<a href="${s.diff}">查看首屏差异图</a>` : ""}</article>`,
    )
    .join("");
  const issues = [
    ...ir.issues,
    ...ir.assets
      .filter((a) => a.status === "failed")
      .map((a) => ({ code: "ASSET_FAILED", message: a.url + " " + a.error })),
  ];
  const labels: Record<string, string> = {
    productHeading: "商品标题",
    initialControlsInViewport: "首屏选项位置",
    gallerySynced: "图库联动",
    step2: "进入步骤 2",
    step3: "进入步骤 3",
    back: "返回上一步",
    faqExpanded: "FAQ 展开",
    noUnexpectedPageErrors: "无页面脚本异常",
    durableUploads: "照片持久上传",
    orders: "真实下单",
  };
  const functionalSummary = Object.entries(checks?.functional || {})
    .filter(([key]) => !plan || !["durableUploads", "orders"].includes(key))
    .map(
      ([key, value]) =>
        `${labels[key] || key}：${value ? "通过" : ["durableUploads", "orders"].includes(key) ? "未接入" : "未通过"}`,
    )
    .join("； ");
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Site2Shop · 第一阶段验证</title><style>body{font:16px/1.65 system-ui,sans-serif;color:#243334;background:#f7f6f2;margin:0}main{max-width:1180px;margin:auto;padding:48px 24px}h1{font-size:36px;letter-spacing:-1px}h2{font-size:22px}h2 span{font-size:14px;font-weight:400;margin-left:16px}a{color:#94503a}table{border-collapse:collapse;table-layout:fixed;width:100%;background:white}td,th{overflow-wrap:anywhere;padding:12px;text-align:left;border-bottom:1px solid #ddd}article{margin:48px 0;padding-top:12px;border-top:1px solid #bac5bd}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0}figure img{width:100%;height:520px;object-fit:cover;object-position:top;background:white;border:1px solid #ddd}figcaption{padding:8px 0}li{margin-block:6px;overflow-wrap:anywhere}.status{padding:20px;background:#e9eee7}code{font-size:14px}details{margin:24px 0}small{color:#596661}@media(max-width:640px){main{padding:24px 16px}.pair{grid-template-columns:1fr}h1{font-size:28px}}</style><main><h1>Site2Shop · 第一阶段验证</h1><p>源站：<a href="${esc(ir.sourceUrl)}">${esc(ir.sourceUrl)}</a><br><small>采集时间 ${esc(ir.capturedAt)}</small></p><div class="status">主题生成：${ir.status.generated ? "已完成" : "未完成"} · 本地功能：${ir.status.localVerified ? "通过" : "未通过/未验证"} · Shopify 验证：${ir.status.shopifyVerified ? "已验证" : "尚未通过"} · 交易验证：未完成（第二阶段）</div><p><a href="theme.zip">下载主题 ZIP</a> · <a href="preview/home.html">首页静态文件</a> · <a href="preview/product.html">商品页静态文件</a> · <a href="store-data.json">商品数据</a>${deploy?.previewUrl ? ` · <a href="${esc(deploy.previewUrl)}">Shopify 预览</a>` : ""}</p><p>本轮仅覆盖首页和一个商品页。原站的评价应用、营销弹窗、全站其他链接与定制订单服务尚未迁移。差异率是同环境截图的像素比较，不是主观还原度分数。</p><table><tr><th>资源</th><th>结果</th></tr><tr><td>下载成功</td><td>${ir.assets.filter((a) => a.status === "ready").length}</td></tr><tr><td>下载失败</td><td>${ir.assets.filter((a) => a.status === "failed").length}</td></tr><tr><td>自动功能检查</td><td>${esc(functionalSummary || "尚未验证")}</td></tr></table><details><summary>范围、缺失与依赖（${issues.length}）</summary><ul>${issues.map((i) => `<li><code>${esc(i.code)}</code> ${esc(i.message)}</li>`).join("")}</ul></details>${rows}</main></html>`;
  const themeChecks = await readJson<any[]>(
    join(out, "theme-check.json"),
  ).catch(() => []);
  const checkSummary = `<p>Theme Check：${themeChecks.reduce((n, f) => n + (f.errorCount || 0), 0)} 个错误，${themeChecks.reduce((n, f) => n + (f.warningCount || 0), 0)} 个警告（详见 <a href="theme-check.json">检查结果</a>）。商品数据尚未导入；当前商品页使用替代模板预览。基础交互检查：${checks?.passed ? "通过" : "未验证或未通过"}，不代表可以下单。</p>`;
  const excluded = checks?.excludedOverlays?.length
    ? `<p>截图比较排除了 Shopify 自身的草稿预览工具栏；带工具栏的原始截图保存在 verification/raw-shopify-*.png。</p>`
    : "";
  let finalHtml = html.replace("<table>", checkSummary + excluded + "<table>");
  if (plan) {
    const states = {
      商品和规格映射: binding?.completed,
      照片上传后独立读取: commerce?.uploadPersisted,
      购物车名字和照片属性: commerce?.cartProperties,
      附加项真实收费: commerce?.addonsCharged,
      修改数量: commerce?.quantityUpdate,
      删除商品及其附加项: commerce?.removeItem,
      进入结账页: commerce?.checkoutReached,
      创建测试订单: commerce?.orderCreated,
    };
    const commerceTable = `<h2>第二阶段 · 交易接入</h2><p>已生成 ${plan.products.length} 个商品、${plan.products.reduce((n: number, p: any) => n + p.input.variants.length, 0)} 个规格的导入计划。币种 ${esc(plan.currency)}。安装命令会依次导入商品、绑定 ID、生成主题并上传草稿。照片与购物车已写入代码，真实店铺结果以此表为准。</p><table><tr><th>Shopify 实测项目</th><th>状态</th></tr>${Object.entries(
      states,
    )
      .map(
        ([k, v]) =>
          `<tr><td>${esc(k)}</td><td>${v ? "已验证" : "待验证"}</td></tr>`,
      )
      .join(
        "",
      )}</table><p><a href="catalog-plan.json">商品导入计划</a>${binding ? ' · <a href="catalog-binding.json">目标 ID 映射</a>' : ""}${commerce ? ' · <a href="verification-commerce.json">交易测试证据</a>' : ""} · <a href="preview/cart.html">空购物车本地预览</a></p><p>本地静态预览不会提交购物车。交易测试使用独立浏览器购物车和测试图片，不会付款或创建真实订单。原站的履约承诺、优惠与运费活动仍是采集快照，上线前需配置并核对。</p>`;
    finalHtml = finalHtml
      .replaceAll("第一阶段验证", "第二阶段进度与验证")
      .replace(
        "交易验证：未完成（第二阶段）",
        `交易验证：${commerce?.passed ? "上传与购物车已验证；订单待验证" : "待真实店铺验证"}`,
      )
      .replace(
        "商品数据尚未导入；当前商品页使用替代模板预览。",
        binding?.completed
          ? "商品已绑定测试店铺；商品模板使用目标规格。"
          : "商品计划已生成，等待测试店铺 API 授权后导入。",
      )
      .replace(
        "本轮仅覆盖首页和一个商品页。原站的评价应用、营销弹窗、全站其他链接与定制订单服务尚未迁移。",
        "本轮覆盖首页、一个定制商品模板及新增购物车；全站其他页面、评价应用、营销弹窗和履约服务尚未迁移。",
      )
      .replace("<details>", commerceTable + "<details>")
      .replace(
        "<details>",
        commerce?.checkoutBlocked
          ? `<p><strong>结账受店铺设置阻挡：</strong>Shopify 提示此商店尚未设置为接收订单。当前未生成订单。<a href="verification/commerce-checkout.png">查看提示截图</a>。</p><details>`
          : "<details>",
      )
      .replaceAll("未接入", "待真实店铺验证");
  }
  await write(join(out, "report.html"), finalHtml);
}
