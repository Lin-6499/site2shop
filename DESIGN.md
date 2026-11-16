---
"name": "Site2Shop · West & Willow 第一阶段"
"description": "原站主题视觉提取与独立中文验证报告样式；仅覆盖首页和单商品模板。"
"colors":
  "bs-primary": "#cca38b"
  "bs-primary-lighter": "#dcbfae"
  "bs-primary-darker": "#bc8768"
  "bs-secondary": "#1a2829"
  "bs-secondary-lighter": "#2e4648"
  "bs-dark": "#141518"
  "bs-light": "#f6efeb"
  "bs-light-lighter": "#fcfaf9"
  "bs-light-darker": "#f0e4dd"
  "bs-muted": "#6c757d"
  "white": "#fff"
  "product-surface": "#F8F8F8"
  "option-badge": "#1a282966"
  "report-text": "#243334"
  "report-background": "#f7f6f2"
  "report-link": "#94503a"
  "report-status": "#e9eee7"
  "report-muted": "#596661"
  "report-border": "#ddd"
  "report-divider": "#bac5bd"
"typography":
  "display":
    "fontFamily": "\"Crimson Pro\", serif"
    "fontSize": "calc(1.425rem + 2.1vw)"
    "fontWeight": 500
    "lineHeight": 1.2
  "headline":
    "fontFamily": "\"Crimson Pro\", serif"
    "fontSize": "calc(1.375rem + 1.5vw)"
    "fontWeight": 500
    "lineHeight": 1.2
  "title":
    "fontFamily": "\"Crimson Pro\", serif"
    "fontSize": "1rem"
    "fontWeight": 500
    "lineHeight": 1.2
  "body":
    "fontFamily": "Karla, sans-serif"
    "fontSize": "1rem"
    "fontWeight": 400
    "lineHeight": 1.5
  "label":
    "fontFamily": "Karla, sans-serif"
    "fontSize": "1rem"
    "fontWeight": 400
    "lineHeight": 1.5
  "navigation":
    "fontFamily": "Karla, sans-serif"
    "fontSize": "1rem"
    "fontWeight": 700
    "lineHeight": 1.5
  "report-body":
    "fontFamily": "system-ui, sans-serif"
    "fontSize": "16px"
    "lineHeight": 1.65
  "report-display":
    "fontFamily": "system-ui, sans-serif"
    "fontSize": "36px"
    "letterSpacing": "-1px"
  "report-headline":
    "fontFamily": "system-ui, sans-serif"
    "fontSize": "22px"
"rounded":
  "control-pill": "50rem"
  "small": ".25rem"
  "card": "1rem"
  "product-media": "1.25rem"
  "panel": "1.5rem"
  "report": "0"
"spacing":
  "3": ".5rem"
  "4": ".75rem"
  "5": "1rem"
  "6": "1.25rem"
  "8": "1.75rem"
  "12": "4rem"
  "report-cell": "12px"
  "report-gap": "20px"
  "report-inset": "24px"
  "report-section": "48px"
"components":
  "button-primary":
    "backgroundColor": "{colors.bs-primary}"
    "textColor": "{colors.white}"
    "typography": "{typography.label}"
    "rounded": "{rounded.control-pill}"
    "padding": ".375rem 1.25rem"
  "button-primary-hover":
    "backgroundColor": "{colors.bs-primary-darker}"
    "textColor": "{colors.white}"
  "button-outline":
    "backgroundColor": "transparent"
    "textColor": "{colors.bs-primary}"
    "typography": "{typography.label}"
    "rounded": "{rounded.control-pill}"
    "padding": ".5rem 1.25rem"
  "input-text":
    "backgroundColor": "{colors.white}"
    "textColor": "{colors.bs-dark}"
    "typography": "{typography.body}"
    "rounded": "{rounded.control-pill}"
    "padding": ".375rem .75rem"
    "width": "100%"
  "navigation-link":
    "textColor": "{colors.bs-primary}"
    "typography": "{typography.navigation}"
    "padding": ".5rem .75rem"
  "summary-card":
    "backgroundColor": "{colors.product-surface}"
    "textColor": "{colors.bs-dark}"
    "rounded": "{rounded.card}"
    "padding": "{spacing.5}"
  "option-badge":
    "backgroundColor": "{colors.option-badge}"
    "textColor": "{colors.white}"
    "rounded": "{rounded.control-pill}"
    "padding": ".35em .75rem"
  "report-status":
    "backgroundColor": "{colors.report-status}"
    "textColor": "{colors.report-text}"
    "typography": "{typography.report-body}"
    "rounded": "{rounded.report}"
    "padding": "{spacing.report-gap}"
---

# Design System: Site2Shop · West & Willow 第一阶段

## Overview

**Creative North Star: "West & Willow 原站快照的近 1:1 继承"**

本阶段的视觉权威是用户指定的 West & Willow 原站及本次采集快照。首页与单商品视觉模板继承原站布局、字体、颜色、图文和素材；本文件记录已实现的事实，不建立替代品牌，也不授权重新设计。

Site2Shop 的中文验证报告是独立的阅读界面，使用 system-ui、固定表格布局与截图对照。报告样式只服务验证信息，不覆盖店铺视觉。原站素材来源以 assets-manifest.json 为准；本文件与 sidecar 是从代码提取的索引，冲突时先核对采集证据和实际样式级联。

**Key Characteristics:**

- 商店：衬线标题、无衬线正文、暖米棕与深灰绿、胶囊控件和圆角图片。
- 素材：保留原站图片、字体与品牌；来源 URL、哈希和下载状态可追溯。
- 报告：中文说明、表格和截图并排对照；生成、本地检查、Shopify 检查、交易状态分开表述。

提取范围：2026-10-19 的阶段一产物。主题位于 `../westandwillow-phase1/theme/`；原站采集时间为 `2026-10-19T08:31:47.783Z`。本次为代码提取，不替代独立截图评审。

| 事实来源 | 用途 |
| --- | --- |
| `PRODUCT.md`、`README.md` | 固定参考及阶段边界 |
| `../westandwillow-phase1/assets-manifest.json` | 本地资源到原站 URL、哈希、下载状态的映射 |
| `theme/assets/s2s-c194ff1fde67f5ad.css`（原站 variables.css） | 商店颜色与字体变量 |
| `theme/assets/s2s-f48a9104574d40e3.css`（原站 bootstrap.css） | 字号、间距、容器、断点及基础控件 |
| `theme/assets/s2s-2810b3ea13973934.css`（原站 base.css） | 品牌色覆盖、控件状态、圆角、阴影 |
| `theme/assets/s2s-6d02b0bf99b6bd1f.css`、`s2s-25f7d3b90fa8744b.css` | 原站 sections.css / product.css 的导航、FAQ、选项与商品细节 |
| `theme/layout/theme.liquid`、`theme/sections/s2s-home.liquid`、`theme/sections/s2s-product.liquid`、`theme/snippets/s2s-header.liquid` | 实际加载顺序、字体文件、页面结构、行内覆盖 |
| `theme/assets/s2s-runtime.css`、`s2s-runtime.js` | 本地交互适配与无动画偏好 |
| `src/report.ts`、`../westandwillow-phase1/report.html` | 独立报告的当前样式 |

表中 `theme/` 路径均相对阶段一产物目录。颜色、字体、圆角、间距与组件基础值只由上方 frontmatter 定义；sidecar 保存状态片段、断点、阴影、动作与同文叙述，不维护第二套 primitive token。

## Colors

商店以暖米棕、深灰绿、近黑与浅暖白组成；保留原站变量命名和颜色格式。

### Primary

- `bs-primary`：公告条、按钮、导航及链接；`bs-primary-darker` 为相应交互状态，`bs-primary-lighter` 为源站已有浅色。

### Secondary

- `bs-secondary`：星标、选项选中边框与辅助按钮；`bs-secondary-lighter` 用于辅助按钮交互。

### Neutral

- `bs-dark` 为正文；`white` 为页面与输入底色；`bs-light` 一组用于浅背景、边框和控件状态；`bs-muted` 为次要文字。
- `product-surface` 为原站商品图片与配置摘要底色；`option-badge` 保留半透明标签背景。
- `report-*` 仅对应报告的正文、纸色、链接、状态块与分隔线。报告未定义成功或失败的独立彩色徽章体系。

**The Reference Rule.** 后加载的原站 variables.css 与局部覆盖优先；不要恢复 Bootstrap 默认品牌色。首页活动按钮的珊瑚色来自该轮播的行内变量，只在原有活动模块继承，不推广为全站主色。

## Typography

标题沿用 Crimson Pro，正文与交互沿用 Karla。字体文件由主题本地 assets 加载：Karla 常规、粗体、斜体和 Crimson Pro 常规；标题 CSS 指定的权重为 500，字体资产当前提供 400，保留实际级联而不补造字重文件。

- `display`：商品主标题及使用 h1 样式的标题；宽屏覆盖见 sidecar。
- `headline`：主要区块标题；`title`：商品卡标题使用的 h6 尺度。
- `body`、`label`、`navigation`：正文、普通控件、粗体导航；导航保持原站大写文字。步骤按钮另使用原站字距工具值（.1rem）。
- `report-body`、`report-display`、`report-headline`：仅供中文验证报告；主标题移动端大小见 sidecar。

## Layout

保留原站模块顺序、桌面与手机图片版本、商品图库和分步选项位置。原站容器左右默认 gutter 为 spacing.4；宽度级别依次为 540 / 720 / 960 / 1140 / 1320px，对应 sidecar 中 576 / 768 / 992 / 1200 / 1400px 断点。不要据此重新布置页面已有的局部容器和网格。

首页商品轮播现有断点数据为手机 1 列、sm 2 列、lg 3 列；商品缩略图 runtime 为默认 5 个、575px 及以下 3 个，间距 12px。FAQ 现有内容容器最大 768px。间距 token 保留原站工具类编号，并非新的等差设计网格。

报告主容器最大 1180px，桌面内边距为 48px 24px；截图对照为两列，间距采用 report-gap。640px 及以下改为单列与 24px 16px 内边距。表格固定布局、长内容可换行；图像缩略窗口固定高 520px、顶部裁切，点击进入完整截图。

## Elevation & Depth

商店通过浅背景、轻阴影与圆角分层。图片容器及 FAQ 使用原站浅阴影，抽屉使用较明显阴影；输入焦点以主色半透明环显示。页头与抽屉遮罩保留原有背景模糊。精确阴影与状态值由 sidecar 从原站 CSS 提取，未合成新的深度级别。报告通过底色、边线与留白区分区域，没有自定义阴影。

## Shapes

普通按钮和文本输入为胶囊；卡片、主商品媒体、区块面板分别使用 frontmatter 中对应圆角。页头底部与大型菜单保留原站单侧圆角；徽章并不统一成一种形状，当前 Limited Edition 胶囊由已有工具类决定。报告表格、截图框与状态块保持直角。

## Components

- **按钮**：主色实心与主色描边均保留原站 hover / focus / active；sidecar 主按钮样本对应首页分类按钮，描边样本对应商品返回按钮。步骤 Next 使用 .5rem 4rem 或 .5rem 1.75rem 内边距及全宽，按已有位置继承，不强行统一。
- **输入**：白底、浅暖边框、胶囊形、主色焦点环；照片上传是本地预览适配，其虚线容器不是新的商店通用输入规范。
- **导航**：品牌色、粗体、大写；页头半透明白底及底部圆角继承原站。移动菜单继续使用现有 Bootstrap 抽屉。
- **商品卡与标签**：商品图片使用原站素材；配置摘要采用浅灰圆角卡；Limited Edition 保留现有半透明深灰绿标签。sidecar 卡片仅展示已存在的摘要容器。
- **FAQ**：保留胶囊问句、圆形展开符号与既有 Bootstrap 折叠行为；不以样本片段替代完整交互组件。
- **图库和进入动画**：由现有 Bootstrap / Splide 与 runtime 恢复；滚动进入观察阈值、轮播速度与 easing 记录在 sidecar。无动画偏好保留，逐帧时间曲线尚未验证。
- **报告状态块**：只说明检查阶段，前端通过不能替代后端验证。该组件只存在于报告。

阶段边界：当前每页仍是一个整页 section，尚未拆成逐模块可配置的商家编辑单元；持久上传、真实商品与 variant 绑定、购物车/订单、评价 feed 及其后端服务未完成。这里记录视觉样式，不将这些缺口转成设计 token。

未决漂移与验证范围：本次文档未改动主题，也未新增视觉规范；未进行新的全页或逐帧判定。现有首屏差异指标仅覆盖报告所述顶部 1000 像素，不能宣称所有状态均无漂移。原站后续更新不会自动同步；需要重新采集后再比对文档。源站的一次性活动色与本地上传适配保留局部范围。

## Do's and Don'ts

### Do:

- Do 延续采集快照的布局、字体、颜色、素材及响应式顺序；变更先核对来源。
- Do 将 report-* token 限定于中文报告，保留状态说明、完整截图入口与验证范围。
- Do 将本地上传预览、真实交易、动画核对和商家编辑能力按实际阶段说明。

### Don't:

- Don't 为近 1:1 复刻添加新品牌、新色阶或替换原站图片。
- Don't 用 Bootstrap 默认蓝色覆盖原站后加载的颜色变量。
- Don't 将首屏像素差异当成全页、逐帧动画或可交易商店的完成证明。
