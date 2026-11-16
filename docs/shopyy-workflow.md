# SHOPYY 完整复刻流程（schema 2）

这是一套可执行的复刻工作流，不是输入 URL 后自动宣告完成的网站生成器。
Skill 负责盘点、制定契约、编写页面族和逐图审阅；项目命令负责采集、构建、比较、失效检查和阻止未通过的交付。

## 运行顺序

在 `outputs/site2shop` 目录中运行。下列命令的项目参数均指向站点自己的配置文件。

本任务只运行 `npm run test:shopyy` 与 `npm run typecheck`。不得为 SHOPYY 任务运行共用全量 `npm test`、Shopify 测试、`theme:check` 或 Shopify CLI/API。其他平台的依赖保留在共用项目中，不属于本任务执行范围。

```powershell
# 登录受限的源站：配置 workflow.sourceSession.enabled=true 后，仅首次/会话过期时执行。
npm run shopyy:workflow -- source-session --project ../voidresearch-shopyy/shopyy.project.json --open
# 在新开的项目浏览器中自行登录和完成声明，随后关闭该窗口；再验证登录后的真实页面。
npm run shopyy:workflow -- source-session --project ../voidresearch-shopyy/shopyy.project.json
npm run shopyy:workflow -- discover --project ../voidresearch-shopyy/shopyy.project.json
# 中断/预算耗尽后，用 --resume 校验并复用当前盘点；不会复用旧登录墙或 schema 1 页面。
# npm run shopyy:workflow -- discover --project ../voidresearch-shopyy/shopyy.project.json --max-routes 200 --resume
# 复制已观测到的公开图片/CSS；不下载源站脚本，不携带登录资料，失败资源单独报告。
npm run shopyy:workflow -- source-assets --project ../voidresearch-shopyy/shopyy.project.json
# 智能体先观察结构、编写独立组件选择器和片段配方；下列命令只为制定契约/实现准备输入。
npm run shopyy:workflow -- inspect-source --project ../voidresearch-shopyy/shopyy.project.json --selectors contracts/home-components.draft.json
npm run shopyy:workflow -- prepare-composer --project ../voidresearch-shopyy/shopyy.project.json --recipe contracts/home-composer.recipe.json
# 智能体检查盘点证据，补齐三个视口的菜单/弹层/脚本导航状态，分类每个目的地，编写 schema 2 计划。
npm run shopyy:workflow -- gate --stage plan --project ../voidresearch-shopyy/shopyy.project.json
npm run shopyy:workflow -- capture --stage source --project ../voidresearch-shopyy/shopyy.project.json
npm run shopyy:workflow -- contracts --project ../voidresearch-shopyy/shopyy.project.json
# 智能体绑定真实观测到页面族、组件、样式和交互；空 bindings 不能进入正式构建。
npm run site2shop -- platform-build --platform shopyy --project ../voidresearch-shopyy/shopyy.project.json
npm run site2shop -- serve --help
# 也可用 platform-serve 构建并启动配置中指定的 localOrigin 端口。
npm run site2shop -- platform-serve --platform shopyy --project ../voidresearch-shopyy/shopyy.project.json --port 4177
```

在另一终端继续：

```powershell
npm run shopyy:workflow -- capture --stage preflight --project ../voidresearch-shopyy/shopyy.project.json
npm run shopyy:workflow -- review-prepare --project ../voidresearch-shopyy/shopyy.project.json
# 智能体实际查看每个 before/after、视口图、整页图，填写逐状态/组件判断、理由、reviewer 和真实 reviewedAt。
npm run shopyy:workflow -- review-submit --project ../voidresearch-shopyy/shopyy.project.json --input ../voidresearch-shopyy/verification/workflow/preflight-review.pending.json
npm run shopyy:workflow -- repair-status --project ../voidresearch-shopyy/shopyy.project.json
# 修项目输入或生成器后重建、重采集；新的构建必须重新审图。
npm run shopyy:workflow -- retest --project ../voidresearch-shopyy/shopyy.project.json
npm run shopyy:workflow -- gate --stage preflight --project ../voidresearch-shopyy/shopyy.project.json
npm run shopyy:workflow -- draft-package --project ../voidresearch-shopyy/shopyy.project.json --output ../voidresearch-shopyy/handoff
```

`draft-package` 仅复制通过当前构建验收的 ZIP，记录 `uploadPerformed:false`，不上传、不发布。
实际 SHOPYY 权限到位后，再做模板运行、字段/SKU、资产托管、购物车 payload 和草稿站配对验收。

## 盘点与计划

项目登录浏览器使用用户目录 `.codex/browser-profiles/site2shop` 下按源站 origin 隔离的专用配置。不会读取日常 Chrome 的登录资料。凭据保留在本机浏览器配置中，不写入项目、构建或验收证据；采集时只在内存中传给源站上下文，目标预览上下文不接收源站会话。`workflow.sourceSession.readySelector` 应指向登录后真实可见的源站元素。会话失效、登录重定向和挑战页不得作为成功页面证据。

发现器合并 sitemap 和渲染链接，保留外链/下载/联系链接，三端采集，禁止源站 POST。
`workflow.discoveryBoundaries` 可用 `{path, includeDescendants, rationale}` 声明账户、个人订单或交易边界；发现器保留链接及来源证据，但不访问这些目的地，标记 `deferred-online` 供人工审查。普通内容页不能借此免除实现和验收。原始盘点记录实际视口、图片/样式资源地址，以及移除脚本和输入值的页面结构；这些记录是盘点资料，不替代 schema 2 契约采集。
`workflow.discoveryAliases` 仅填写已经逐端观测确认的重定向；未知跳转仍然失败。`--resume` 保留前次失败盘点的哈希原始记录，重试未完成路由，不会自动签署导航审查。`workflow.discoveryNetworkIdleMs` 只控制盘点等待预算，正式契约采集仍要求语义后置条件和布局稳定。
`workflow.discoveryViewports` 可覆盖视口；`workflow.discoveryStates` 定义每个菜单或其他只读状态：

```json
{"path":"/","state":"menu-open","viewports":["mobile","tablet"],"actions":[{"op":"click","selector":"button[aria-controls=navigation]","effect":"read-only"}]}
```

选择器必须来自该源站实际 DOM，上例只是字段示例。不得自动替用户勾选研究员身份声明或提交表单。
发现器不会自动把 `complete` 标绿。必须审查捕获的导航面、补齐遗漏状态，给所有路由作出有证据的 disposition，保存带哈希的 `coverage.agentReview`。该记录含 reviewer、reviewedAt、rationale、surfacesReviewed、空 pending，以及当前盘点摘要。

计划类型见 `src/shopyy/contracts.ts`：独立 inventory 引用、三端尺寸、页面族、组件、状态、动作、规则、生成器 owner。
动画基准必须独立声明。`environment.infiniteAnimations="frame-zero"` 仅在采集浏览器中把无限循环动画暂停在第零帧，记录名称、时长、播放状态和时间；有限的菜单/抽屉过渡继续正常运行。源站与目标使用同一规则，生成页面保留正常动画。缺少或不匹配的采集上下文不能通过 gate；这不替代对动画规则和实际行为的审查。
`states.*.viewports` / `transitions.*.viewports` 指定适用视口；`sequencesByViewport`、`actionsByViewport` 和 `selectorsByViewport` 支持移动端抽屉与桌面菜单的不同操作。隐藏是可观测状态，不等于略过。

## 页面契约确实进入生成器

`contracts` 导出源站观测，但不会虚构样式绑定。每个 route × viewport × state × component 都必须有当前证据对应的 binding，例如：

```json
{
  "route":"home","viewport":"desktop","state":"initial","component":"heading",
  "selector":"[data-component=heading]","range":{"min":1024,"max":1920},
  "sourceCapture":{"path":"artifacts/<actual-hash>.json","sha256":"<actual-hash>"},
  "styles":{"fontSize":{"field":"fontSize","observed":"48px","transform":"identity"}}
}
```

`observed` 必须等于原始浏览器测量；引用必须匹配当前 source 会话。只允许同名 CSS 属性的 identity 或数值 px 转换；不能随意填宽高再附一个哈希。
响应式区间由智能体依据三端证据制定。样式只是消费契约的一部分：页面结构、控件、图像和交互仍需在共享模板中实现并逐状态验证。

## 项目级页面族接口

正式构建必须提供 `familiesFile`，不允许退回旧的 Void 首页生成器。每个映射路由都要有实现；内容页、政策页或特殊商品页可以定义自己的页面族。

```json
{
  "schemaVersion":2,
  "partials":{"header":"composers/header.htm"},
  "families":{"content":{"templateFile":"composers/content.htm","nativeFile":"content/default.htm"}},
  "pages":[{"sourcePath":"/about","targetPath":"/NavPage/about.html","family":"content","nativeFile":"content/about.htm","dataFile":"content/about.json"}]
}
```

同一份完整 HTML 同时生成 fixture 和原生模板，支持：

| 项目模板 token | 作用 |
|---|---|
| `{{include:header}}` | 共享局部模板 |
| `{{fragment:bodyFile}}` | 从项目内容记录读取受目录约束的自有 HTML 片段，源生/本地共享 |
| `{{mode}}` | 明确输出 native 或 fixture 模式 |
| `{{#fixture}}…{{/fixture}}` | 仅本地注入的 fixture 数据，原生模式移除 |
| `{{json:catalog}}` | 安全 JSON 序列化，转义 HTML 结束标签字符 |
| `{{data:title}}` | 两边相同的转义内容 |
| `{{field:detailTitle}}` | 原生使用变量映射；fixture 使用同名数据 |
| `{{asset:styles/page-contracts.css}}` | 平台或本地资源根 |
| `{{route:/about}}` | inventory 的真实目标路由 |
| `{{#each:productList}}…{{/each}}` | 原生列表绑定与 fixture 数组 |

组件行为可在共享模板内实现。必须加载 `styles/page-contracts.css`。不支持的 token、缺少字段、未实现路由、重复原生文件内容冲突都会报错。平台原生文件名和变量仍须在真实 SHOPYY 皮肤验证。

## 验收与失效

采集计划可显式设置 `environment.infiniteAnimations: "frame-zero"`，并设置 `rasterizeInfiniteFrameZero: true`。后一选项只在采集浏览器内把已暂停的无限动画零帧计算样式固定到该元素，避免浏览器仍绘制旧合成动画；有限过渡继续运行，交付页面代码不变。源站和目标必须使用同一声明，原始记录保留动画上下文，缺少或改变投影标记会使证据失效。截图须先采集当前视口，再采整页；零帧截图要求连续画面稳定，失败画面保留为诊断。

`scripts/compare-voidresearch-home-development.ts` 是无构建的开发诊断，可按 `initial`、`sections`、`more`、`mobileMenu`、`mobileMore`、`searchGHK`、`searchNone`、`cart`、`footer` 分别比较当前源站和内存生成页面。它保留实际只读动作、三端观测及截图，并输出像素差异作为诊断；它不批准库存、不创建构建、不替代正式采集或人工审图，也不写入线上草稿。

- build ID 包含原生/预览文件、项目、计划、契约、全部生成器模块、源站采集索引、资产树和页面族文件；ZIP 时间固定。
- 本地服务返回 `X-Site2Shop-Build`。浏览器核对实际服务构建和实际 HTTP 状态；旧服务不能冒充新包。
- 对照全部计划状态和反向边，比较几何、拓扑、语义以及双向控件清单。链接 href 也比较，每个映射目的地必须通过捕获页面中的真实链接点击到达。
- 对照在首次偏差处停止该会话，保留错误；`objective-only` 报告不等于完整验收。
- 审图清单初始为 pending；只有人或智能体真实查看图像后才能提交。程序从不批量填写 pass。
- 报告和 repair-ledger 绑定当前 plan/build。缺少证据不会抹掉历史缺陷；正式通过才关闭同阶段缺陷。
- 旧 schema 1、旧高度比例报告和旧页面输出不能作为新验收依据。生成目录有手改、旧格式或未知内容时拒绝覆盖，应另选空输出目录。

测试使用独立合成页面和真实浏览器，验证门禁行为；测试通过不表示 Void Research 已复刻完成。
