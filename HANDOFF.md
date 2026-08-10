# HANDOFF

## 当前状态

- 分支：`feature/priority-engine-v2`，基线 `fecc9cc`。
- 本轮八项架构任务已实现，代码仍未提交，也未部署，等待用户验收。
- `DESIGN.md` 已在实现前同步为单一对话抽屉、消息内联提案、画布浮动 `NodeInspector`、折叠审计区和居中整树审计模态。

## 已实现

- 右侧 `Drawer` 只承载 `Focus Agent` 对话流，保留拖拽宽度、双击复位和收起；左导轨保留四个主视图，第二组只保留 `C` 对话开关；账户工具改为居中 `UtilityModal`，整树审计进入 `PriorityAuditModal`。
- 三类提案由 `Chat/ProposalCards.jsx` 统一渲染在产生它的 assistant 消息下方：草案、目标、优先级信号均支持单条/批量采纳或否决；优先级滑块步长 0.05、关系分段、置信度只读、120ms 预览防抖，已处理状态保留在原位置。
- `Tree/NodeInspector.jsx` 取代旧详情页：节点锚定浮卡支持翻转/边界夹紧、平移缩放跟随、面包屑跳转、新节点聚焦标题、1200ms 自动保存、Esc 还原和 Ctrl/Cmd+S；审计解释默认折叠并保留真实分解字段与两类分析入口。
- `Focus Agent` 名称已同步到用户界面、客户端欢迎语、服务端 system prompt 和旧客户端 prompt；移除模型选择器与 `ft_model` 状态。服务端请求固定 `deepseek-v4-flash`、`reasoning_effort: max`、`max_tokens: 16000`，空内容/解析错误仍可内部升级 `deepseek-v4-pro`。
- 已删除旧 `InboxTab`、`AuditTab`、`NodeDetailPanel`、`UtilityTab`；`TreeView.jsx`、`Tree/render/`、认证路径、Views 及算法/数据库路径未改。
- `memory/` 两份 RCA 已合并到根 `MEMORY.md`，临时目录已删除。

## 约束与未决事项

- 未进行 git commit、部署或外部环境变更。
- 本机没有配置 `DEEPSEEK_API_KEY`（`.env` 中为空），因此无法执行真实 Flash + `reasoning_effort=max` 的温度兼容性请求；请求体已移除未经实测的 `temperature` 字段，避免把未验证参数带入生产请求。模型名与 reasoning max 不重复实测。
- `npm run lint` 仍报告 5 个既有 React Hook exhaustive-deps warnings，当前无 lint error。

## 关键文件

- `DESIGN.md`：当前 UI/交互唯一设计规格。
- `src/components/Shell/`：单一对话抽屉与左导轨。
- `src/components/Chat/ChatPanel.jsx`、`ProposalCards.jsx`、`src/lib/chatProposals.js`：对话流与提案状态。
- `src/components/Tree/NodeInspector.jsx`：浮动节点编辑与折叠审计。
- `src/components/Modals/UtilityModal.jsx`、`PriorityAuditModal.jsx`：账户工具与整树审计。
- `server/agent.js`、`test/agentModel.test.js`：Focus Agent 模型契约。

## 最终验证

- `npm test`：29/29 通过；输出包含现有未配置环境提示 `DEEPSEEK_API_KEY not set`、Supabase summarizer disabled，但没有失败用例。
- `npm run build`：通过；Vite 仍提示 `runtime-config.js` 缺少 `type="module"`，并提示主 chunk 大于 500 kB。
- `npm run lint`：0 errors，5 个 React Hook exhaustive-deps warnings（`useChat.js` 4 个、`useWeeklyReview.js` 1 个）。
- `test/priorityProposal.test.js`：6/6 通过（仓库当前实际为 6 个用例）。模型契约与提案状态专项测试：5/5 通过。
- `git diff --check`：通过；未触碰并行会话负责的 Auth、authSession、TreeView、Tree/render、Views 路径。

## 验收后续

1. 在配置真实 Supabase/DeepSeek 的环境中进行登录、树节点编辑、对话提案与浮卡交互验收。
2. 通过验收后再由用户决定是否提交或部署。
