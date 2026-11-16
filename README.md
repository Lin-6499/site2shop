# Site2Shop 多平台复刻工具

> 2026-10-26：0.3.0 新增注册式目标平台接口与首个 SHOPYY 适配器。现有 Shopify 流程保持原命令；SHOPYY 可从站点项目配置生成 Smarty 风格模板、资源目录、确定性 ZIP 和构建清单。SHOPYY 草稿店铺变量及交易行为仍需目标验证。

> 2026-10-27：SHOPYY schema 2 复刻流程已接入。它包含三端/状态盘点、源站契约、项目页面族、共享原生/预览生成、真实点击导航、逐状态对照、显式审图、构建失效与草稿交付门禁。完整用法见 [docs/shopyy-workflow.md](docs/shopyy-workflow.md)。旧 schema 1、高度比和早期本地截图不再代表验收。

> 2026-10-25：[双站逐步视觉审阅执行协议](docs/visual-review-mechanism.md)已接入上传/批准/发布入口。项目配对记录使用 schema 2、汇总使用 schema 3；旧格式与批量填 pass 方式失效。新命令只生成待审清单，实际双站操作和看图判定必须由智能体完成。下文早期记录不代表现有网站已通过新版验收。

> 2026-10-25：[增量采集、源站独立缓存与快速预检](docs/incremental-capture.md)已接入正式采集入口；缓存不替代三端契约与智能体双站验收。

> 2026-10-23：已接入[可执行采集与发布门禁](docs/evidence-pipeline.md)。生成要求独立 source 证据，草稿上传要求 preflight 实测与智能体复核，发布要求 online 验收。缺少 `capture-plan.json` 的旧输出会被阻断；下文早期阶段的示例与完成记录不代表当前构建已通过新门禁。需要 Python 3.10+，可通过 `SITE2SHOP_PYTHON` 指定解释器。

输入参考 URL，采集页面和素材，再由目标平台适配器生成主题。目前 Shopify 流程负责 Liquid、目录同步与草稿主题；SHOPYY 流程负责从平台中立项目配置生成待导入的皮肤包。

## 目标平台接口

平台中立入口位于 `src/platform.ts`，内置适配器在 `src/platforms/` 注册。构建器接收项目配置和可选输出目录，返回 Build ID、文件清单、ZIP、构建清单及平台能力状态。

```powershell
# 查看已注册平台
npm run site2shop -- platform-list

# 可重复构建 Void Research SHOPYY 皮肤包
npm run site2shop -- platform-build --platform shopyy --project ../voidresearch-shopyy/shopyy.project.json

# 重新构建并启动本地 SHOPYY 模拟站点
npm run site2shop -- platform-serve --platform shopyy --project ../voidresearch-shopyy/shopyy.project.json --port 4177

# 查看并运行完整复刻工作流
npm run shopyy:workflow -- --help
```

输出位于 `../voidresearch-shopyy/build/shopyy/`。`theme/` 是生成文件，`preview/` 是用本地商品夹具渲染的首页、列表、详情和购物车模拟站，`voidresearch-shopyy-theme.zip` 是皮肤包，`theme-build.json` 记录逐文件哈希、包哈希和仍需目标店铺验证的能力。持久修改应进入项目配置、内容/设计契约或适配器生成器。

**当前仅适配 West & Willow。第三阶段已加入全站路由发现、首批内容快照以及通用内容页、集合页和标准商品页模板；复杂定制商品仍需按商品族生成适配器。它不是任意 URL 全站自动复刻器，尚未完成可接单商店的验证。**

第三阶段发现源站 399 个唯一页面，首批锁定首页可达的 55 个页面：25 个商品、17 个集合、13 个内容页。55/55 已生成只读内容快照；本地六组响应式检查通过，尚未向 Shopify 创建这些页面、集合或新增商品，也尚未上传第三阶段主题。执行目标店铺写入前需要扩展页面、内容和导航权限，并逐批处理冲突与复杂商品配置。

测试店铺为 `azhiip-13.myshopify.com`，第二阶段独立 unpublished 草稿为 `189540892871`：[打开编辑器](https://admin.shopify.com/store/azhiip-13/themes/189540892871/editor)。第一阶段草稿及 live 主题未改动。商品已导入并发布到 Online Store 销售渠道；主题仍未发布。

预览时从 **Site2Shop Phase 2** 这一行的菜单进入“预览”，或在其编辑器的页面选择器切换产品/购物车。主题管理页顶部的“预览商店”对应当前 live 主题 Horizon。当前可访问的主路由为 `/`、`/products/s2s-custom-one-pet-portrait`、`/cart`。导航保留的其他分类、内容和商品链接并不表示对应页面已生成；本轮路由实测中 Bestsellers、FAQ、双宠肖像均返回 404。商品页中的原路径锚点已修复，详见产物 `route-verification.json`。

## 交付文件

- `../site2shop-phase2-source.zip`：工具源码与锁文件，不含 node_modules、浏览器或 capture 目录。
- `../westandwillow-phase2/theme.zip`：原生 Shopify 主题包；`theme/` 为对应源文件。
- `../westandwillow-phase2/report.html`：截图、功能检查、验证范围与阻碍。
- `../westandwillow-phase2/phase2-notes.md`：本轮交付及设计继承证据。
- 产物目录中的 `site-ir.json`、`assets-manifest.json`、`store-data.json`：采集索引、资源来源与公开商品快照。
- `catalog-plan.json`、`catalog-binding.json`：导入计划及目标商品/规格 ID 映射。
- `deployment.json`、`theme-build.json`：草稿信息与主题内容哈希，不保存登录凭证。

**主题 ZIP 不含商品数据库。** 迁移另一店铺必须使用新输出目录重新同步，产生新绑定，不能复用原店铺 variant ID。

## 安装与单命令运行

要求 Node.js 22+。在源码目录打开 PowerShell，安装锁定依赖及浏览器，通过官方 Shopify CLI 在浏览器中授权。无需向工具或聊天提供密码、token。

```powershell
npm ci
npm run browsers
npx shopify store auth --store azhiip-13.myshopify.com --scopes read_products,write_products,read_publications,write_publications

# 首次运行：联网采集、商品同步、生成、检查、本地验证、上传独立草稿
npm run site2shop -- clone https://westandwillow.com/ --commerce --store azhiip-13.myshopify.com --out ../new-phase2

# 本轮实测：复用现有采集证据，完整重跑并更新记录中的草稿
npm run site2shop -- clone https://westandwillow.com/ --commerce --resume --out ../westandwillow-phase2 --store azhiip-13.myshopify.com
```

授权过期或权限不足时重新运行官方 auth 命令。主题上传登录也由 Shopify CLI 管理。已有采集目录必须显式传 `--resume`，且 URL 必须匹配；本轮最终完整流程复验复用了采集证据，没有再次执行首次联网采集。

所有命令建议明确传 `--out`：CLI 的兼容默认目录仍是第一阶段，第二阶段请使用独立目录。

## 已有采集目录的分步使用

以下命令要求输出目录已有 `site-ir.json` 和采集文件。单独源码 ZIP 不含采集证据，先运行 clone。

```powershell
# 只生成商品计划，不写入店铺
npm run site2shop -- catalog-plan --out ../westandwillow-phase2

# 同步商品、编译、生成本地预览、Theme Check、上传草稿
npm run site2shop -- install --out ../westandwillow-phase2 --store azhiip-13.myshopify.com

# 如仅需同步目录，可独立调用；随后 build 更新主题绑定
npm run site2shop -- catalog-sync --out ../westandwillow-phase2 --store azhiip-13.myshopify.com
npm run site2shop -- build --commerce --out ../westandwillow-phase2

# 本地预览，不提交购物车
npm run site2shop -- serve --out ../westandwillow-phase2
```

第三阶段只读发现与本地编译：

```powershell
npm run site2shop -- phase3-plan --out ../westandwillow-phase3 --samples 3
npm run site2shop -- phase3-content-plan --out ../westandwillow-phase3
npm run site2shop -- build --commerce --out ../westandwillow-phase3
npm run site2shop -- check --out ../westandwillow-phase3
npm run site2shop -- serve --out ../westandwillow-phase3 --port 4175
```

本地第三阶段预览路径为 `/pages/about-us`、`/collections/2022-line-portraits` 和 `/?view=s2s-standard-product`。内容快照明确标记为 `writeReady: false`；在复杂商品族适配器、目标冲突检查及 Shopify 新权限完成前，工具不会把 55 个页面视作可直接写入的安装清单。

`install` 包含目录同步，通常无需先单独 catalog-sync。本地默认首页为 `http://127.0.0.1:4173/`，商品视觉模板为 `/?view=s2s-product`，报告为 `/report.html`。本地预览禁止交易；真实加购在已授权 Shopify 草稿的 `/products/s2s-custom-one-pet-portrait` 测试，新购物车为 `/cart`。

同步按选项值匹配目标规格，不沿用源站 variant ID。当前为 5 商品、85 规格（81 肖像 + 4 附加项）。重复同步实测复用 5 个、创建 0 个；已有商品所有权或快照不匹配时拒绝覆盖。目标店铺货币需与采集货币一致。

## 当前能力与边界

| 模块 | 当前行为 |
| --- | --- |
| 视觉 | 继承 W&W 布局、字体、颜色及素材；确认区和购物车延续既有样式 |
| 规格价格 | 绑定目标规格；金额与划线价同步，无有效折扣时隐藏划线价 |
| 照片名字 | 真实 multipart 文件与名字进入购物车 line item properties；JPG/PNG/WebP、最大 10 MB；已独立读取存储照片 |
| 必填限制 | 名字和照片由前端校验，尚无服务器强制必填规则 |
| 附加项 | Artwork Preview、Priority Artwork、Digital Download、Santa Hat 作为真实商品行收费；不自动履约 |
| 购物车 | 定制分组关联数量和删除；空数量会拦截，不误删整组 |
| 加购异常 | 失败时尝试回滚本次分组；回滚不确定时锁住重试并引导检查购物车，不是服务器原子事务 |
| 图库 | 规格到图片映射来自采集快照，未建立持续同步服务 |
| 订单 | 购物车实测通过；Shopify 提示商店尚未设置为接收订单，结账受阻，未创建订单 |
| 编辑器 | 首页、商品和购物车仍是整页 section，未拆成逐模块可配置单元 |
| 其余范围 | 其他页面/集合/商品、评价应用、履约服务及服务承诺未完整迁移；逐帧动画精度未验证 |

评价数字、活动、优惠、运费与服务承诺仍是原站采集快照，不会自动更新，不能据此承诺目标店铺提供同等服务。源站营销弹窗、聊天和第三方评价 feed 不在本轮迁移范围。

## 验证与复验

```powershell
npm run typecheck
npm test
npm run site2shop -- check --out ../westandwillow-phase2
npm run site2shop -- verify --out ../westandwillow-phase2

# 从官方主题编辑器取得已授权草稿预览链接，替换占位符
npm run site2shop -- verify --out ../westandwillow-phase2 --remote '<已授权草稿预览链接>'
npm run site2shop -- verify-commerce --out ../westandwillow-phase2 --remote '<同一店铺的已授权草稿预览链接>'
```

预览链接可能含临时密钥，不要提交到仓库；工具不保存该输入链接。密码页会报告失败。交易检查使用独立浏览器购物车和测试图片，不付款、不创建订单。

本轮 typecheck 和 13 个测试通过，包含站点地图解码、路由分类、空数量拦截及规格切换时划线价同步/隐藏。第三阶段官方 Theme Check 为 0 错误、40 警告；第二阶段 4 个 GraphQL 操作验证仍有效。技能内 Liquid validator 因缺少 `@shopify/theme-check-common` 未运行，已使用官方 CLI Theme Check 验证，不能称所有 Toolkit 检查均通过。

本地、Shopify 六组截图和购物车检查均通过；购物车通过不包含订单完成。具体哈希、时间与证据见 `phase2-notes.md`。`verification-local.json`、`verification-shopify.json`、`verification-commerce.json` 分开保存对应结果；`verification.json` 当前指向 Shopify 检查。报告与 `theme-build.json` 核对，哈希失配时隐藏过期通过证据。

截图差异仅比较同宽、同浏览器下的**顶部 1000 像素**，pixelmatch threshold=0.1；不是全页、全站或主观还原度。完整截图可从报告打开。当前六组首屏差异为 0%–0.22%，不证明逐帧动画或所有状态完全一致。

## 实现与继续开发

`capture → assets → catalog-plan/catalog-sync → compiler + commerce → theme.zip → verify/verify-commerce → draft`

编译器移除源站执行脚本与事件处理器，由维护的 runtime 恢复交互，不运行源商家的订单、营销、评价脚本。deploy 仅创建或更新记录中的 unpublished 草稿，拒绝覆盖 live 主题，没有发布命令。目录同步通过官方 CLI 调用 Admin GraphQL，Ajax Cart 负责浏览器购物车。

后续需完成接单条件与真实测试订单、服务器必填校验、定制履约、其他页面路由、评价应用、逐模块编辑和全页/动画状态矩阵，再扩展其他站点适配器。公开 URL 无法提供商家后端配置。当前仍是本机原型，尚非多租户公网抓取服务。

官方参考：[主题上传](https://shopify.dev/docs/api/shopify-cli/theme/theme-push)、[替代模板](https://shopify.dev/docs/storefronts/themes/architecture/templates/alternate-templates)、[Ajax Cart](https://shopify.dev/docs/api/ajax/reference/cart)、[productSet](https://shopify.dev/docs/api/admin-graphql/latest/mutations/productSet)、[测试订单](https://help.shopify.com/en/manual/checkout-settings/test-orders)。
