# HANDOFF

当前项目状态的唯一事实来源。信息过时就直接替换，不要堆积历史（历史进 `MEMORY.md`）。

最后更新：2026-08-10。

## 当前分支

`feature/priority-engine-v2`。UI 重做的两条并行轨道已合并，**尚未部署**。

## 架构现状

### 优先级引擎 V2

核心机制，已取代早期的「权重协商」体系（`set_weight` / `branch_weight_proposals` / `weight_strategy` 已全部移除，不要再引入）。

- 模型侧（`server/agent.js`）只输出**语义分析**：`goal_analysis` 与 `node_priority_proposals`（`goal_alignment` / `necessity` / `delay_cost` / `relation_type`）。模型不算最终分数。
- 本地侧（`src/lib/priorityEngine.js`）用确定性算法算出 `directPriority` / `branchPriority` / `cultivationScore`。
- 预览与应用共用 `src/lib/priorityProposals.js`，`test/priorityProposal.test.js` 用「持久化→重建树」的往返测试守住两者一致。

### 界面：对话主导

2026-08-10 完成信息架构重构，起因是作者本人说不清右侧四个 tab 分别是什么。

- **右侧只有 Focus Agent 对话**，无 tab。左导轨只保留四个视图（结构 / 聚焦 / 看板 / 回顾）和一个对话开合。
- **提案内联在对话流**（`src/components/Chat/ProposalCards.jsx`）：三类提案长在产生它的那条 AI 消息下面，滑块、分数实时预览、批量采纳、已处理折叠全部保留。
- **节点编辑是画布上的浮动检视卡**（`src/components/Tree/NodeInspector.jsx`）：单击节点就地弹出，新建节点后自动打开并聚焦标题。审计收在它底部的「为什么是这个分数」折叠区。
- 账户菜单里的工具（记忆 / 推荐 / 历史 / 备份 / 整树审计）是居中模态。

### 树画布

三个分数走三个互不干扰的视觉通道，**不可合并**：节点大小与辉光 = `directPriority`，锥形枝干宽度 = `branchPriority`，年轮 = `cultivationScore`。叠加期限弧、紧急芽尖、状态形状。

标签：`project`/`category` 用 16px 衬线，`task` 用 12.5px 无衬线；两行截断、描边 2px、同层垂直避让。节点上不再显示数字分数（移到检视卡）。

`TreeView.jsx` 的交互层（拖拽、命中检测、D3 zoom 协同、右键菜单）是既有资产，只换渲染层，不重写。`test/treeViewEvents.test.js` 守着 `mouseleave` 必须先于 `.transition()` 绑定这条契约。

### 模型

前端没有模型选择。服务端固定 `deepseek-v4-flash` + `reasoning_effort=max` + `max_tokens=16000`。

`reasoning_content` 计入 `max_tokens`，推理强度高时容易把预算吃光导致 `content` 为空、`finish_reason=length`——这是线上出现过的真实故障，16000 的预算就是为它留的。`resolveAttemptModel()` 里「空内容/解析失败升级到 pro 重试」的兜底保留，它不是用户可见的档位。

**已实测确认**（2026-08-10，对 `deepseek-v4-flash` 打真实请求）：
- `reasoning_effort` 合法枚举：`none` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`
- `reasoning_effort=max` 与 `temperature=0.3` **可以同时传**，返回 200

## 验证方式

- `npm test` — 合并后全绿
- `npm run build`、`npm run lint`（0 error；5 个既有 exhaustive-deps warning 在 `useChat.js` / `useWeeklyReview.js`）

## 已知问题

1. **周回顾 emoji 没修在根上。** `src/hooks/useWeeklyReview.js` 的 `serializeReview()` 仍在生成 📌🔍❓💡 并写入数据库，只是在 `src/components/Views/reviewFormat.js` 渲染时被正则擦掉。对话注入路径（`injectReviewMessage`）不经过那个清洗函数，**所以对话里的周回顾仍然带 emoji**。要在 `serializeReview()` 里修。
2. **`temperature` 被移除了。** 原本 `0.3` 用于稳定 JSON 输出，因当时无法实测而暂不发送。现已确认可以同时传，应恢复。
3. 线上 `/readiness` 曾返回 503，唯一失败项是 `node_annotations` 表检查（message 为空）。需人工核对 Supabase 中该表与 service role 查询权限；建表脚本是 `sql/002_annotations_and_log.sql`。
4. 主 chunk 约 670 kB 单文件，未做代码分割。首屏依赖它全部下载解析。
5. `deploy/ecs/` 里的 Docker Compose + Caddy 方案**没有在用**，线上是 systemd + Nginx。已在该目录 README 顶部标注。

## 线上部署

- GitHub：`https://github.com/LangYY/focustree`
- ECS `8.153.96.57`：systemd（`focustree.service`）+ Nginx，目录 `/opt/focustree`，Node v22，`focus.buzzegg.cn` → `127.0.0.1:3001`

### 构建必须在本机进行

ECS 是 2 核 / 1.6 GB，除 FocusTree 外还跑着 MariaDB 和另外 5 个 Node 应用，空闲内存不到 900 MB。`npm run build` 峰值几百 MB 到 1 GB，在这台机器上跑有把其他服务一起 OOM 掉的风险。

用 `scripts/deploy-ecs.sh`：本机构建 → 上传 `dist.new/` → 原子切换 → 合并上一版 `assets`（防止旧 hash 断链）→ 校验 `/health` → 失败保留 `dist.old/` 回滚。前端更新零停机；只有 `server/` 变更才需要 `--full`。服务器装依赖用 `npm ci --omit=dev`。

FocusTree 稳态占用：RSS 约 77 MB、CPU ~0%、磁盘 228 MB（`node_modules` 占 225 MB），零后台定时任务。

## 下一步

1. **新手引导**——作者列为最高优先级，此前因依赖信息架构落地而推迟，现在可以做了。
2. 修上面「已知问题」的 1 和 2。
3. 验收通过后部署。
