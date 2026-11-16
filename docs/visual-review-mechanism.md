# 双站逐步视觉审阅（项目执行协议）

本项目不再把组件存在、像素百分比、批量勾选或脚本执行结束当作视觉验收通过。
此文档是项目执行器的新格式规范：`paired-browser-review` schema 2、`agent-visual-review` schema 3。
旧的 paired schema 1 / summary schema 2 无效，必须重新实际审阅；不能批量升级版本号和时间戳。

## 分工与边界

- 智能体：使用 `shopify-site-replication`，实际查看两个浏览器页面与图片，执行同等操作，作出结构、尺寸对齐、样式、溢出、交互判断。
- 脚本：生成默认 `pending` 的清单、保存/验证哈希、身份、覆盖范围、观测值、时间顺序和缺陷回放引用；不能替智能体看图或自动写 `pass`。
- 像素差异：仅辅助定位，不自动通过或失败。
- 客观契约：仍独立重算，智能体好评不能覆盖确定性失败。
- 发布授权：仍独立；审阅提交通过返回 `releaseAuthorized: false`，不会上传或发布。

哈希证明文件一致，不证明智能体真的看过。记录必须来自实际工具操作；不得根据测量结果或旧报告编造浏览/看图经历。这个机制不宣称能用 JSON 校验替代视觉智能。

## 固定操作流程

1. 从完整、独立的侦察及采集计划确定全部路由 × 桌面/平板/手机 × 状态 × 转移。不能从成功采集的行反推分母。
2. 打开源站与本地当前构建（preflight）或已授权的草稿主题（online），匹配视口、语言、选项、滚动位置和初始条件。核实 pathname/canonical/build/theme；密码页和挑战页无效。
3. 采集并直接审阅初始双站视口图、完整页面图与 DOM/测量数据。按计划逐组件检查；来源可复用的采集缓存不代替这次真实交互审阅。
4. 每条转移：双站 before → 智能体查看 before → 两站按计划操作同一控件/输入 → 双站 after → 智能体查看 after 并记录判定 → 才执行下一条。按 `captureSequence` 回放，包括反向、重复及错误状态。
5. 发现缺陷：记录稳定 ID，保留失败原件。缺证据回到采集；实现问题修改生成器/适配器，然后重新生成并重放受影响范围。普通授权范围内继续修复，无需用户每次催促；未知业务选择或外部写入权限不足则说明阻塞，不能伪造通过。
6. 同一构建完成全部计划后提交配对记录，再填写/提交汇总。上传前与线上发布前分别重算所有门禁。主题上传后还必须做 online 双站审阅，preflight 不能替代。

## 命令

```powershell
npm run site2shop -- visual-review-prepare --out <output> --stage preflight
# 智能体实际操作并填写 paired-review-work/preflight/paired-review-input.json
npm run site2shop -- visual-review-submit --out <output> --stage preflight --kind paired --input <explicit-paired.json>
npm run site2shop -- visual-review-prepare --out <output> --stage preflight --summary
# 智能体检查覆盖清单后填写汇总，不自动填 pass
npm run site2shop -- visual-review-submit --out <output> --stage preflight --kind visual --input <explicit-summary.json>
npm run site2shop -- visual-review-validate --out <output> --stage preflight
```

`prepare` 使用独占创建，不覆盖现有判定。正式提交归档候选和上一份文件；新提交失败会把活动报告保留为失败，不沿用旧绿色报告。缺陷不能在再次提交时消失，须记录当前构建中的对应组件/状态或转移回放。提交回执在 `paired-review-work/<stage>/*-submission.json`。

旧 `mark-transitions`、`finalize`、`--confirmed-by-skill-agent` 自动填充路径已禁用。缩略图拼图仍可诊断，但不能作为完整/原尺寸图片审阅的替代物。需要修改现有待审清单时明确编辑或另存新文件，不删除既有缺陷与历史证据。

## 每个检查必须提交的证据

- `before`（及转移的 `after`）：source/target 内容寻址状态文件；状态文件含实际 DOM、1×视口 PNG、组件观测和计算样式/边界尺寸。
- 初始状态额外含 `artifacts.fullScreenshot` 和真实 `documentSize`。整页 PNG 尺寸必须匹配文档，不接受仅把视口图换个名字当整页；需要低部懒加载状态时在计划中增加滚动及 ready 条件，整页截图本身不代替触发加载。
- `beforeInspection`（转移）和 `inspection`：内容寻址 JSON，`schemaVersion:1`、`method:direct-paired-image-and-dom`，绑定 stage/planSha256/themeBuild/routeId/viewport/kind/nodeId/phase；记录实际 `inspectedAt`、具体观察 notes，`images:[{side,region,image:{path,sha256}}]`。后审阅时间必须等于检查的 `reviewedAt`。
- `actionLog`：两站的真实 trace，绑定实际 before/after 引用、计划 from/to/action/condition，逐动作记录 op、selector、输入、开始/结束时间。每个操作必须符合独立 `probe[side]` 配方；不同站的定位符可不同，业务输入必须相同。不能把一次离线批量回放伪装为逐步智能体审阅。
- 每个组件含 `aspects.structure/layout/styling/overflow/behavior`，各项必须有明确 verdict 及两站具体观察；`evidence` 逐阶段/侧引用 `/components/<id>`，渲染型组件还需 `/presentationRaw/<id>/box`、`/computed`，引用值必须与实际采集一致。
- 汇总按 **routeId × viewport** 唯一列出 family、inspectedRegions、完整 inspectedStateIds/inspectedTransitionIds、结论和理由；不能漏路由、重复覆盖或用家庭级汇总掩盖未测路由。
- 不接受全局 `acceptedDeviations` 豁免。合法评论数量等动态数据差异应在独立契约中明确限定到内容字段；不能豁免评论区宽度、位置、样式或交互。

`findings` 已修复项必须有 id、description、componentId、routeId、viewport、status:resolved、retestedBuild、retestKind、retestCheckId。仅写 resolved 不算重测。

## 验证范围

`tests/paired-browser-review.test.ts` 使用明确标识的合成夹具测试门禁正反例，不是线上验收：旧报告、批量时间、遗漏组件/样式/整页/三端/步骤、错误控件、不同输入、伪造引用值、错误页面/主题、未解决缺陷、失败项消失等必须阻断。
测试还直接调用真实 deploy / approveRelease / publishPhase5 入口，确认不完整审阅先于外部操作失败。普通契约、主题检查和人工确认仍然保留。
