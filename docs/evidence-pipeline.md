# 可执行采集与发布门禁

本流程是通用项目基础设施，不把某个域名、商品、评论应用或模板后缀写成默认规则。旧的 `product-family-capture`、集合截图和像素报告仍可用于诊断，但不能替代计划驱动的正式证据。

## 已接入的入口

| 入口 | 必须通过的检查 | 失败行为 |
| --- | --- | --- |
| `compile` / `build`，以及 `clone`、`install` 的生成链路 | source 阶段独立范围与证据检查 | 生成前停止；组合命令在目录同步前检查 |
| `deploy` | preflight 实际观测重算 + 源码/生成文件绑定 + 原有契约、Theme Check、智能体复核 | 不调用 Shopify 上传 |
| `release-approve`、`phase5-publish` | online 实际观测重算 + 当前未发布主题身份 + 原有在线验收/批准 | 不批准、不发布 |
| 商品族/集合视觉报告 | 必须包含正式 online 门禁结果 | 旧尺寸/像素诊断全绿也不能使总体通过 |

`phase5-publish` 是目录资源发布，不是自动发布主题。项目无法阻止人在项目之外直接运行 Shopify CLI；应限制 CI/发布账号的上传入口，只开放受保护的命令。

`package` 只计算主题内容哈希和 ZIP，不授予上传资格。直接修改生成文件后打包，仍因生成器绑定或旧证据而被拦截。

## 独立计划，不从成功结果倒推范围

输出目录必须包含 `capture-plan.json`（schema 2）、它引用的 analysis 与 routeInventory。相对路径、SHA-256、版本、三端、路由、状态、转换均由验证器检查。必须先用真实源站勘查确定这些内容；禁止把测试夹具写成真实商店证据，或从成功截图列表生成必测清单。

每个可见组件使用 `box-v1`。强制比较 17 项：宽度、左右容器内偏移、四侧 padding、四侧 margin、前后间距、可见性、父级/前后组件关系、布局类型/方向/列数、overflow 与原生横向滚动条。高度、字体、控件类型、具体控件高度、对齐、滚动前后边界等可通过附加规则引用 `presentationRaw` 中的真实计算样式/边界；必须由独立分析列为必测项，不能靠采集器猜测。

数值误差由 analysis 的逐字段容差与来源说明限定，计划只能收紧，不能自行放大。不采用统一 20% 作为正式布局验收。动态评论条数与正文高度不应强行相等，但不能因此豁免外层宽度、间距、位置和布局结构。没有评论的站点，需要明确、有证据的 `analysis.reviewSystem.present=false` 分类；丢失报告不等于没有评论。

## 正式浏览器采集适配器

采集入口默认执行快速预检、完整工作流断点与源站独立缓存，具体失效规则和强制刷新命令见[增量采集说明](incremental-capture.md)。预检/缓存命中不能替代后续完整门禁。

使用 `collectorVersion: "site2shop-planned-capture-v1"`。每个 state/transition 在通用计划之外声明：

```json
{
  "capture": {
    "source": {
      "ready": {"selector": "#review-widget", "state": "visible"},
      "components": {
        "review-shell": {
          "selector": "#review-widget",
          "parent": {"id": "content", "selector": "main"},
          "previous": {"id": "press", "selector": "#press"},
          "next": {"id": "footer", "selector": "footer"}
        }
      },
      "observations": [{"pointer": "/selectedModel", "selector": "select[name=model]", "read": "value"}]
    },
    "target": {"ready": {}, "components": {}, "observations": []}
  }
}
```

这是字段形状示意，不是可运行的站点计划；target 必须填写其真实选择器，不能照抄空对象。无前后组件时使用 `{"id":"none"}`；父级不可省略。选择器不存在或匹配多个元素均失败。观测支持 count/text/texts/value/attribute/visible；CSS 与边界自动采集。等待字体以及布局连续稳定，再保存数据；记录真实 CSS 视口、文档宽度、DPR、缩放，源/目标上下文不一致即拒绝比较。

每条 route 提供 `captureSequence`（转换 ID 数组，或按 viewport 分别定义）；静态页显式 `[]`。转换声明 `probe.source` / `probe.target`，例如 `[{"op":"select","selector":"select[name=model]","value":"model-b","effect":"read-only"}]`。支持 click/select/fill/check/scroll；每个终态必须有 observable ready 条件。所有计划节点都必须实际访问；失败节点留在清单，不会被过滤。重复状态必须复测同样的必测观测；否则应建模为另一状态。

**能力边界：**当前通用采集器仅执行只读页面探测，拦截网络写请求。上传、加购、提交、跨路由跳转和导航资源读取需要明确授权的专用适配器。不得将这些能力写成 supported 然后跳过测试。独立导航 inventory/coverage 仍由导航适配器输出，正式门禁会验证它，不会由本采集器虚构导航成功记录。第三方跨域 iframe 需要单独适配，不能用外层 iframe 的尺寸冒充内部卡片布局。

密码只从 `SITE2SHOP_STOREFRONT_PASSWORD` 环境变量读取，不写证据。仅允许目标同源 `/password` 解锁提交；成功后回到原目标 URL。最终路径与 canonical 分别对照计划；密码页、挑战页以及错误路由不保存成有效目标证据。preflight 读取实际 HTML 的 `site2shop-build-id`，online 校验浏览器中的草稿 theme ID。

## 生成器对应记录

每个节点的 `generatorBindings` 为每个 rendered component 声明：

```json
{
  "review-shell": {
    "mode": "provider-configuration",
    "owner": "reviewAdapter.renderShell",
    "generator": "src/review-adapter.ts",
    "generated": "theme/sections/review-shell.liquid",
    "measures": ["填写 box-v1 全部字段，不允许用本示例占位"]
  }
}
```

mode 只接受 contract/provider-configuration；generic-default 不可验收。编译后输出 `generator-presentation-bindings.json`，绑定源 capture SHA、源指针、当前源码快照与生成文件快照。上传时再次读取实际文件验证，旧构建、手工改文件和过期源证据都失效。这是可追溯性检查，不是“代码确实消费了每个值”的自动证明；现有配对智能体验收必须检查实现和画面，不能伪造复核通过。

## 执行顺序

需要 Node 22+、Python 3.10+ 和项目 Playwright Chromium；Python 不在 PATH 时，设置 `SITE2SHOP_PYTHON` 为解释器绝对路径（不要带命令参数）。所有依赖脚本随项目分发，不依赖本机 `.codex/skills` 路径。

```powershell
npm run site2shop -- evidence-plan-check --out <输出目录>
npm run site2shop -- evidence-capture --stage source --out <输出目录>
npm run site2shop -- evidence-validate --stage source --out <输出目录>
npm run site2shop -- build --out <输出目录>
# 用正确构建启动本地预览，并补齐适配器生成的导航证据
npm run site2shop -- evidence-capture --stage preflight --out <输出目录>
npm run site2shop -- evidence-negative-tests --stage preflight --out <输出目录>
npm run site2shop -- evidence-validate --stage preflight --out <输出目录>
# Theme Check、原有契约、配对智能体复核全过后才可 deploy
# 草稿端重跑 capture / negative-tests / validate 的 online 阶段，再人工确认
```

本地预览不支持的 App Block 不能假装通过。应完善相应本地/第三方适配器与真实证据；不可用空壳占位、`--skip` 或伪造截图绕过上传门禁。

negative-tests 实际对本次观测逐规则执行基线、缺源字段、缺目标字段、错值测试，保存当前计划/构建绑定的执行日志。它只证明比较器能拦截这类错误，不代替真实按钮点击、加购或智能体视觉验收。验收器不信任已有 passed 字段，而是重新读取哈希工件并计算所有比较。

## 回归测试与迁移

```powershell
npm run typecheck
npm test
python -X utf8 scripts/evidence-gates/validate_evidence_coverage.py --self-test
```

新增测试覆盖实际构建/上传入口缺计划时拒绝、真实浏览器三端尺寸、响应式列数、交互后的间距变化、横向滚动条、缺测/旧构建/篡改证据及布局反向测试。所有 synthetic fixture 都仅用于工具自身测试，不代表真实商店通过。

本次接入不会自动升级现有商店的旧报告。缺少独立计划或字段时，先补勘查计划和源证据，再重新生成和验收；不能在旧文件里追加新版本号了事。当前站点的实际修复、重新采集、草稿上传与发布必须单独报告，不与基础设施测试通过混淆。
