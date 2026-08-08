# MEMORY

meaningful implementation changes, decisions, experiments, and failed approaches worth remembering.

---

## 2026-08-08 — reply 人话化改造；拒绝整包合并 focustree-voice-changes.zip

**背景**：外部产出了一个 `focustree-voice-changes.zip`（含 `server/agent.js` + `src/components/Chat/ChatPanel.jsx`），意图是优化 AI 回复的结构与语气。

**决定：不整包应用，只做外科式摘取。** 该包是在 priority-engine-v2 之前的代码基线上改的，整体合并会造成四类回退：

1. 删掉 `goal_analysis` / `node_priority_proposals` / `normalizeThinking` / `clampUnit` / `normalizeDate` 及其校验，换回旧的 `set_weight` + `branch_weight_proposals` + `weight_strategy` 权重协商体系；
2. ChatPanel 全量换成 `text-accent` / `bg-panel-soft` / `text-ink-faint` / `border-line` 等语义 token —— 本项目是 Tailwind v4 且 `src/index.css` 无任何 `@theme` 定义，这些 class 不会被生成，面板会整体掉色；
3. `PriorityAnalysisCard` → `WeightPlanCard`，prop 从 `onApplyPriorityAnalysis` 改成 `onApplyWeightPlan`，与 `src/App.jsx` 的接线不匹配，卡片将永不渲染；
4. `/目标` 命令回退为直接 `onSetGoal`，绕过"先让 AI 拆解目标、用户确认后再应用"的流程。

**实际采纳的部分**：

- `server/agent.js`：系统提示词新增 `## reply 的人话原则（重要）` 段落，明确 thinking 是模型自用的推理脚手架、reply 才是用户实读内容；禁固定句式开场（尤其"我的判断：..."）、禁在 reply 里堆砌已在 thinking 中拆解过的所有维度，附机械版/人话版正反例。
- `server/agent.js`：`reply` schema 描述同步改写，去掉硬性句式要求。
- `server/agent.js`：修掉一处自相矛盾 —— 原「reply 要有重点、有条理：一句判断逻辑 + 2-4 条主线 + 合并/暂缓说明」正是新规则要求避免的机械结构，已改写。该矛盾原包自己没理顺。
- `src/components/Chat/ChatPanel.jsx`：`ThinkingCard` 从渲染 14 个字段砍到 7 个，其余字段（`situation_map` / `assumptions` / `goal_usage_mode` / `preserved_inputs` / `merged_duplicates` / `user_goal` / `traps_avoided` / `leverage_insight` / `success_criterion`）属"审计口径"，是模型防遗漏用的，不给用户看。删除随之失去引用的 `goalUsageLabel`。

**两处偏离原包的判断**：

- 保留了 `deferred_or_unsure`（暂缓）和 `risk_if_skipped`（不做的代价）—— 原包一并砍掉，但"什么被暂缓了""不做会怎样"是用户据以决策的信息，不属内部记录。故砍到 7 项而非原包的 5 项。
- `hasStructuring` 判定收紧为 `proposed_panel_changes || deferred_or_unsure`。原包用 `proposed_panel_changes || open_questions`，但 `open_questions` 在推荐类回复中同样出现，会把推荐场景误标成"为什么这样整理"。

**教训**：外部交付的代码包必须先确认其基线 commit，再判断能否合并。行数变少不等于是精简，也可能是回退。

---

## 2026-08-08 — FocusTree 全量 UI 重做

### 决策

- UI 以 `DESIGN.md` 为准，建立 token-first 视觉系统；主题变量集中在 `src/styles/tokens.css`，分支色板集中在 `src/lib/branchPalette.js`。
- 采用“画布 + 左 rail + 单右抽屉”布局，Chat / Inbox / Detail / Audit 是固定工作面；Focus / List / Review 作为主画布模式。
- 三个优先级信号分别映射为节点半径与辉光、填充枝干宽度、培育年轮；期限弧、紧急芽点、状态形状只提供辅助语义。
- UI 重做不改 `server/`、优先级引擎、分析协议、数据库和既有 hook 签名；用纯 render helper 拆分 D3 视觉计算，保留原交互层。

### 验证与经验

- 新增 `lucide-react` 后完成生产构建；Windows 沙箱中的 Node 子进程会触发 `spawn EPERM`，构建和测试需在受限沙箱外执行。
- 旧全局 `.link { fill: none }` 会覆盖新枝干填充，已删除；这是迁移旧 D3 样式时需要重点检查的冲突类型。
- Inbox 预览使用克隆树重算本地优先级，且将活动/已处理条目 memo 化，避免预览 state 更新造成 effect 循环。

---

## 2026-08-09 — UI 重做发布到 ECS

- 将全量 UI 重做提交为 `31c708f` 并推送到 GitHub `feature/priority-engine-v2`。
- 确认线上沿用既有 ECS 生产服务部署方式，不是 Docker；通过 GitHub 拉取新版本到独立目录，远程 `npm ci` 和 `npm run build` 成功后再切换服务。
- 未改动线上 `.env`，切换前将旧版本原样保留在远程回滚备份中；新服务启动后公网首页和健康检查均验证通过。
