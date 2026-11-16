import { Command } from "commander";
import { resolve, join } from "node:path";
import { access } from "node:fs/promises";
import { capture } from "./capture.js";
import { compile, packageTheme } from "./compiler.js";
import { renderPreview, serve } from "./preview.js";
import { verify } from "./verify.js";
import { report } from "./report.js";
import { check, deploy } from "./shopify.js";
import { readJson } from "./util.js";
import { planCatalog, syncCatalog } from "./catalog.js";
import { verifyCommerce } from "./verify-commerce.js";
import { discoverRoutes, planPhase3Content } from "./discover.js";
import {
  auditPhase4,
  planPhase4Collections,
  exposePhase4Collections,
  planPhase4Editorial,
  syncPhase4Collections,
  syncPhase4Editorial,
} from "./phase4-store.js";
import {
  localizePhase4Content,
  planPhase4Assets,
  resolvePhase4Assets,
  syncPhase4Assets,
} from "./phase4-assets.js";
import {
  auditPhase3,
  auditPhase3Products,
  planPhase3Products,
  syncPhase3Products,
  planPhase3ProductTemplates,
  syncPhase3ProductTemplates,
  planPhase3Pages,
  syncPhase3Pages,
} from "./phase3-store.js";
import { publishPhase5 } from "./phase5-publish.js";
import {
  assertProductFamilyContracts,
  auditProductFamilyContracts,
  initProductFamilyContracts,
} from "./product-family-contracts.js";
import { captureProductFamilyEvidence, captureReviewSystemEvidence, verifyProductFamilyVisuals } from "./product-family-evidence.js";
import { approveRelease } from "./release-approval.js";
import { verifyCollectionFamilyEvidence } from "./collection-family-evidence.js";
import { verifyHaroldCommerce } from "./verify-harold-commerce.js";
import { assertEvidencePlan, assertExecutableEvidence, runEvidenceNegativeTests, type EvidenceStage } from "./evidence-gate.js";
import { capturePlannedEvidence } from "./planned-capture.js";
import { createReplicationPlan } from "./replication-plan.js";
import { preparePairedReview, prepareVisualSummary, submitReview } from "./visual-review-workflow.js";
import { assertAgentVisualReview } from "./agent-visual-review.js";
import { buildPlatform, listPlatformAdapters, type PlatformId } from "./platform.js";
import { registerBuiltInPlatforms } from "./platforms/index.js";
import { registerShopyyCommands } from "./shopyy/commands.js";
import { initializeIncrementalAcceptance, planIncrementalAcceptance, sealAcceptanceBaseline, promoteAcceptanceBaseline } from './incremental-acceptance.js';
import { assertReviewedReleaseEvidence } from './reviewed-release-evidence.js';

registerBuiltInPlatforms();

const cli = new Command()
  .name("site2shop")
  .version("0.2.0")
  .description(
    "URL → Shopify 原型：当前内置 West & Willow 首页和一个商品页适配器",
  );
registerShopyyCommands(cli);
const outOption = [
  "--out <directory>",
  "生成目录（包含采集证据和主题）",
  "../westandwillow-phase1",
] as const;
cli.command('acceptance-incremental-init').option(...outOption)
  .description('从资源绑定与生成器归属建立验收依赖；不创建通过基线')
  .action(async opts => console.log(JSON.stringify(await initializeIncrementalAcceptance(resolve(opts.out)),null,2)));
cli.command('acceptance-impact').option(...outOption)
  .description('按文件哈希和递归依赖计算差异页、共享消费者及可复用证据；无有效基线则全量')
  .option('--primary-route <id...>', '已发现缺陷的路由；不会缩小依赖计算范围')
  .action(async opts => console.log(JSON.stringify(await planIncrementalAcceptance(resolve(opts.out),opts.primaryRoute),null,2)));
cli.command('acceptance-baseline-seal').option(...outOption)
  .description('完整三端客观/配对/智能体审阅全部通过后封存基线；拒绝局部通过')
  .action(async opts => console.log(JSON.stringify(await sealAcceptanceBaseline(resolve(opts.out),async()=>{
    await assertReviewedReleaseEvidence(resolve(opts.out),'preflight',true,{full:true});
    await assertReviewedReleaseEvidence(resolve(opts.out),'online',true,{full:true});
  }),null,2)));
cli.command('acceptance-baseline-promote').option(...outOption)
  .description('三端增量线上验收通过后推进基线，保留未变页面的原始版本证据；不重新全站验收')
  .action(async opts=>console.log(JSON.stringify(await promoteAcceptanceBaseline(resolve(opts.out),async()=>{
    await assertReviewedReleaseEvidence(resolve(opts.out),'preflight',true);await assertReviewedReleaseEvidence(resolve(opts.out),'online',true);
  }),null,2)));
cli.command("visual-review-prepare")
  .description("按独立采集计划生成待审清单；不填写通过、时间戳或浏览记录")
  .option(...outOption)
  .requiredOption("--stage <stage>", "preflight | online")
  .option("--summary", "生成汇总待审清单，配对会话需先提交")
  .action(async opts => {
    if (!["preflight", "online"].includes(opts.stage)) throw new Error("Unknown visual review stage");
    console.log(await (opts.summary ? prepareVisualSummary : preparePairedReview)(resolve(opts.out), opts.stage));
  });
cli.command("visual-review-submit")
  .description("校验智能体实际双站逐步审阅记录；失败保留缺陷且阻断放行")
  .option(...outOption)
  .requiredOption("--stage <stage>", "preflight | online")
  .requiredOption("--kind <kind>", "paired | visual")
  .requiredOption("--input <file>", "已明确填写的审阅记录；不接受确认标记替代审阅")
  .action(async opts => {
    if (!["preflight", "online"].includes(opts.stage) || !["paired", "visual"].includes(opts.kind)) throw new Error("Unknown visual review stage/kind");
    console.log(JSON.stringify(await submitReview(resolve(opts.out), opts.stage, opts.kind, resolve(opts.input)), null, 2));
  });
cli.command("visual-review-validate")
  .description("重算当前版本的双站审阅门禁；不操作页面、不生成审阅结论")
  .option(...outOption)
  .requiredOption("--stage <stage>", "preflight | online")
  .action(async opts => {
    if (!["preflight", "online"].includes(opts.stage)) throw new Error("Unknown visual review stage");
    await assertAgentVisualReview(resolve(opts.out), opts.stage);
    console.log("Visual review evidence is valid. Objective gates and release authorization remain separate.");
  });
cli.command("evidence-plan-create")
  .description("从刷新后的 sitemap、商品族契约和真实浏览器侦察创建带哈希的独立三端采集计划")
  .option(...outOption)
  .requiredOption("--target <origin>", "目标 Shopify 店铺 origin；不得包含密码或凭据")
  .option("--local-target <origin>", "本地未发布主题 origin，用于 preflight；默认 http://127.0.0.1:4173", "http://127.0.0.1:4173")
  .action(async opts => console.log(JSON.stringify(await createReplicationPlan(resolve(opts.out), opts.target, opts.localTarget), null, 2)));
cli.command("evidence-plan-check")
  .description("校验独立采集计划、三端组件/状态清单及导航范围；不创建通过证据")
  .option(...outOption)
  .action(async opts => console.log(JSON.stringify(await assertEvidencePlan(resolve(opts.out)), null, 2)));
cli.command("evidence-capture")
  .description("按独立计划采集实际边界、计算样式、相邻关系及只读交互；采集完成不等于验收通过")
  .option(...outOption)
  .requiredOption("--stage <stage>", "source | preflight | online")
  .option("--refresh", "强制重新采集，不复用完整工作流缓存")
  .option("--cache-max-age-hours <hours>", "缓存最大年龄 0–24 小时；0 禁用复用", "24")
  .option("--precheck-only", "只检查路由、初始组件和首个只读交互；不生成验收通过证据")
  .action(async opts => {
    if (!["source", "preflight", "online"].includes(opts.stage)) throw new Error("Unknown evidence stage");
    await capturePlannedEvidence(resolve(opts.out), opts.stage === "source" ? "source" : "target", opts.stage, {
      refresh: !!opts.refresh, cacheMaxAgeHours: Number(opts.cacheMaxAgeHours), precheckOnly: !!opts.precheckOnly,
    });
    console.log("Planned capture saved. Run evidence-validate and paired agent review before acceptance.");
  });
cli.command("evidence-validate")
  .description("从带哈希的实际观测重算门禁；缺证据、旧构建、漏测或差异超限即失败")
  .option(...outOption)
  .requiredOption("--stage <stage>", "source | preflight | online")
  .action(async opts => {
    if (!["source", "preflight", "online"].includes(opts.stage)) throw new Error("Unknown evidence stage");
    console.log(JSON.stringify(await assertExecutableEvidence(resolve(opts.out), opts.stage as EvidenceStage), null, 2));
  });
cli.command("evidence-negative-tests")
  .description("基于本次实际观测执行缺字段和错值反向测试；不代替页面交互验收")
  .option(...outOption)
  .requiredOption("--stage <stage>", "preflight | online")
  .action(async opts => {
    if (!["preflight", "online"].includes(opts.stage)) throw new Error("Negative tests require target coverage");
    console.log(JSON.stringify(await runEvidenceNegativeTests(resolve(opts.out), opts.stage), null, 2));
  });
cli
  .command("verify-harold-commerce")
  .description("在隔离购物车中验证 Harold 商品族的变体、上传属性、附加商品和加入购物车流程")
  .option(...outOption)
  .requiredOption("--remote <url>", "同一测试店铺的已授权草稿预览链接")
  .option("--handle <handle>", "仅验证一个代表商品，避免重复请求触发店铺限流")
  .option("--family-delay-ms <milliseconds>", "商品族之间的限流保护间隔", "0")
  .action(async (opts) => {
    const result = await verifyHaroldCommerce(resolve(opts.out), opts.remote, opts.handle, Math.max(0, Number(opts.familyDelayMs) || 0));
    console.log(JSON.stringify({ passed: result.passed, families: result.families.length }, null, 2));
    if (!result.passed) process.exitCode = 1;
  });
cli
  .command("collection-family-visual-verify")
  .description("在桌面/平板/手机采集并比较集合网格、商品卡片和交互契约")
  .option(...outOption)
  .option("--source <url>", "代表集合源站地址；默认复用已有集合证据中的地址")
  .requiredOption("--remote <url>", "Shopify 未发布主题的授权预览链接")
  .option("--threshold <percent>", "像素差异诊断阈值（不单独决定验收）", "20")
  .option("--stage <stage>", "preflight 使用本地当前 Build；online 使用已上传草稿", "online")
  .option("--target-only", "复用已验证的源站集合基准，只重新采集未发布主题三端")
  .action(async (opts) => {
    if (!["preflight", "online"].includes(opts.stage)) throw new Error("stage must be preflight or online");
    const result = await verifyCollectionFamilyEvidence(resolve(opts.out), opts.remote, opts.source, Number(opts.threshold), Boolean(opts.targetOnly), opts.stage);
    console.log(JSON.stringify({ passed: result.passed, errors: result.errors.length }, null, 2));
    if (!result.objectivePassed) process.exitCode = 1;
  });
cli
  .command("release-approve")
  .description("在草稿主题通过契约、视觉和线上预览验证后记录人工批准")
  .option(...outOption)
  .requiredOption("--reviewer <name>", "人工验收人")
  .action(async (opts) => {
    const result = await approveRelease(resolve(opts.out), opts.reviewer);
    console.log(JSON.stringify(result, null, 2));
  });
cli
  .command("product-family-capture")
  .description("等待原站脚本初始化并采集每个商品族的状态、DOM、字段和桌面/平板/手机基准图")
  .option(...outOption)
  .option("--source <url>", "覆盖 site-ir.json 中的源站地址")
  .option("--suffix <suffix>", "只采集一个商品族，便于增量调试")
  .option("--force", "忽略通过页面身份校验的已有源站证据并重采全部三端视口")
  .action(async (opts) => {
    const result = await captureProductFamilyEvidence(resolve(opts.out), opts.source, "source", opts.suffix, Boolean(opts.force));
    console.log(`${result.families.length} product families captured.`);
  });
cli
  .command("review-system-capture")
  .description("并发采集商品页、首页和代表集合页的评分摘要、评论组件与卡片星级布局证据")
  .option(...outOption)
  .option("--source <url>", "覆盖 site-ir.json 中的源站地址")
  .option("--collection <url>", "代表集合页；默认读取已有集合布局审计中的源地址")
  .option("--force", "忽略通过内容校验的已有评论证据并重新采集全部视口")
  .action(async (opts) => {
    const result = await captureReviewSystemEvidence(resolve(opts.out), opts.source, opts.collection, Boolean(opts.force));
    console.log(`${result.placements.length} review placements captured; status ${result.status}.`);
  });
cli
  .command("product-family-visual-verify")
  .description("逐商品族在桌面/平板/手机比较原站与草稿主题的完整页、主区域、表单和交互状态")
  .option(...outOption)
  .requiredOption("--remote <url>", "Shopify 未发布主题的授权预览链接")
  .option("--stage <stage>", "preflight 使用本地当前 Build；online 使用已上传草稿", "online")
  .option("--threshold <percent>", "像素差异诊断阈值（不单独决定验收）", "12")
  .action(async (opts) => {
    if (!["preflight", "online"].includes(opts.stage)) throw new Error("stage must be preflight or online");
    const result = await verifyProductFamilyVisuals(resolve(opts.out), opts.remote, Number(opts.threshold), undefined, opts.stage);
    console.log(JSON.stringify({ passed: result.passed, comparisons: result.comparisons.length }, null, 2));
    if (!result.objectivePassed) process.exitCode = 1;
  });
cli
  .command("phase3-contract-init")
  .description("从当前商品模板计划生成可移植的商品族契约草案")
  .option(...outOption)
  .option("--force", "覆盖现有契约矩阵")
  .action(async (opts) => {
    const result = await initProductFamilyContracts(resolve(opts.out), Boolean(opts.force));
    console.log(`${result.contracts.length} product family contracts initialized.`);
  });
cli
  .command("phase3-contract-audit")
  .description("按商品族检查模板结构、代表商品和发布就绪状态")
  .option(...outOption)
  .option("--strict", "存在未验证、阻断或结构缺失时返回失败")
  .action(async (opts) => {
    const result = opts.strict
      ? await assertProductFamilyContracts(resolve(opts.out))
      : await auditProductFamilyContracts(resolve(opts.out));
    console.log(JSON.stringify(result.counts, null, 2));
  });
cli
  .command("phase5-publish-resources")
  .description("发布已绑定资源到 Online Store；原生礼品卡未配置时保留草稿")
  .option(...outOption)
  .requiredOption("--store <domain>", "目标店铺")
  .action(async (opts) => {
    const result = await publishPhase5(resolve(opts.out), opts.store);
    console.log(JSON.stringify(result.counts, null, 2));
  });
cli
  .command("phase4-asset-plan")
  .description("生成内容页与文章内联图片的 Shopify Files 计划")
  .option(...outOption)
  .action(async (opts) => {
    const result = await planPhase4Assets(resolve(opts.out));
    console.log(JSON.stringify(result.counts, null, 2));
  });
cli
  .command("phase4-asset-sync")
  .description("将内容内联图片复制到 Shopify Files")
  .option(...outOption)
  .requiredOption("--store <domain>", "测试店铺")
  .action(async (opts) => {
    const result = await syncPhase4Assets(resolve(opts.out), opts.store);
    console.log(`${result.assets.length} Shopify files bound.`);
  });
cli
  .command("phase4-asset-resolve")
  .description("读取 Shopify Files 处理状态并生成 CDN 映射")
  .option(...outOption)
  .requiredOption("--store <domain>", "测试店铺")
  .action(async (opts) => {
    const result = await resolvePhase4Assets(resolve(opts.out), opts.store);
    console.log(`${result.ready}/${result.assets.length} Shopify files ready.`);
  });
cli
  .command("phase4-content-localize")
  .description("用 Shopify CDN 地址重写页面、集合和文章内容")
  .option(...outOption)
  .action(async (opts) => {
    const result = await localizePhase4Content(resolve(opts.out));
    console.log(`${result.inlineAssetsLocalized} inline images localized.`);
  });
cli
  .command("phase4-plan")
  .description("生成全量集合、博客与文章计划")
  .option(...outOption)
  .action(async (opts) => {
    const out = resolve(opts.out);
    const collections = await planPhase4Collections(out);
    const editorial = await planPhase4Editorial(out);
    console.log(JSON.stringify({ collections: collections.counts, editorial: editorial.counts }, null, 2));
  });
cli
  .command("phase4-audit")
  .description("只读检查目标店铺的集合、博客和文章冲突")
  .option(...outOption)
  .requiredOption("--store <domain>", "测试店铺")
  .action(async (opts) => {
    const result = await auditPhase4(resolve(opts.out), opts.store);
    console.log(JSON.stringify({ collections: result.collections.length, blogs: result.blogs.length }, null, 2));
  });
cli
  .command("phase4-collection-sync")
  .description("创建全量手动集合及商品成员，不发布商品")
  .option(...outOption)
  .requiredOption("--store <domain>", "测试店铺")
  .action(async (opts) => {
    const result = await syncPhase4Collections(resolve(opts.out), opts.store);
    console.log(`${result.collections.length} collections bound.`);
  });
cli
  .command("phase4-collection-expose")
  .description("仅将本轮新建集合发布到 Online Store 以支持草稿主题路由验收")
  .option(...outOption)
  .requiredOption("--store <domain>", "测试店铺")
  .action(async (opts) => {
    const result = await exposePhase4Collections(resolve(opts.out), opts.store);
    console.log(`${result.collections.length} newly created collections exposed for preview.`);
  });
cli
  .command("phase4-editorial-sync")
  .description("创建博客和未发布文章，拒绝覆盖非本工具资源")
  .option(...outOption)
  .requiredOption("--store <domain>", "测试店铺")
  .action(async (opts) => {
    const result = await syncPhase4Editorial(resolve(opts.out), opts.store);
    console.log(`${result.blogs.length} blogs / ${result.articles.length} unpublished articles bound.`);
  });
cli
  .command("phase3-plan")
  .option(...outOption)
  .option("--samples <number>", "采集首页优先商品、集合和内容页样本", "3")
  .action(async (opts) => {
    const count = Number(opts.samples);
    if (!Number.isInteger(count) || count < 0 || count > 3)
      throw new Error("--samples must be an integer from 0 to 3.");
    await discoverRoutes(resolve(opts.out), count);
  });
cli
  .command("phase3-content-plan")
  .option(...outOption)
  .option("--all", "采集站点地图中的全部非首页路由")
  .option("--resume", "复用已成功快照，仅重试失败路由")
  .action(async (opts) => {
    await planPhase3Content(
      resolve(opts.out),
      Boolean(opts.all),
      Boolean(opts.resume),
    );
  });
cli
  .command("phase3-audit")
  .description("只读检查目标店铺的页面、集合和导航冲突")
  .option(...outOption)
  .requiredOption("--store <domain>", "测试店铺")
  .action(async (opts) => {
    const result = await auditPhase3(resolve(opts.out), opts.store);
    console.log(JSON.stringify(result.counts, null, 2));
  });
cli
  .command("phase3-page-plan")
  .description("生成第三阶段未发布内容页写入计划")
  .option(...outOption)
  .action(async (opts) => {
    const result = await planPhase3Pages(resolve(opts.out));
    console.log(`${result.pages.length} unpublished page drafts planned.`);
  });
cli
  .command("phase3-template-plan")
  .description("根据已绑定草稿商品生成模板后缀更新计划")
  .option(...outOption)
  .action(async (opts) => {
    const result = await planPhase3ProductTemplates(resolve(opts.out));
    console.log(JSON.stringify(result.counts, null, 2));
  });
cli
  .command("phase3-template-sync")
  .description("仅更新第三阶段草稿商品的模板后缀，不发布商品")
  .option(...outOption)
  .requiredOption("--store <domain>", "测试店铺")
  .action(async (opts) => {
    const result = await syncPhase3ProductTemplates(
      resolve(opts.out),
      opts.store,
    );
    console.log(`${result.products.length} draft product templates updated.`);
  });
cli
  .command("phase3-product-audit")
  .description("只读检查第三阶段商品 handle 冲突")
  .option(...outOption)
  .requiredOption("--store <domain>", "测试店铺")
  .action(async (opts) => {
    const result = await auditPhase3Products(resolve(opts.out), opts.store);
    console.log(JSON.stringify(result.counts, null, 2));
  });
cli
  .command("phase3-product-plan")
  .description("生成第三阶段未发布商品草稿计划")
  .option(...outOption)
  .action(async (opts) => {
    const result = await planPhase3Products(resolve(opts.out));
    console.log(JSON.stringify(result.counts, null, 2));
  });
cli
  .command("phase3-product-sync")
  .description("创建第三阶段未发布商品草稿，拒绝覆盖非本工具资源")
  .option(...outOption)
  .requiredOption("--store <domain>", "测试店铺")
  .action(async (opts) => {
    const result = await syncPhase3Products(resolve(opts.out), opts.store);
    console.log(`${result.products.length} draft products bound.`);
  });
cli
  .command("phase3-page-sync")
  .description("创建第三阶段内容页草稿，拒绝覆盖非本工具资源")
  .option(...outOption)
  .requiredOption("--store <domain>", "测试店铺")
  .option("--handle <handle...>", "仅同步指定页面 handle")
  .option("--adopt-handle <handle...>", "显式接管并备份已存在的非工具页面 handle")
  .action(async (opts) => {
    const result = await syncPhase3Pages(
      resolve(opts.out),
      opts.store,
      opts.handle,
      opts.adoptHandle || [],
    );
    console.log(`${result.pages.length} unpublished page drafts bound.`);
  });
cli
  .command("catalog-plan")
  .option(...outOption)
  .action(async (opts) => {
    const plan = await planCatalog(resolve(opts.out));
    console.log(
      `${plan.products.length} products / ${plan.products.reduce((n: number, p: any) => n + p.input.variants.length, 0)} variants / ${plan.currency}. Plan saved to catalog-plan.json`,
    );
  });
cli
  .command("install")
  .option(...outOption)
  .requiredOption("--store <domain>", "测试店铺")
  .option("--name <name>", "草稿主题名称", "Site2Shop Phase 2")
  .action(async (opts) => {
    const out = resolve(opts.out);
    await assertExecutableEvidence(out, "source");
    await syncCatalog(out, opts.store);
    await compile(out);
    await renderPreview(out);
    await check(out);
    await deploy(out, opts.store, opts.name);
  });
cli
  .command("catalog-sync")
  .option(...outOption)
  .requiredOption("--store <domain>")
  .action(async (opts) => {
    await syncCatalog(resolve(opts.out), opts.store);
  });
cli
  .command("verify-commerce")
  .option(...outOption)
  .requiredOption("--remote <url>", "同一测试店铺的已授权草稿预览链接")
  .action(async (opts) => {
    const result = await verifyCommerce(resolve(opts.out), opts.remote);
    if (!result.passed) process.exitCode = 1;
  });
cli
  .command("clone")
  .argument("<url>")
  .option(...outOption)
  .option("--product-url <url>", "指定商品页，默认自动发现")
  .option("--resume", "使用已有采集证据，跳过联网采集")
  .option("--store <domain>", "生成并验证后上传独立草稿主题")
  .option("--commerce", "启用商品导入、照片属性和购物车（第二阶段）")
  .action(async (url, opts) => {
    const out = resolve(opts.out);
    if (opts.resume) {
      const ir = await readJson<any>(join(out, "site-ir.json"));
      if (new URL(ir.sourceUrl).href !== new URL(url).href)
        throw new Error("Resume URL does not match existing capture");
    } else {
      if (
        await access(join(out, "site-ir.json")).then(
          () => true,
          () => false,
        )
      )
        throw new Error(
          "Output already contains a capture. Use --resume or a new --out directory.",
        );
      await capture(url, out, opts.productUrl);
    }
    await assertExecutableEvidence(out, "source");
    if (opts.commerce) {
      if (opts.store) await syncCatalog(out, opts.store);
      else await planCatalog(out);
    }
    await compile(out, opts.commerce);
    await renderPreview(out);
    await check(out);
    const result = await verify(out);
    if (!result.passed)
      throw new Error(
        "Local checks failed. Inspect report.html before deployment.",
      );
    if (opts.store)
      await deploy(
        out,
        opts.store,
        opts.commerce ? "Site2Shop Phase 2" : "Site2Shop Phase 1",
      );
    console.log(`完成：${join(out, "report.html")}`);
  });
cli
  .command("build")
  .option(...outOption)
  .option("--commerce", "根据 catalog-plan 生成待绑定的交易主题")
  .action(async (opts) => {
    await compile(resolve(opts.out), opts.commerce);
    await renderPreview(resolve(opts.out));
    await report(resolve(opts.out));
  });
cli
  .command("verify")
  .option(...outOption)
  .option("--remote <url>", "测试 Shopify 草稿预览链接")
  .action(async (opts) => {
    const r = await verify(resolve(opts.out), opts.remote);
    if (!r.passed) process.exitCode = 1;
  });
cli
  .command("serve")
  .option(...outOption)
  .option("--port <number>", "本机预览端口", "4173")
  .action(async (opts) => {
    const out = resolve(opts.out);
    await renderPreview(out);
    const s = await serve(out, Number(opts.port));
    console.log(
      `首页 ${s.url}\n商品模板 ${s.url}/?view=s2s-product\n报告 ${s.url}/report.html\n按 Ctrl+C 退出`,
    );
    process.on("SIGINT", () => s.server.close(() => process.exit(0)));
  });
cli
  .command("check")
  .option(...outOption)
  .action(async (opts) => {
    await check(resolve(opts.out));
  });
cli
  .command("package")
  .option(...outOption)
  .action(async (opts) => {
    await packageTheme(resolve(opts.out));
  });
cli
  .command("platform-list")
  .description("列出已注册的目标平台生成适配器")
  .action(() => console.log(JSON.stringify(listPlatformAdapters(), null, 2)));
cli
  .command("platform-build")
  .description("从站点项目配置生成指定平台的可审阅主题包")
  .requiredOption("--platform <platform>", "目标平台，例如 shopyy")
  .requiredOption("--project <file>", "平台项目配置文件")
  .option("--output <directory>", "覆盖项目配置中的构建输出目录")
  .option("--prototype", "显式构建未验收原型；不能通过验收或草稿交付")
  .action(async opts => {
    const platform = opts.platform as PlatformId;
    if (!listPlatformAdapters().some(adapter => adapter.id === platform)) {
      throw new Error(`Unsupported platform: ${opts.platform}`);
    }
    const result = await buildPlatform(platform, {
      projectFile: resolve(opts.project),
      outputDirectory: opts.output ? resolve(opts.output) : undefined,
      prototype: !!opts.prototype,
    });
    console.log(JSON.stringify(result, null, 2));
  });
cli
  .command("platform-serve")
  .description("重新生成目标平台主题，并启动本地模拟站点")
  .requiredOption("--platform <platform>", "目标平台，例如 shopyy")
  .requiredOption("--project <file>", "平台项目配置文件")
  .option("--output <directory>", "覆盖项目配置中的构建输出目录")
  .option("--prototype", "预览未验收原型")
  .option("--port <number>", "本机预览端口", "4177")
  .action(async opts => {
    const platform = opts.platform as PlatformId;
    if (!listPlatformAdapters().some(adapter => adapter.id === platform)) {
      throw new Error(`Unsupported platform: ${opts.platform}`);
    }
    const result = await buildPlatform(platform, {
      projectFile: resolve(opts.project),
      outputDirectory: opts.output ? resolve(opts.output) : undefined,
      prototype: !!opts.prototype,
    });
    const local = await serve(result.outputDirectory, Number(opts.port));
    console.log(`SHOPYY 本地首页 ${local.url}\n商品列表 ${local.url}/collections/all\n购物车 ${local.url}/cart\n按 Ctrl+C 退出`);
    process.on("SIGINT", () => local.server.close(() => process.exit(0)));
  });
cli
  .command("deploy")
  .option(...outOption)
  .requiredOption("--store <domain>", "测试店铺 xxx.myshopify.com")
  .option("--name <name>", "首次创建草稿名称", "Site2Shop Phase 1")
  .action(async (opts) => {
    await deploy(resolve(opts.out), opts.store, opts.name);
  });
await cli.parseAsync().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
