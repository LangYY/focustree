# HANDOFF

当前项目状态的唯一事实来源。信息过时就直接替换，不要堆积历史（历史进 `MEMORY.md`）。

最后更新：2026-08-11。

## 当前分支

`feature/priority-engine-v2`。本轮轨道 E 已完成代码与本地验证，当前 `HEAD` 为已有提交 `dbe3756`，工作树干净；本次发布尝试未新增提交。

## 当前架构

### 新手引导

- `src/lib/onboarding.js` 是纯状态机；`src/hooks/useOnboarding.js` 只负责用户、树、消息和本地存储的协调。
- `src/components/Onboarding/` 负责空画布岔路、对话内行动提示、三个示例输入和收尾。没有遮罩、tooltip tour、气泡教学层或步骤计数器。
- 首次进入条件是当前用户节点数为 0 且 `localStorage.ft_onboarded` 未置位。真实输入沿用现有 `/api/agent`；提案卡用 `--ft-accent` 呼吸描边；全部采纳后等待树生长并 fit-to-view；最后自动发送「问问今天该做什么」，推荐返回后置位完成标记。
- 每一步都可以跳过；账户菜单提供「重新看一遍引导」「载入示例数据」「清空全部」。结束后常驻界面不保留引导元素。

### 示例数据

- `src/lib/exampleData.js` 生成 22 个当前用户节点：3 project、6 category、13 task，三条互相争夺注意力的主线分别是 B 站频道、现金流与求职、独立产品副线。
- 每个节点都有 `status`、`current_priority`、`target_completion_date`；示例阶段目标为「在 9 月前发布 3 条视频，同时稳住现金流」。数据通过当前用户 `user_id` 写入，可由「清空全部」重置。
- 在固定 2026-08-10 参考时间下，三条顶层主线的 direct / branch / cultivation 约为：内容 `67 / 71 / 67`，现金流 `83 / 83 / 64`，副线 `8 / 40 / 53`；三个视觉通道在示例树上有明显差异。树的视觉和交互实现未改。

### 周回顾与模型

- `src/lib/reviewSerialization.js` 负责干净小标题的序列化；`useWeeklyReview` 使用并重新导出 `serializeReview`。
- `useChat.injectReviewMessage` 先用 `reviewFormat.js` 解析，再序列化为无 emoji 文本；`reviewFormat.js` 对历史 emoji 数据的清洗保留。对话注入和 Review 视图共用同一解析契约。
- `server/agent.js` 的 Agent 请求恢复 `temperature: 0.3`，保留 `deepseek-v4-flash`、`reasoning_effort: max` 和 `max_tokens: 16000`。

## 验证

- `npm test`：53/53 通过。
- `npm run lint`：0 error，5 个既有 exhaustive-deps warning（`useChat.js` / `useWeeklyReview.js`）。
- `npm run build`：通过；保留既有 runtime-config 非 module 提示和大 chunk warning。

## 禁改边界

- 未修改 `src/lib/priorityEngine.js`、`src/lib/priorityAnalysis.js`、`src/lib/intentClassifier.js`、`src/lib/supabase.js`、数据库结构或 `TreeView.jsx` 的交互层。
- 未新增依赖；未改变现有 hooks 的对外参数签名。

## 下一步

用户已验收并授权发布。2026-08-11 使用 `scripts/deploy-ecs.sh --full` 成功发布到 `focus.buzzegg.cn`：

- 前端 `dist`、`server/` 和生产依赖已同步，`focustree.service` 已重启并保持 active。
- 部署脚本自带 `/health 200` 通过；随后 `npm run cloud:smoke -- https://focus.buzzegg.cn --require-readiness` 全部通过（health、readiness、runtime config、首页、SPA fallback）。
- 浏览器 canary 加载登录页成功，HTTP 200、页面 readyState complete、标题「专注树」、关键登录/注册文案和截图均正常；本次未使用账户执行认证后流程。
- 首次 readiness 检查曾短暂返回 `priority_analysis_runs` 503，立即重跑已恢复 200，当前数据库表检查全部通过。
- 远端 `npm ci --omit=dev` 报告 5 个既有依赖漏洞（1 low、1 moderate、1 high、2 critical），未在发布中自动修复。

当前线上已可用，等待用户验收；本次未新增 commit，交接文档和部署报告仍保持未提交状态。
