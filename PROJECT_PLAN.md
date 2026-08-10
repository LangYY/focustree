# 专注树 FocusTree · 项目进度与规划

> 一个为自由职业者 / 内容创作者打造的「外脑 + 个人助理 + 成长地图」
>
> 最后更新：2026-05-11

---

## 0. 一句话定位

帮一个**多线程的个体工作者**回答三个问题：
1. **我现在该做什么？**（在多个项目、多种身份间不迷失方向）
2. **我做完了什么？**（让进展被看见、被沉淀）
3. **我想到了什么？**（灵感不丢，自动归位到合适的项目枝）

形态：左边 D3 树形可视化，右边 AI 对话面板。

---

## 1. 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 18 + Vite + Tailwind v4 (`@tailwindcss/vite` 插件) |
| 可视化 | D3.js v7（水平树布局 + zoom/pan） |
| 后端代理 | Express.js（仅作为 LLM 代理，保护 API key） |
| 数据库 | Supabase（Auth + PostgreSQL + RLS） |
| 模型 | DeepSeek API：`deepseek-v4-flash`（快速）/ `deepseek-v4-pro`（深度推理） |
| 摘要 | DeepSeek V4-flash（独立调用，便宜） |
| Dev | `npm run dev` 同时跑 vite + node server（concurrently） |

环境变量（`.env`）：
```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=...                  # publishable key（前端用，受 RLS 约束）
DEEPSEEK_API_KEY=sk-...
SUPABASE_URL=...                             # 服务端摘要器用
SUPABASE_SERVICE_ROLE_KEY=...                # 服务端摘要器用（bypass RLS）
```

---

## 2. 仓库结构

```
focustree/
├── src/
│   ├── App.jsx                  顶层布局 + state 编排
│   ├── components/
│   │   ├── Auth/                登录页
│   │   ├── Toolbar/             顶部工具栏（含 undo + 操作历史）
│   │   ├── Tree/                TreeView (D3) + LeafView + NodeTooltip
│   │   ├── Chat/                ChatPanel + ChatHistoryPanel + LearnedPatternsPanel
│   │   └── Modals/              AddNodeModal
│   ├── hooks/
│   │   ├── useTree.js           树 CRUD + history stack + 加载 annotations
│   │   ├── useChat.js           对话 + session + 记忆抽取 + 历史清洗
│   │   └── useUserProfile.js    阶段目标 + learned_patterns 读写
│   └── lib/
│       ├── supabase.js          Supabase client
│       └── treeUtils.js         flatToTree / treeToPromptText / 排序辅助
│
├── server/
│   ├── index.js                 Express 路由（/api/agent, /api/summarize-session）
│   ├── agent.js                 LLM prompt + 重试 + 校验 + 路由
│   └── summarizer.js            独立摘要器
│
├── sql/                         所有迁移按编号执行
│   ├── 001_user_profile.sql
│   ├── 002_annotations_and_log.sql
│   └── 003_sessions_and_memory.sql
│
└── PROJECT_PLAN.md              本文档
```

---

## 3. 数据模型

### 3.1 nodes
项目树本体。自引用结构（parent_id 指向同表）。

| 列 | 类型 | 说明 |
|---|---|---|
| id | uuid | |
| user_id | uuid | 关联 auth.users |
| parent_id | uuid? | 自引用 |
| name | text | |
| type | text | `project` / `category` / `task` |
| status | text | `active` / `done` / `dormant` |
| color | text? | 仅 project |
| weight | real | 0-1，控制连线粗细 |
| position | **bigint** | 排序键，毫秒时间戳（曾因 int 溢出踩坑） |
| expanded | bool | 是否展开（仅前端用） |
| last_active_at | timestamptz | |
| completed_at | timestamptz? | |

### 3.2 node_annotations
每个节点的策略向量。一对一，主键即 node_id。

```sql
roi_type      jsonb    -- { "现金": 0.8, "经验": 0.1, ... }
time_horizon  text     -- 立即/短期/中期/长期（check 约束）
energy_cost   text     -- 高专注/中等/机械
feasibility   real     -- 0-1
risk          text     -- 确定性/投机性
strategic_tag text     -- 现金流/资产积累/信号建立/维持性/探索
ai_notes      text     -- AI 解释为什么这样标
```

### 3.3 conversations
聊天历史完整存档。

```sql
id, user_id, role, content, created_at
session_id uuid    -- 第三阶段加入，30 分钟 gap 切分
```

### 3.4 session_summaries
会话摘要（自动生成）。

```sql
summary       text          -- 1-2 句
key_decisions jsonb         -- 字符串数组
topics        jsonb         -- 字符串数组
message_count int
started_at, ended_at, created_at
```

### 3.5 recommendation_log
每次推荐的推理链快照（可追溯）。

```sql
message text
goal_snapshot   jsonb
thinking        jsonb        -- agent 的 7 字段推理
reply           text
primary_node_id uuid?
feedback        text?        -- accepted / rejected / modified （未实装）
outcome         text?        -- completed / dropped       （未实装）
outcome_at      timestamptz?
```

### 3.6 user_profile
用户长期画像。

```sql
user_id uuid primary key
current_goal     jsonb   -- { text, set_at, expires_at, constraints, exclude }
personality      jsonb   -- 未启用，预留
learned_patterns jsonb   -- AI 抽取的事实列表
```

learned_patterns 单条结构：
```json
{
  "observation": "用户讨厌打卡式工作",
  "confidence": 0.9,
  "topic": "preference",
  "created_at": "...",
  "source_session": "..."
}
```

所有表均启用 RLS：`auth.uid() = user_id` 限制每个用户只能访问自己的数据。

---

## 4. Agent 架构

### 4.1 模型路由（auto 模式）

**反向白名单**：默认走 V4-pro，只有满足全部三条才降级 V4-flash：
1. 含明确操作动词（添加 / 删除 / 标记 / 暂停 / 清空 …）
2. 不含推理词（建议 / 为什么 / 该不该 / 哪个 …）
3. 不是问句（无 `?` / `？`）

90% 日常操作走便宜模型；推理类问题用大模型。错字 / 句式变化也能正确路由。

### 4.2 System Prompt 结构（按位置由顶到底）

```
[身份] Focus Agent + 成长教练
[🔒 状态来源优先级]               ← 最高权威规则，反幻觉的关键
[## 用户当前阶段目标]              ← 强 anchor
[## 近期会话回顾]                  ← 最多 5 条 session 摘要
[## 已学到的用户模式]              ← 置信度 ≥ 0.5 的最近 15 条
[## 当前项目树]                    ← 当下真实状态，唯一权威
[## 输出 Schema]                   ← 包含 7 字段 thinking
[## Action 类型清单]               ← 11 种
[## annotations 字段定义]
[## 推荐类问题的深度规则]           ← 深度四要素
[## remember 使用规则]
[## 反幻觉硬规则]
[## Few-shot 示例（8 条）]
```

### 4.3 重试循环（最多 3 次）

```js
for attempt in 1..3 {
  raw = callLLM(prompt, messages, model)
  parsed = safeParseJSON(raw)              // 剥 ```json``` 包裹
  if (!parsed) { passErrorBack; continue }
  normalized = normalizeOutput(parsed)      // id/parent 字段名变体统一
  validated = validateOutput(normalized)    // schema + node id 合法性 + 枚举
  if (!validated) { passErrorBack; continue }
  return normalized
}
return safeFallback                         // "抱歉，能换个说法..."
```

错误反馈作为新 user 消息追加：
> ⚠️ 你上次输出不符合：actions[1].parent "X" 不存在于当前树。请重新生成。

### 4.4 Thinking 输出（7 字段，推荐类问题强制）

| 字段 | 干什么 |
|---|---|
| user_goal | 复述目标，建立对齐感 |
| tradeoff_analysis | 对比 ≥2 个候选，「为什么不是 B」 |
| traps_avoided | 1-3 个具体陷阱（不是套话） |
| leverage_insight | 用户没想到的角度 |
| next_concrete_step | 30 分钟内能动手的具体动作 |
| success_criterion | 完成的可验证标准 |
| risk_if_skipped | 不做的具体代价 |

字段本身就是对模型思考深度的强制约束——写不出 tradeoff_analysis 说明没认真比较候选。

### 4.5 Action 类型

| type | 字段 | 干什么 |
|---|---|---|
| mark_done / mark_active / mark_dormant | id, name | 改状态 |
| add_task / add_category / add_project | name, parent?, color?, annotations? | 建节点 |
| rename | id, name | 改名 |
| delete | id, name | 删（级联） |
| clear_all | – | 清空全部 |
| annotate | id, annotations | 改策略标签 |
| remember | observation, confidence, topic | 写入 learned_patterns |

---

## 5. 记忆架构（四层）

```
Layer 4 · 长期画像  user_profile.learned_patterns       → 每次注入 prompt
Layer 3 · 会话摘要  session_summaries（自动生成）        → 最近 5 条注入
Layer 2 · 当前会话  内存 messages，按 session_id 过滤    → 配对清洗后注入
Layer 1 · 原始存档  conversations 全表                   → UI 可查，不喂 AI
```

**关键设计**：UI 显示（Layer 1 全量）和 AI 看到的（2 + 3 + 4 过滤后子集）是两套数据流。

### Session 切分

距上次消息 > 30 分钟自动开新 session。开新时对旧 session fire-and-forget 触发摘要（< 4 条消息不摘要）。

### 历史清洗（防 AI 自我污染）

配对过滤：
- assistant 提到「已清空 / 是一张白纸」等过时状态 → **连同前面的 user 一起丢**（孤立保留 user 会让 AI 误读为当下指令）
- assistant 全是装饰行（✅/🎯/⚠️） → 同样配对删
- 最后留最近 3 轮（6 条）

客户端 + 服务端各做一次（defense in depth）。

---

## 6. 已完成阶段（Phase 1-4）

### Phase 1：阶段目标 + 对齐推荐

- 表 `user_profile` + `current_goal` jsonb 字段
- `/目标 xxx` slash command 或聊天面板顶部点击设置
- 90 天默认有效期，过期 AI 主动提醒
- 推荐时必须标 🎯 对齐目标 ✓ 或 ⚠️ 偏离目标：原因

### Phase 2：节点策略标签 + 反向思考

- 表 `node_annotations`（ROI / 时间 / 能量 / 风险 / 战略标签）
- AI 创建节点时自动打标
- 表 `recommendation_log`：每次推荐的完整 thinking 落库
- prompt 加入「陷阱审查」硬规则
- ChatPanel 增加可折叠的「为什么这样推荐」卡片

### Phase 3：模型选择 + 抗污染对话

- 三档模型选择：自动 / 快速 V4-flash / 深度 V4-pro
- 反向白名单路由（不依赖关键词正则）
- 历史污染问题修复：
  - 「树已清空」等过时声明从未来上下文中剔除
  - 配对过滤防止孤立 user 误导
  - prompt 顶部加 🔒 状态来源优先级硬规则
- 「↻ 新对话」按钮 / `/重置` 命令

### Phase 4：四层记忆系统

- conversations 加 session_id，按 30min gap 自动切分
- 表 `session_summaries`，独立摘要器 `/api/summarize-session`
- `remember` action 类型 + `user_profile.learned_patterns` 抽取
- prompt 注入近期摘要 + 高置信度 learned_patterns
- ChatHistoryPanel UI：按 session 浏览全历史，单段删除
- LearnedPatternsPanel UI：查看 AI 学到的事实，可删除纠错

### Phase 4.5：Agent 深度打磨

- 7 字段 thinking schema（从 3 字段扩展）
- 模型路由更稳健（反向白名单 + 错字容忍）
- V4-pro max_tokens 提到 4500（避免推理链吃光 token 后内容为空）
- 8 条更深度的 few-shot 示例
- ThinkingCard UI 重做，7 个字段都有专属样式

---

## 7. 重要的 Lessons Learned

### 7.1 PostgreSQL `position` int 溢出
`Date.now()` 是 13 位毫秒戳，超过 int32 上限。改 `bigint`。**只要排序键基于时间戳，一律 bigint**。

### 7.2 supabase-js insert 错误不抛异常
所有 `.insert(...)` 调用都要解构 `{ data, error }` 并显式处理 error，否则会静默失败用户看不到任何报错。

### 7.3 PostgREST schema cache 不自动刷新
跑完 SQL 后 PostgREST 可能还查不到新表（"Could not find the table in the schema cache"）。每个 DDL 迁移末尾加 `notify pgrst, 'reload schema';`。

### 7.4 Few-shot 容易过拟合
示例中目标文本和用户真实目标几乎一字不差时，模型直接复读 few-shot 的回答。修复：让示例文本和用户场景**有距离**，加反幻觉硬规则。

### 7.5 配对清洗 vs 单边清洗
只删 assistant 留下孤立 user，模型会把 "清除面板" 等旧指令当作当下命令。必须配对删除。

### 7.6 DeepSeek 模型别名混乱
`deepseek-chat` / `deepseek-reasoner` 都路由到 `deepseek-v4-flash`。真正的大模型要显式用 `deepseek-v4-pro`。

### 7.7 V4-pro 推理 token 消耗
V4-pro 的 reasoning_content 占用 max_tokens 预算，推理深度高时 2500 不够。设到 4500 才稳定。

### 7.8 Supabase REST 自引用 FK 删除
PostgREST DELETE 父行时即使有 CASCADE 也可能因 FK 约束失败。**删除前必须按深度降序排（先删叶子）**，见 `sortByDepthDesc`。

---

## 8. 下一步：Phase 5（推荐起点）

### 5.1 Outcome 闭环 + recommendation_log UI（3 天）

**目标**：让 AI 推荐有"对账"机制，建立信任。

- 推荐过的 task 被完成时，回填 `recommendation_log.outcome = 'completed'`
- 7 天未完成 → `outcome = 'dropped'`，AI 收到弱信号
- UI：「Focus Agent」面板加「推荐记录」入口，列出最近推荐及结果
- 命中率显示：「AI 本月推荐了 12 件事，完成 8 件」
- prompt 注入历史命中率，让 AI 自我修正

**为什么先做这个**：表已有，数据已有，工程量小，价值立竿见影。

### 5.2 Today 视图 + 时间感知（4 天）

**目标**：解决最高频的 job-to-be-done。

- 顶部置顶「今天 3 件事」卡片
- 早晨打开 app 时，AI 自动生成（基于树 + 目标 + learned 精力模式 + 时间）
- 每件事标精力档位（早 / 中 / 晚 / 任意）
- 用户可改 / 拒绝 / 替换
- prompt 注入 `current_time = "周一 上午 10:23"`
- 当前时间会影响推荐内容（早上 → 高专注任务）

### 5.3 主动周末 Review（3 天）

**目标**：从被动响应跃迁到主动陪伴。

- 周日晚（或周一早）AI 主动发起对话：「我看到这周你...」
- 内容：完成情况 + 拖延模式 + 决策回顾 + 邀请调整目标
- 用户可接受 / 跳过
- 本次 review 作为下周 prompt context

**实现**：客户端定时检测（用户上线时判断"上次 review > 7 天"则触发），不需要后台 cron。

---

## 9. 测试完成后 Todo

- 重新评估 `FOCUSTREE_CONTEXT_POLICY` 的默认值：测试阶段保持 `isolated`，测试结束后切回对用户最优的上下文策略。
- 设计长期上下文注入规则：恢复必要的会话摘要、长期画像、推荐命中率，但继续过滤旧版错误口径和过时状态。
- 在切回 `persistent` 前做一轮对照测试：同一组长输入分别在隔离上下文和长期上下文下运行，确认长期记忆提升质量而不是污染意图。
- 给用户一个可见开关或调试标识：区分“测试隔离模式”和“长期陪伴模式”，避免测试时误判模型行为。

---

## 10. Backlog（Phase 6+）

### Phase 6：捕捉与移动端
- PWA 适配（手机能用）
- 浏览器扩展：选中网页文字 → 一键加到树
- iOS 快捷指令：语音输入 → 自动归类到合适项目
- 「快速 inbox」缓冲池，AI 稍后归位

### Phase 7：成长报告
- 月度自动 review 报告（完成 / 放弃 / 学到的模式）
- 季度复盘可视化（项目存活率、目标达成率）
- 可分享 / 导出（PDF / Markdown）

### Phase 8：精细化
- annotations 编辑器（右键节点看 / 改 AI 打的标签）
- 漂移检测（14+ 天未动的任务主动提议归档）
- 任务依赖关系（A 必须 B 之后做）
- 模板系统（"开新视频项目" → 自动生成 5 个标准子任务）
- 多目标层级（年 / 季 / 月嵌套）
- 时间预算约束（"今天 2 小时" → AI 据此筛选）

### Phase 9：智能强化
- learned_patterns 置信度随时间衰减
- 用户主动「忘记 X」语义命令
- Embedding 检索相似历史会话
- AI 对自身 thinking 的事后复盘（meta-cognitive）

### Phase 10：信任与导出
- 全量 Markdown / JSON 导出
- 操作审计日志（所有 AI 写库都可查可回滚）
- 隐私模式（本地优先选项）
- 多用户共享项目（远期）

---

## 11. 设计原则

1. **结构化沉淀 > 上下文堆砌**
   LLM 是推理引擎，不是记忆系统。把所有可计算、可结构化的东西放在代码 / 数据库，LLM 只看精心策划的子集。

2. **状态来源单一权威**
   当前项目树是唯一真实状态。对话历史里的状态声明全部视为过时。

3. **LLM 做判断，代码做记录**
   - LLM 强：语言推理、对比、解释
   - 代码强：评分、ID 校验、状态机
   - 各司其职

4. **决策可追溯**
   每次推荐落库 `recommendation_log`，用户和 AI 都能复盘"为什么当时推荐了这个"。

5. **Defense in depth**
   关键过滤（历史清洗、ID 合法性、装饰行剥离）客户端 + 服务端各做一次。

6. **画像生长而非问卷**
   不靠 onboarding 填表，靠日常对话沉淀。用户能看、能改、能删 AI 学到的事实。

7. **可逆 > 不可逆**
   所有破坏性操作（删除、清空）默认可撤销，全局 history stack 最多 30 步。

8. **慢就是快**
   不追求一次推荐完美，追求长期校准。AI 在 outcome 闭环 + learned_patterns 双重信号下慢慢"懂用户"。

---

## 12. 给第三方协作模型的提示

如果你是另一个 AI 模型在协助开发这个项目，以下信息能让你快速上手：

### 起手要读的文件（按顺序）
1. `PROJECT_PLAN.md`（本文档）
2. `server/agent.js`（核心 prompt + 重试逻辑）
3. `src/hooks/useChat.js`（对话生命周期）
4. `src/hooks/useTree.js`（树 CRUD）
5. `sql/*.sql`（数据模型）

### 协作约定

- **改 prompt 前必读**：`server/agent.js` 顶部的 `buildSystemPrompt`。改任何规则要考虑会不会和已有规则冲突。
- **改 schema 前必读**：现有的 7 字段 thinking 是有意设计的，对应「深度四要素」。新增字段要说明必要性。
- **改 action 类型**：必须同步更新 (1) `VALID_TYPES` (2) `validateOutput` 的 needsId/needsName/needsParent 列表 (3) `executeAction` switch (4) 至少一条 few-shot。
- **改路由逻辑**：测试矩阵至少 5 句不同句式（带错字 / 带问号 / 命令式 / 推理式 / 混合），见 `resolveModel`。
- **改记忆相关**：弄清楚动了 Layer 1-4 中的哪一层，避免污染上下文。

### 已知技术债

- `LeafView` 进度条按 weight 显示，但 weight 现在没 UI 入口编辑（除了 AI 的 annotate action）
- `Toolbar` 里的 HistoryPanel 是操作 undo 历史，和 `ChatHistoryPanel` 同名容易混淆
- recommendation_log 的 outcome 字段定义了但还没写入逻辑（Phase 5.1 待做）
- session_summaries 的 topics / key_decisions 已存但还没在 UI 展示

### 测试入口

- Supabase Management API token（开发者本地）：可以直接跑 SQL 验证 schema
- `/api/agent` 端点：直接 POST 测试 prompt 行为
- 浏览器 Console：所有关键操作（setGoal / addNode / 历史加载）都有 `[hookName]` 前缀日志

### 当前最高优先级

**Phase 5.1**：Outcome 闭环。详见 §8。

---

*文档随项目演进同步更新。Notion 副本：https://www.notion.so/35d10ba00417816ea936e663f0e66e3c*
