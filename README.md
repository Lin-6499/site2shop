# Site2Shop

供 AI Agent 配合使用的电商站点复刻工具，提供源站采集、结构化证据、主题生成、本地预览、交互与视觉验收，以及平台交付入口。当前版本为 `0.3.0`，包含 Shopify 流程和 SHOPYY 适配器。

**它不是任意 URL 一键生成可上线商店的工具。** 当前代码包含 West & Willow、Harold Home、Void Research 等项目适配；新的站点通常需要制定采集计划、补齐项目配置、页面族契约与生成器实现。

## 与两个 Skill 配合使用

| 仓库 | 用途 |
| --- | --- |
| [Shopify Site Replication Skill](https://github.com/Lin-6499/shopify-site-replication-SKILL) | 指导 Agent 分析、实现和验收 Shopify 复刻 |
| [SHOPYY Site Replication Skill](https://github.com/Lin-6499/Shopyy-Site-Replication) | 指导 Agent 生成 SHOPYY 皮肤并结合皮肤编辑器交付 |
| 本仓库 | 两套流程共用的实际执行工具 |

推荐按目标平台安装对应 Skill，首次执行复刻时由其准备脚本安装固定版本的本工具及依赖。Skill 安装本身不会执行安装脚本，也不会自动登录或修改店铺。工具能够独立运行 CLI，但分析、计划、适配实现和逐图审阅仍需要 Agent 或操作者完成。

## 安装与环境要求

- Node.js 22+，包含 npm。
- Git。
- Python 3.10+，用于证据验证；不在 PATH 时通过 `SITE2SHOP_PYTHON` 指定可执行文件。
- 下载源码、依赖和 Chromium 时需要网络；Linux 还可能需要 Chromium 系统依赖。
- 目标店铺写入需要相应账号、权限和本次任务授权。

```powershell
git clone https://github.com/Lin-6499/site2shop.git
cd site2shop
npm ci
npm run browsers

# 查看实际可用命令
npm run site2shop -- --help
npm run site2shop -- platform-list
npm run site2shop -- shopyy-workflow --help
```

仓库包含 npm 锁文件，上述流程使用 npm。两个 Skill 的环境准备脚本将版本固定到已选择的提交；直接克隆本仓库默认使用远程默认分支，二者版本可能不同。不要把 Skill 更新等同于工具升级。

若已通过 Skill 安装，可将脚本返回的 `site2shopHome` 作为终端工作目录，并使用返回的 Python 路径。`SITE2SHOP_HOME` 是 Skill 准备脚本选择已有工具的配置，不是每个 CLI 命令的通用参数。

## 项目与工具目录分开

每个复刻项目独立保存配置、源站素材、采集证据、契约、构建产物和验收报告。CLI 中明确传入项目配置或输出目录，推荐使用绝对路径：

```text
workspace/
  site2shop/               工具源码与依赖
  projects/
    example-shopify/       Shopify 采集、绑定与输出
    example-shopyy/        SHOPYY 配置、契约、证据与输出
```

不要复用另一店铺的商品/SKU/variant ID 或部署记录。工具仓库不附带可直接套用到任何商店的项目配置、私有采集数据、店铺授权或浏览器登录态。配置必须根据真实源站与目标能力建立，缺少证据时门禁可能阻止生成或交付。

## Shopify 工作流

配合 [Shopify Skill](https://github.com/Lin-6499/shopify-site-replication-SKILL) 执行：源站盘点 → 计划 → 三端采集 → 页面族契约 → 生成器实现 → 本地验证 → 双站验收 → 授权草稿上传 → 在线验收。

先查看相关入口及参数，不要把帮助命令替换为未经批准的写入操作：

```powershell
npm run site2shop -- clone --help
npm run site2shop -- evidence-plan-check --help
npm run site2shop -- build --help
npm run site2shop -- serve --help
npm run site2shop -- visual-review-prepare --help
npm run site2shop -- deploy --help
```

`clone`、`install`、目录同步及部署等命令可能组合多项操作。实际执行前按帮助和项目配置核对采集、商品/页面写入与草稿上传范围。生成要求有效源站证据，草稿上传和发布受各阶段门禁约束，命令存在不代表当前项目已满足前提。

Shopify 登录通过官方 CLI 流程进行，授权范围取决于任务。主题包不包含商品数据库；商品、集合、页面、评价应用与服务集成需要各自的映射与验证。购物车通过不等于付款、订单或履约通过，源站评价和营销承诺不能直接当作目标店铺事实。

相关文档：

- [可执行证据与发布门禁](docs/evidence-pipeline.md)
- [双站视觉审阅协议](docs/visual-review-mechanism.md)
- [增量采集与缓存](docs/incremental-capture.md)

## SHOPYY 工作流与皮肤编辑器

配合 [SHOPYY Skill](https://github.com/Lin-6499/Shopyy-Site-Replication) 执行。完整步骤和项目配置见 [SHOPYY 工作流](docs/shopyy-workflow.md)，类型与实现位于 `src/shopyy/`、`src/platforms/`。

```powershell
npm run shopyy:workflow -- --help
npm run site2shop -- platform-build --help
npm run site2shop -- platform-serve --help
```

已有经分析建立的项目配置时，可按实际路径运行下面的示例；`D:/replication/example-shopyy/shopyy.project.json` 是占位路径，仓库不包含该文件：

```powershell
npm run shopyy:workflow -- discover --project 'D:/replication/example-shopyy/shopyy.project.json'
# 盘点完成后，Agent 审核并完善独立计划，再继续采集与契约生成。
npm run shopyy:workflow -- gate --stage plan --project 'D:/replication/example-shopyy/shopyy.project.json'
npm run shopyy:workflow -- capture --stage source --project 'D:/replication/example-shopyy/shopyy.project.json'
npm run shopyy:workflow -- contracts --project 'D:/replication/example-shopyy/shopyy.project.json'
# Agent 完成当前证据到页面族/生成器的绑定后，才进行正式构建。
npm run site2shop -- platform-build --platform shopyy --project 'D:/replication/example-shopyy/shopyy.project.json'
```

构建后仍需逐状态配对采集、Agent 实际审图与交互验证、失败修复和当前构建的验收门禁。命令顺序不能代替中间的分析、实现和审阅。

平台交付通过目标店铺实际可用的 **皮肤编辑器** 应用完成：备份现有皮肤和绑定记录，使用独立预览皮肤，经在线编辑或专用 Gitee 运行分支交付，核对逐文件同步/保存与真实平台读回，再检查三端预览及装修设置。

**绑定 Gitee 会删除已有皮肤代码；解绑不会恢复。** 这三个 GitHub 工具/Skill 仓库不应直接绑定为目标皮肤运行仓库。`draft-package` 仅生成受门禁约束的本地交接包，不会上传或发布。具体入口与注意事项见 [皮肤编辑器流程](https://github.com/Lin-6499/Shopyy-Site-Replication/blob/main/references/skin-editor.md)。

## 测试与验收

按实际改动选择检查：

```powershell
npm run typecheck

# SHOPYY 相关改动
npm run test:shopyy

# 共用或 Shopify 相关改动，按影响范围选择对应测试
npm test
```

SHOPYY 任务不要求运行 Shopify Theme Check 或 Shopify CLI/API 检查。Shopify 主题检查也不能代替 SHOPYY 原生环境验证。

源码测试、CLI/浏览器启动、本地生成、三端视觉与交互验收、草稿在线验证、正式发布分别记录。测试夹具通过只能证明对应实现行为；没有项目当前构建的证据，不能宣称站点已复刻完成。仓库不声明当前所有测试、站点或平台交易链路均已通过。

## 目录

| 路径 | 内容 |
| --- | --- |
| [src/cli.ts](src/cli.ts) | 命令行入口 |
| [src/platform.ts](src/platform.ts) | 目标平台接口 |
| [src/platforms/](src/platforms/) | 平台适配器 |
| [src/shopyy/](src/shopyy/) | SHOPYY 工作流与实现 |
| [scripts/](scripts/) | 验证、交付与项目辅助脚本 |
| [scripts/evidence-gates/](scripts/evidence-gates/) | 证据验证工具 |
| [tests/](tests/) | 回归测试和夹具 |
| [docs/](docs/) | 详细操作与契约说明 |

部分辅助脚本带有项目专用路径、店铺或资源标识，使用前须检查其输入和行为；不要将其当作其他店铺的通用安装命令。

## 发布与问题反馈

本地实现或修复授权不等于正式上线授权。Shopify 正式主题发布，以及 SHOPYY 正式皮肤推送、同步、发布、切换和回滚，都需要明确的目标、当前验收证据与对应操作批准。

反馈问题时附上工具提交、目标平台、脱敏配置、执行命令、错误与最小复现步骤。密钥、访问令牌、Cookie、客户资料和带临时密钥的预览链接不要提交到仓库。
