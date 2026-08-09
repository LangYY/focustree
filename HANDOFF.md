# HANDOFF

最后更新：2026-08-09。UI 重做基线已发布；本轮审计/测试/动效收尾改动保持未提交，等待用户验收。产品状态以本文件为准；历史决策写入 `MEMORY.md`。

## 当前状态

- 分支：`feature/priority-engine-v2`
- 已完成 FocusTree 全量 UI 重做：默认“林夜”深色主题，支持“晨纸”浅色主题和跟随系统；新增统一 token、基础样式、响应式壳层、左侧模式栏、可调宽右侧抽屉。
- 树视图保留原有 D3 交互（选择、双击展开、拖拽移动/排序、右键菜单、内联重命名、缩放、键盘快捷键），并新增三通道视觉：节点大小/辉光对应 `directPriority`，填充枝干宽度对应 `branchPriority`，年轮对应 `cultivationScore`；期限弧、紧急芽点、状态形状也已接入。
- 新增 Focus、List、Review 三种模式；Chat、Inbox、Detail、Audit 为右侧抽屉固定页签，记忆/推荐/历史/备份作为临时页签。
- 新增 Today 聚焦胶囊、可收起图例、画布缩放/适配/密度/图层控制、三分数详情与优先级审计；移动端抽屉改为覆盖式布局。
- Audit 已改为读取真实 `criticalPath`/传播边和 `cultivationBreakdown`，整树表格支持六列排序与行定位；不再展示截断子节点或固定百分比。
- 树画布补齐新增/删除/完成/重排/分数变化动效、`prefers-reduced-motion` 降级、SVG treeitem 键盘导航和 ARIA；全局新增 `?` 快捷键说明浮层。
- 晨纸主题使用 `--ft-text-primary` 暗晕与提高对比度的年轮；`src/` CSS 中除 base reduced-motion 规则外不再有 `!important`。
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

- `npm test`：19/19 通过。
- `npm run lint`：0 errors；5 个既有 React Hook exhaustive-deps warnings，集中在 `useChat.js`/`useWeeklyReview.js`。
- `npm run build`：通过。Vite 提示 `runtime-config.js` 缺少 `type="module"`，并提示主 chunk 大于 500 kB；均为已有构建提示，不影响产物生成。
- 浏览器冒烟已验证 `http://127.0.0.1:5173/` 能启动并进入配置提示页；当前 `.env` 的 Supabase/AI 值为空，无法在本地会话中验证登录后的真实树数据。

## 线上部署

- GitHub：`https://github.com/LangYY/focustree`，分支 `feature/priority-engine-v2`，发布 commit `31c708f`。
- ECS：`8.153.96.57`，systemd (`focustree.service`) + Nginx，目录 `/opt/focustree`，Node v22，Nginx 把 `focus.buzzegg.cn` 转发到 `127.0.0.1:3001`。**不是 Docker**——`deploy/ecs/` 里的 Docker Compose + Caddy 方案没有在用。
- 线上 `.env` 未被覆盖，旧版本已保留在远程回滚备份中。
- 发布后的公网健康检查通过，AI 与数据库集成状态正常。

### 构建必须在本机进行

ECS 是 2 核 / 1.6 GB，除 FocusTree 外还跑着 MariaDB 和另外 5 个 Node 应用，空闲内存不到 900 MB。`npm run build` 峰值几百 MB 到 1 GB，在这台机器上跑有把其他服务一起 OOM 掉的风险。

部署走 `scripts/deploy-ecs.sh`：本机构建 → 上传 `dist.new/` → 原子切换 → 校验 `/health` → 失败保留 `dist.old/` 回滚。前端更新零停机（`express.static` 每次请求读盘），只有 `server/` 变更才需要 `--full` 重启。服务器装依赖用 `npm ci --omit=dev`。

FocusTree 自身稳态占用：RSS 约 77 MB、CPU ~0%、磁盘 228 MB（其中 `node_modules` 225 MB），零后台定时任务。

## 后续

1. 用户验收本轮未提交改动；验收通过后再决定是否部署。
2. 配置本地 Supabase 与 AI 环境变量后，用真实账号验证登录、树数据、Inbox 应用和主题切换。
3. 如需继续优化性能，再对主 chunk 做拆包；不改变当前交互和数据协议。
## 2026-08-09 — UI redesign follow-up (uncommitted)

- Completed the four requested UI follow-up tasks: semantic color migration and legacy stylesheet removal, dead component cleanup with Audit analysis actions, reusable UI primitives, and the Inbox proposal workflow.
- Inbox now owns proposal interaction, including draft/goal/priority cards, per-card processing, seven-day processed history, chat deep-link highlighting, debounced priority previews, and shared preview/apply logic.
- Verification after the follow-up: `npm test` 14/14 passed; `npm run lint` 0 errors with 5 existing exhaustive-deps warnings; `npm run build` passed. No commit was created.
