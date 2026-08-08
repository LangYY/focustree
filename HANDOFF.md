# HANDOFF

最后更新：2026-08-08。当前 UI 重做已完成，产品状态以本文件为准；历史决策写入 `MEMORY.md`。

## 当前状态

- 分支：`feature/priority-engine-v2`
- 已完成 FocusTree 全量 UI 重做：默认“林夜”深色主题，支持“晨纸”浅色主题和跟随系统；新增统一 token、基础样式、响应式壳层、左侧模式栏、可调宽右侧抽屉。
- 树视图保留原有 D3 交互（选择、双击展开、拖拽移动/排序、右键菜单、内联重命名、缩放、键盘快捷键），并新增三通道视觉：节点大小/辉光对应 `directPriority`，填充枝干宽度对应 `branchPriority`，年轮对应 `cultivationScore`；期限弧、紧急芽点、状态形状也已接入。
- 新增 Focus、List、Review 三种模式；Chat、Inbox、Detail、Audit 为右侧抽屉固定页签，记忆/推荐/历史/备份作为临时页签。
- 新增 Today 聚焦胶囊、可收起图例、画布缩放/适配/密度/图层控制、三分数详情与优先级审计；移动端抽屉改为覆盖式布局。
- 未修改 `server/`、优先级算法、分析协议、数据库及既有 hook 外部签名。旧组件仍保留必要的数据行为，但新 App 路径不再依赖旧 Toolbar/LeafView 页面。

## 关键文件

- `DESIGN.md`：UI 重做唯一设计规格。
- `src/styles/tokens.css`、`src/styles/base.css`：暗/亮主题 token、字体、动效、可访问焦点态。
- `src/components/Shell/`：TopBar、LeftRail、Drawer、AppShell。
- `src/components/Tree/CanvasStage.jsx`、`TreeView.jsx`、`render/`：树画布与纯视觉计算。
- `src/components/Views/`：Focus/List/Review 页面。
- `src/components/Drawer/`：Inbox/Audit/Utility 页面。
- `src/lib/branchPalette.js`：项目枝干色板和明暗主题分支色计算。

## 验证

- `npm test`：13/13 通过。
- `npm run lint`：0 errors；5 个既有 React Hook exhaustive-deps warnings，集中在 `useChat.js`/`useWeeklyReview.js`。
- `npm run build`：通过。Vite 提示 `runtime-config.js` 缺少 `type="module"`，并提示主 chunk 大于 500 kB；均为已有构建提示，不影响产物生成。
- 本地开发服务器已验证：`http://127.0.0.1:5173/`。当前 `.env` 的 Supabase/AI 值为空，浏览器只能进入配置提示页，无法在本地会话中验证登录后的真实树数据。

## 后续

1. 配置本地 Supabase 与 AI 环境变量后，用真实账号验证登录、树数据、Inbox 应用和主题切换。
2. 如需继续优化性能，再对 652 kB 主 chunk 做拆包；不改变当前交互和数据协议。
