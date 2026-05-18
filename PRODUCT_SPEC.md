# FocusTree 产品说明

> 最后更新：2026-05-17
>
> 本文说明当前 FocusTree 的产品逻辑、核心用户流程和核心算法边界。它不是未来路线图，而是当前仓库实现的产品定义。

## 1. 产品定位

FocusTree 是给多线程个体工作者使用的外脑：左侧是一棵可操作的项目树，右侧是一个能一起思考的 AI 助理。

它要解决的不是“把任务画成思维导图”，而是三个更具体的问题：

1. 我现在该做什么。
2. 我做完了什么。
3. 我想到的事情应该如何归位到可执行结构里。

目标用户包括自由职业者、内容创作者、独立开发者和需要同时推进多个项目的人。他们的困难通常不是“不知道任务列表在哪里”，而是长期目标、短期现金流、安全感、创作冲动和现实压力同时存在，导致项目之间互相抢注意力。

FocusTree 的产品核心是：把用户的混乱输入转成可讨论、可执行、可回看、可调整的结构。

## 2. 核心产品逻辑

### 2.1 树是唯一真实状态

当前项目树是应用里的唯一权威状态。聊天历史、AI 之前说过的话、会话摘要都只能作为背景，不能覆盖树的当前事实。

树的基本层级是：

- `project`：顶层主线，例如 B 站频道、求职、现金流补位。
- `category`：项目内部模块，例如熊猫团团、简历材料、外包报价。
- `task`：具体可执行动作，例如写第 2 集冷开场、更新简历核心经历。

每个节点有：

- `status`：`active`、`done`、`dormant`
- `weight`：同级分支的当前精力配比
- `expanded`：折叠展开状态
- `annotations`：AI 或用户给出的策略标签

产品原则是：用户能直接编辑树，AI 也能通过受控 action 修改树，但所有修改最终都落到同一套节点数据里。

### 2.2 AI 不是命令入口，而是协作式思考入口

简单操作不需要大模型，例如：

- “把第 2 集脚本标完成”
- “在熊猫团团下加任务剪辑第 1 集”
- “把现金流补位调到 40%”
- “删除旧项目”

这些由本地确定性算法直接执行。AI 助理真正负责的是：

- 用户说“我现在有点乱”时，拆出主线、冲突、约束和下一步。
- 用户问“我该做什么”时，结合目标、树、时间和历史命中率做取舍。
- 用户输入一段项目材料时，保留原意、合并重复、补出合理层级。
- 用户需要权重方案时，提出可讨论的精力配比草案，而不是替用户决定。

这使 AI 的入口从“智能增删改”升级为“帮助用户形成判断”。

### 2.3 目标是背景，不是意图覆盖器

阶段目标只在适合的场景里影响排序：

- 当用户问“今天做什么”“最近以什么为重点”“哪个优先”时，目标作为 priority filter。
- 当用户在梳理全局、倾诉混乱、列出项目时，目标只作为 background。
- 当用户明确说“先完整梳理”“暂时不按目标取舍”时，目标应被 ignored。

产品上要避免一种错误：因为当前目标偏向某条主线，就擅自删掉、弱化或改写用户刚刚表达的其他真实压力。

### 2.4 权重表示精力配比，不表示价值高低

`nodes.weight` 当前被解释为“同一父节点下分支的当前精力配比”。

重要语义：

- 权重不是价值判断。
- 低权重不代表应该删除。
- 低权重只表示当前阶段推荐频率更低。
- 同一父节点下的核心分支建议总和约等于 100%。
- 普通 task 默认不设权重，除非用户明确要求。

AI 在梳理全局时会输出权重草案，但不会立即写入。用户需要点击“应用权重方案”或明确确认后，才会归一化并写入 `nodes.weight`。

视觉上，树枝线宽按从根节点流到当前节点的累计精力流量映射，而不是只看当前节点的局部权重。每一层分叉都会继续分流：`child_flow = parent_flow * local_share`。如果某个节点只有一个子节点，子节点继承父节点流量；只有出现多个子分支时，线条才继续变细。

权重计算会同时结合 top-down 信号（目标、偏好、约束）和 bottom-up 信号（任务压力、阻塞、紧急性），但这只是内部计算依据。前端默认只展示最终精力配比，不把两端推导过程逐条展示给用户。

## 3. 主要用户流程

### 3.1 捕捉和整理

用户可以直接说一段自然语言：

> 我的 B 站频道在做熊猫团团，要写脚本、画分镜、配音。同时还在找工作，要更新简历和刷题。还有一个副业接外包。

AI 需要识别这不是一组平级任务，而是三条主线：

- B 站频道
- 求职
- 副业接外包

再在每条主线下放入合理的 category 和 task。若信息不足，例如副业没有客户类型和交付物，则先保留粗颗粒节点，并在 `deferred_or_unsure` 里说明。

原则上，用户明确提到的非重复项目不能因为“执行细节少”“暂时不是主线”“与目标弱相关”而被 AI 擅自删去。节点预算不足时，优先减少项目内部展开深度，而不是排除顶层项目。

### 3.2 一起梳理而不落库

如果用户只是说“你先帮我梳理一下”，AI 不直接改树。

这时输出：

- `situation_map`：主线和冲突
- `proposed_panel_changes`：建议落到面板的结构
- `draft_actions`：可延后执行的结构草案
- `branch_weight_proposals`：可讨论的精力配比草案

前端展示草案卡片，等待用户确认。

草案确认有两个入口：

- 点击“应用到面板”：应用 `draft_actions`，创建结构草案。
- 点击“应用权重方案”：应用 `branch_weight_proposals`，归一化并写入权重。

用户输入“确认 / 按这个 / 加到面板 / 就这样”等短确认时，也走本地确认逻辑，不再调用模型。应用前会检查面板中是否已有同名同父节点，避免重复创建。

### 3.3 今日推荐

用户问“我今天该做什么”时，系统结合：

- 当前项目树
- 阶段目标
- 当前时间段
- 近期会话摘要
- learned patterns
- 推荐命中率

生成 3 件事，并按早上、下午、晚上或任意做精力错峰。推荐会尽量引用真实 task id，避免编造不存在的任务。

### 3.4 周末回顾

当距离上次 review 超过一周，系统可以主动生成周回顾。周回顾不是流水账，而是基于完成任务、推荐命中率、停滞项目和近期决策，指出模式、风险和下周建议。

### 3.5 分支移动

用户可以按住节点左侧实心圆点拖拽一整段分支，把它移动到另一个节点下面。

当前语义是移动 subtree：

- 起手节点及其所有后续子节点一起移动。
- 目标节点成为新父节点。
- 禁止把节点移动到自己的子孙节点下，避免环形引用。
- 拖拽过程中禁用加号，避免误触新增节点。

## 4. 核心算法

### 4.1 本地意图分类算法

入口：[`src/lib/intentClassifier.js`](./src/lib/intentClassifier.js)

目标：把明确、机械、可确定执行的操作从 LLM 路径剥离。

解析顺序：

1. 清空全部
2. 展开或折叠全部
3. 删除整条分支
4. 删除单节点
5. 调整权重
6. 批量改状态
7. 单节点改状态
8. 重命名
9. 新增节点

节点匹配策略：

- 完全匹配优先
- 前缀匹配
- 包含匹配
- 大小写不敏感的包含匹配

如果匹配多个同强度候选，返回歧义提示，不执行操作。如果找不到节点，返回“没找到”提示。

这个算法层的作用是：

- 降低延迟
- 节省 token
- 保证命令式操作稳定
- 避免不同模型对“删除 X”“完成 X”产生不同解释

### 4.2 Agent 结构化输出算法

入口：[`server/agent.js`](./server/agent.js)

Agent 输出必须是 JSON，核心字段：

- `intent`
- `reply`
- `thinking`
- `actions`

复杂整理、推荐和规划类问题必须输出 `thinking`，其中包括：

- `brief_rationale`
- `situation_map`
- `assumptions`
- `open_questions`
- `proposed_panel_changes`
- `goal_usage_mode`
- `weight_strategy`
- `branch_weight_proposals`
- `preserved_inputs`
- `merged_duplicates`
- `deferred_or_unsure`
- `recommended_primary_id`
- `recommended_alternative_ids`

调用流程：

1. 判断上下文策略：本地测试默认 `isolated`，生产默认 `persistent`。
2. 组装 system prompt：当前树、阶段目标、近期摘要、用户模式、命中率、时间。
   - `isolated`：不注入旧聊天历史、会话摘要、长期画像或推荐命中率，用于测试新 prompt/算法。
   - `persistent`：按正常产品逻辑注入上下文，用于长期陪伴和个性化推荐。
3. 选择模型。
4. 调用 LLM。
5. 剥离 markdown 包裹并解析 JSON。
6. 标准化字段名。
7. 校验 action 类型、真实 node id、枚举值。
8. 失败时把错误反馈给模型重试，最多 3 次。
9. 仍失败则返回安全降级结果，不改树。

这个流程保证 AI 可以做语言推理，但不能绕过结构化边界直接写库。

### 4.2.1 稳定思考协议

为减少模型输出随机性，Agent prompt 里不只写“应该怎么回答”，还要求模型按固定顺序完成内部判断：

1. 先判定本轮意图：机械操作、全局梳理、建树落地、推荐排序、权重确认或普通想法。
2. 从用户原文抽取输入保全清单，放入 `preserved_inputs`，不得先按目标筛掉内容。
3. 决定阶段目标使用方式：`background`、`priority_filter` 或 `ignored`。
4. 将保全清单映射为 `project/category/task/annotation/open_question`。
5. 做覆盖性自检：用户明确提到的非重复顶层项目，必须出现在当前树、`actions`、`draft_actions` 或 `proposed_panel_changes` 中。
6. 只合并同义或明显重复项，写入 `merged_duplicates`。
7. 多主线时只给权重草案，不直接写入权重。
8. 不确定时使用粗颗粒节点和 `open_questions`，不编造细节。
9. 最后检查 `reply`、`thinking`、`actions` 是否一致。

这套协议的目标是把“强模型自由发挥”改成“不同模型都先填同一套判断表”，从而降低模型能力差异带来的产品行为波动。

### 4.3 模型路由算法

入口：[`server/agent.js`](./server/agent.js)

`auto` 模式质量优先：

- 极短、非问句的测试或填充文本走快速模型。
- 长文本、批量描述、项目梳理走深度模型。
- 包含“梳理、整理、规划、策略、建议、优先、现金流、复盘”等质量词走深度模型。
- 明确命令式操作且不是问句时走快速模型。
- 其他不确定情况默认走深度模型。

本地算法会先于模型路由执行，所以最常见的机械操作不会进入 LLM。

### 4.4 权重协商与应用算法

入口：

- Prompt 规则：[`server/agent.js`](./server/agent.js)
- 应用逻辑：[`src/hooks/useChat.js`](./src/hooks/useChat.js)
- 前端卡片：[`src/components/Chat/ChatPanel.jsx`](./src/components/Chat/ChatPanel.jsx)

AI 输出：

```json
{
  "weight_strategy": {
    "mode": "energy_allocation",
    "scope": "top_level",
    "normalization_parent": "root",
    "conflict_note": "",
    "requires_clarification": false
  },
  "branch_weight_proposals": [
    {
      "name": "内容资产",
      "node_id": null,
      "parent_name": "root",
      "suggested_share": 0.4,
      "top_down_score": 0.8,
      "bottom_up_score": 0.45,
      "top_down_reason": "目标相关度高",
      "bottom_up_reason": "短期回报慢",
      "confidence": 0.6,
      "requires_confirmation": true
    }
  ]
}
```

应用步骤：

1. 用户点击“应用权重方案”。
2. 如果 `requires_clarification` 为 true 或存在冲突，先提示确认排序原则。
3. 用真实 `node_id` 或节点名解析目标节点。
4. 如果草案节点尚未创建，执行允许的 `draft_actions`；如果已存在则跳过，避免重复创建。
5. 按 `normalization_parent` 分组。
6. 每组内部把 `suggested_share` 归一化到 100%。
7. 调用 `updateWeight(node.id, normalizedWeight)` 写入 `nodes.weight`。
8. 前端按逐级累计流量刷新树枝线宽。
9. 当前消息标记为已应用，避免重复点击。

### 4.5 推荐闭环算法

入口：[`src/hooks/useChat.js`](./src/hooks/useChat.js)

当 AI 产生推荐并带有 `recommended_primary_id` 时，系统写入 `recommendation_log`。

当用户把推荐过的节点标记完成时：

- 查找最近 7 天内 `primary_node_id` 等于该节点且 outcome 为空的推荐记录。
- 更新为 `outcome = completed`。

运行时计算 dropped：

- 推荐超过 7 天未完成，视为 `dropped`。
- dropped 不一定立刻写库，但会进入命中率统计和 prompt context。

命中率字段：

- total
- completed
- dropped
- pending
- dropped_examples

AI 后续推荐时会看到这些反馈，从而逐步调整推荐策略。

### 4.6 记忆算法

入口：[`src/hooks/useChat.js`](./src/hooks/useChat.js)、[`server/summarizer.js`](./server/summarizer.js)

FocusTree 采用四层记忆：

1. 原始存档：`conversations`
2. 当前会话：最近消息，按 `session_id` 过滤
3. 会话摘要：`session_summaries`
4. 长期画像：`user_profile.learned_patterns`

会话切分：

- 距上一条消息超过 30 分钟时开启新 session。
- 旧 session 异步摘要。
- 近期 5 条摘要注入 prompt。

长期画像：

- AI 通过 `remember` action 写入。
- 只记录稳定事实，例如工作节奏、偏好、拖延模式、技能、资源。
- 用户可以在 UI 中查看和删除。

防污染原则：

- 对话历史里的旧状态不能覆盖当前树。
- “树已清空”等过时状态声明要被过滤。
- 当前树永远是唯一真实状态。

### 4.7 树渲染与拖拽算法

入口：[`src/components/Tree/TreeView.jsx`](./src/components/Tree/TreeView.jsx)

渲染：

- Supabase flat rows 先通过 `flatToTree` 转成树。
- D3 `hierarchy` + `tree` 计算布局。
- link 粗细由 `getLinkStrokeWidth(flow)` 决定；`flow` 是 root 到目标节点的累计精力流量。
- 节点颜色由 type 和 status 决定。

交互：

- pinch 缩放由 D3 zoom 处理。
- 二指滚动或鼠标滚轮用于平移。
- 单击选中节点。
- 双击折叠或展开节点。
- 右键打开菜单。
- 悬浮实心圆点时放大并显示加号，点击加号新增子节点。

拖拽：

- 拖拽起点只接受节点实心圆点或紧贴圆点的透明 handle。
- 使用 SVG 层原生事件代理，避免和 D3 click、dblclick、zoom 冲突。
- 超过 4px 阈值才确认拖拽。
- 拖拽时绘制预览曲线和节点数量徽章。
- drop 时先用 DOM 命中检测，再用树坐标距离兜底。
- 成功 drop 后调用 `moveNode(source.id, target.id)`。

### 4.8 树写入和撤销算法

入口：[`src/hooks/useTree.js`](./src/hooks/useTree.js)

所有写操作走统一 hook：

- addNode
- renameNode
- updateStatus
- deleteNode
- clearAll
- updateWeight
- moveNode
- annotateNode

撤销机制：

- 每个可撤销操作向 history stack 写入一条 `undoFn`。
- 最多保留 30 步。
- 删除子树前先 `collectSubtree`。
- 删除时按深度降序，先删叶子再删父节点。
- 撤销删除时按父先于子顺序插回。

移动分支：

- 先检查目标不是源节点的子孙。
- 乐观更新本地树，让 UI 立即响应。
- 后台写入 Supabase。
- 写入失败则回滚。

### 4.9 今日聚焦算法

入口：[`server/dailyFocus.js`](./server/dailyFocus.js)

输入：

- 当前树
- 当前阶段目标
- 当前时间
- 近期会话摘要
- learned patterns
- 推荐命中率

输出：

- 3 件今天要做的事
- 每件包含真实 node_id、任务名、精力时段、理由

强约束：

- 必须输出 3 件。
- 至少 2 件引用树中真实节点。
- 不推荐 done 或 dormant 任务。
- 根据时段错峰安排任务。

### 4.10 周回顾算法

入口：[`server/weeklyReview.js`](./server/weeklyReview.js)

输入：

- 本周完成任务
- 推荐命中情况
- dropped 推荐
- 停滞项目
- 新 learned patterns
- 关键决定和近期摘要

输出：

- opening
- wins
- patterns
- challenges
- proposals
- closing

产品要求是“反思性回顾”，不是流水账：需要指出模式、冲突和下周可操作建议。

### 4.11 成本与用时反馈

入口：[`server/llmClient.js`](./server/llmClient.js)、[`src/hooks/useChat.js`](./src/hooks/useChat.js)

每次 AI 回复会记录：

- `response_ms`
- `usage`
- `usage_cost`

成本估算按 provider 和模型分别计算输入、缓存输入、输出 token 的费用。前端用于展示回复用时和费用，方便调试模型质量与成本。

## 5. 数据模型摘要

核心表：

- `nodes`：项目树本体
- `node_annotations`：节点策略标签
- `conversations`：完整聊天存档
- `session_summaries`：会话摘要
- `recommendation_log`：推荐和 outcome 追踪
- `user_profile`：阶段目标和长期画像
- `daily_focus`：每日 3 件事
- `weekly_reviews`：周回顾

所有用户数据表均启用 RLS，以 `auth.uid() = user_id` 限制访问范围。

## 6. 当前产品边界

已经实现：

- 树形项目管理
- AI 对话协作
- 本地命令短路
- 阶段目标
- 四层记忆
- 推荐闭环
- 今日聚焦
- 周回顾
- 分支拖拽移动
- 权重方案草案与确认应用
- 回复用时和费用显示
- 自动备份、手动导出和恢复

V1 暂不做：

- 新增权重专用表
- 复杂任务依赖图
- 多用户共享项目
- 后台定时任务
- embedding 检索历史
- 完整移动端捕捉入口

## 7. 设计原则

1. 当前树是唯一真实状态。
2. 明确命令交给代码，模糊判断交给 AI。
3. AI 负责协商和解释，用户负责确认重要决策。
4. 权重是当前阶段精力配比，不是价值排序。
5. 推荐必须能追踪 outcome。
6. 长期记忆必须可见、可删、可纠错。
7. 破坏性操作尽量可撤销，并在必要时先备份。
8. 产品价值来自持续校准，而不是一次性生成完美计划。
