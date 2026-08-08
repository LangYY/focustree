# HANDOFF

当前项目状态的唯一事实来源。信息过时就直接替换，不要堆积历史（历史进 `MEMORY.md`）。

> 说明：本文件于 2026-08-08 建立，初版只覆盖当前分支上已验证的状态。产品层面的路线图与优先级尚未录入，需要补充。

## 当前分支

`feature/priority-engine-v2`（相对 `main`）

## 架构现状

**优先级引擎 V2** 是当前的核心机制，已取代早期的「权重协商」体系（`set_weight` / `branch_weight_proposals` / `weight_strategy` 已全部移除，不要再引入）。

分工：

- 模型侧（`server/agent.js`）只输出**语义分析**：`goal_analysis`（目标拆解）和 `node_priority_proposals`（节点的 `goal_alignment` / `necessity` / `delay_cost` / `relation_type`）。模型不计算最终分数、权重百分比或同级配比。
- 本地侧（`server/priorityAnalysis.js`）用确定性算法据此算出最终优先级。
- 两者之间由 `normalizeThinking` / `validateOutput` 做归一化与校验，`node_priority_proposals` 的 `node_id` 必须是当前树中的真实 id。

目标变更需用户在对话卡片中确认后才应用（`PriorityAnalysisCard` → `App.jsx: onApplyPriorityAnalysis` → `useChat.js`），不走直接设置。

**AI 回复口径**：`thinking` 是模型自用的推理脚手架（防遗漏、便于审计），`reply` 和 `ThinkingCard` 只呈现对用户有决策价值的内容。新增字段时先想清楚它属于哪一侧；详见 `MEMORY.md` 2026-08-08 条目。

## 验证方式

- `npm test` — `test/priorityEngine.test.js` + `test/priorityAnalysis.test.js`，13 项，当前全绿
- `npm run build` — 通过
- `npm run lint`

## 已知问题

- ESLint 未给 `server/` 配 node globals，`server/agent.js` 稳定报 10 个 `process is not defined`。属配置缺口，非代码缺陷，尚未修复。
- 打包产物单 chunk 已超 500 kB（`dist/assets/index-*.js` ≈ 639 kB），暂未做代码分割。

## 下一步

- 待补：产品路线图与当前迭代目标。
- 可选：修 ESLint 的 server 环境配置。
