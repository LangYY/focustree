# HANDOFF

## 当前任务收口（2026-08-10）

- A/C/D 三条卫星轨道已在本工作树完成，未提交、未部署，等待用户验收。
- A：认证页保留注册/密码登录，新增已实测为 magic link 的免密码入口、60 秒重发冷却和人话错误；演示入口采用“注册只需邮箱、约 30 秒”的方案二。
- C：树标签改为项目/分类 16px 衬线、任务 12.5px 无衬线；两行最多 11 字、描边 2px、同层垂直贪心避让、done 删除线；数字分数标签与对应图层开关已移除，三条视觉通道保留。
- D：清单已改为按顶层项目分列的 300px 横向看板；回顾改为 680px 慢阅读排版，服务端 prompt 禁止 emoji/装饰符号，旧序列化内容在 Views 层清洗为六段结构。
- 并行会话拥有 `src/App.jsx`、`src/components/Shell/`、`src/components/Chat/`、`src/components/Drawer/`、`server/agent.js`；本轮未修改这些路径。
- 最终本地验证：`npm run build` 通过，`npm test` 41/41 通过，`npm run lint` 0 errors / 5 个既有 hooks warnings。构建提示仍为 runtime-config.js 缺少 `type="module"` 和主 chunk 超过 500 kB。

## 当前部署修正（2026-08-09 23:20 +08:00）

- 已确认根因不是本机缓存：旧入口请求 `/assets/BPqB6IAJ.js` 被 Express SPA fallback 以 200 `text/html` 返回，浏览器拒绝模块执行，`#root` 因此为空。
- `server/index.js` 现在只对根级 hashed entry 形状的 `.js/.css` 缺失请求回退到当前同类型 bundle，并强制正确 MIME 与 `Cache-Control: no-store`；其他静态路径不映射到入口资源。首页和 SPA fallback 也明确 `no-store`。
- 新增 `test/legacyAssets.test.js`，实际启动 Express 验证旧 JS/CSS 返回当前资源、正确 MIME、非 HTML；`npm test` 23/23 通过。
- 已用 `scripts/deploy-ecs.sh --full` 部署并重启服务；未修改 `.env`、数据库或 SQL。线上旧 JS/CSS 的响应体 SHA-256 分别与当前 bundle 一致，首页、资源和 `/health` 均通过，受控浏览器显示登录页。

历史记录（2026-08-09）：UI 重做基线、认证超时修复和 stale hashed asset 部署修复已发布到 ECS；本文件顶部的 2026-08-10 任务收口是当前状态，历史决策写入 `MEMORY.md`。

## 当前状态

- 分支：`feature/priority-engine-v2`
- 已完成 FocusTree 全量 UI 重做：默认“林夜”深色主题，支持“晨纸”浅色主题和跟随系统；新增统一 token、基础样式、响应式壳层、左侧模式栏、可调宽右侧抽屉。
- 树视图保留原有 D3 交互（选择、双击展开、拖拽移动/排序、右键菜单、内联重命名、缩放、键盘快捷键），并新增三通道视觉：节点大小/辉光对应 `directPriority`，填充枝干宽度对应 `branchPriority`，年轮对应 `cultivationScore`；期限弧、紧急芽点、状态形状也已接入。
- 新增 Focus、List、Review 三种模式；Chat、Inbox、Detail、Audit 为右侧抽屉固定页签，记忆/推荐/历史/备份作为临时页签。
- 新增 Today 聚焦胶囊、可收起图例、画布缩放/适配/密度/图层控制、三分数详情与优先级审计；移动端抽屉改为覆盖式布局。
- Audit 已改为读取真实 `criticalPath`/传播边和 `cultivationBreakdown`，整树表格支持六列排序与行定位；不再展示截断子节点或固定百分比。
- 树画布补齐新增/删除/完成/重排/分数变化动效、`prefers-reduced-motion` 降级、SVG treeitem 键盘导航和 ARIA；全局新增 `?` 快捷键说明浮层。
- 晨纸主题使用 `--ft-text-primary` 暗晕与提高对比度的年轮；`src/` CSS 中除 base reduced-motion 规则外不再有 `!important`。
- 认证启动改为有限等待：Supabase `getSession()` 8 秒超时后释放首屏 loading 并显示错误，晚到的合法 session 仍会接管用户状态；登录/注册请求 15 秒超时后释放按钮 loading。
- 本轮未修改并行会话负责的 `server/agent.js`、优先级算法、分析协议、数据库及既有 hook 外部签名；仅按 D2 任务修改 `server/weeklyReview.js` 的 emoji/排版 prompt。旧组件仍保留必要的数据行为，但新 App 路径不再依赖旧 Toolbar/LeafView 页面。

## 关键文件

- `DESIGN.md`：UI 重做唯一设计规格。
- `src/styles/tokens.css`、`src/styles/base.css`：暗/亮主题 token、字体、动效、可访问焦点态。
- `src/components/Shell/`：TopBar、LeftRail、Drawer、AppShell。
- `src/components/Tree/CanvasStage.jsx`、`TreeView.jsx`、`render/`：树画布与纯视觉计算。
- `src/components/Views/`：Focus/List/Review 页面。
- `src/components/Views/boardModel.js`、`reviewFormat.js`：看板列模型与回顾内容规范化。
- `src/components/Drawer/`：Inbox/Audit/Utility 页面。
- `src/lib/branchPalette.js`：项目枝干色板和明暗主题分支色计算。

## 验证

- `npm test`：41/41 通过，包含认证入口、看板过滤、回顾格式清洗和树标签回归测试。
- `npm run lint`：0 errors；5 个既有 React Hook exhaustive-deps warnings，集中在 `useChat.js`/`useWeeklyReview.js`。
- `npm run build`：通过。Vite 提示 `runtime-config.js` 缺少 `type="module"`，并提示主 chunk 大于 500 kB；均为已有构建提示，不影响产物生成。
- 浏览器冒烟已验证 `http://127.0.0.1:5173/` 能启动并进入配置提示页；当前 `.env` 的 Supabase/AI 值为空，无法在本地会话中验证登录后的真实树数据。
- 部署前浏览器探测公网 `https://focus.buzzegg.cn/` 曾在 30 秒内超时；部署后 HTTPS 检查已恢复：`/health` 200、首页 200。该前后差异不能归因给前端认证代码。
- stale asset 线上验证：当前 `/assets/index-C4qR1G-k.js` 为 200 `text/javascript`；历史 `index-BPqB6IAJ.js`/`index-QQUu0Bzt.js` 为 200 但 `text/html`，证明旧文件已被前一版部署清理，Express SPA fallback 仍会把缺失资源伪装成 HTML。

## 线上部署

- GitHub：`https://github.com/LangYY/focustree`，分支 `feature/priority-engine-v2`，发布 commit `31c708f`。
- ECS：`8.153.96.57`，systemd (`focustree.service`) + Nginx，目录 `/opt/focustree`，Node v22，Nginx 把 `focus.buzzegg.cn` 转发到 `127.0.0.1:3001`。**不是 Docker**——`deploy/ecs/` 里的 Docker Compose + Caddy 方案没有在用。
- 本次使用 `scripts/deploy-ecs.sh` 无参数部署，仅上传前端 `dist`，未覆盖线上 `.env`，未使用 `--full`，未重启 `focustree.service`。部署完成时间为 2026-08-09 21:45:51 +08:00，脚本耗时约 3.13 秒。
- 构建产物：`dist/index.html`、`dist/assets/index-mtElzF47.css`、`dist/assets/index-C4qR1G-k.js`；远端 `dist/index.html` SHA-256 与本地一致。脚本内 `/health` 返回 200，服务保持 active。
- 额外线上检查：首页 200；`/health` 200（Supabase/DeepSeek 配置均已识别）；`/readiness` 返回 503，唯一失败项为 `node_annotations` 数据库检查（响应 message 为空），不是前端静态部署或 HTTP 连通性失败。需人工检查 Supabase 中该表及服务角色查询权限；仓库已有 `sql/002_annotations_and_log.sql` 建表脚本。
- stale hash 修复部署：更新后的脚本在原子切换后执行 `cp -an dist.old/assets/. dist/assets/`，保留上一版所有 hash 资产且不覆盖新 bundle；本次部署完成时间为 2026-08-09 22:43:15 +08:00，脚本耗时约 3.43 秒。此前旧版本已被清理的历史 hash 无法在不重复部署的前提下现场恢复，下一次切换起不再产生同类断链。

### 构建必须在本机进行

ECS 是 2 核 / 1.6 GB，除 FocusTree 外还跑着 MariaDB 和另外 5 个 Node 应用，空闲内存不到 900 MB。`npm run build` 峰值几百 MB 到 1 GB，在这台机器上跑有把其他服务一起 OOM 掉的风险。

部署走 `scripts/deploy-ecs.sh`：本机构建 → 上传 `dist.new/` → 原子切换 → 将 `dist.old/assets` 合并进新 `dist` → 校验 `/health` → 失败保留 `dist.old/` 回滚。前端更新零停机（`express.static` 每次请求读盘），只有 `server/` 变更才需要 `--full` 重启。服务器装依赖用 `npm ci --omit=dev`。

FocusTree 自身稳态占用：RSS 约 77 MB、CPU ~0%、磁盘 228 MB（其中 `node_modules` 225 MB），零后台定时任务。

## 后续

1. 等待用户验收本工作树中的 A/C/D 变更；本轮不 commit、不部署。
2. 另一个会话完成信息架构后，再由负责人统一验收左导轨名称与视图切换串联。
3. 配置本地 Supabase 与 AI 环境变量后，可进一步做真实账号下的登录、看板和周回顾冒烟验证。
## 2026-08-09 — UI redesign follow-up (uncommitted)

- Completed the four requested UI follow-up tasks: semantic color migration and legacy stylesheet removal, dead component cleanup with Audit analysis actions, reusable UI primitives, and the Inbox proposal workflow.
- Inbox now owns proposal interaction, including draft/goal/priority cards, per-card processing, seven-day processed history, chat deep-link highlighting, debounced priority previews, and shared preview/apply logic.
- Verification after the follow-up: `npm test` 14/14 passed; `npm run lint` 0 errors with 5 existing exhaustive-deps warnings; `npm run build` passed. No commit was created.

---

## 2026-08-09 — Local render investigation (temporary changes removed)

- A local-only authenticated render reached the app shell, but the controlled browser reported an empty `#root`.
- The blocking render error is `src/components/Tree/TreeView.jsx:729`: a D3 transition rejects `.on('mouseleave', ...)` with `unknown type: mouseleave`, after which React reports a TreeView error.
- The offline Supabase query double lacks `.limit()`, causing additional unhandled hook rejections in chat and weekly review paths; this session made no permanent fix for either issue.
- All temporary local files and instrumentation were removed. No cloud, database, deployment, or commit changed.

---

## 2026-08-10 — TreeView hover binding fix

- The authenticated home blank was fixed at the source: `mouseleave` now binds to the circle selection before the existing D3 animation transition.
- `test/treeViewEvents.test.js` covers the ordering contract and passed in the full suite. Local controlled browser smoke showed the tree canvas with 4 nodes and no TreeView error.
- Final local verification: `npm test` 24/24, `npm run lint` 0 errors / 5 existing warnings, and `npm run build` passed. No deployment or commit was performed.

---

## 2026-08-10 — AI assistant no-response investigation

- Investigation only; no code, deployment, database, cloud `.env`, credentials, or commit changed.
- Public `/health`, `/readiness`, and a bounded synthetic `/api/agent` probe are healthy. The probe reached DeepSeek and returned HTTP 200 JSON with a non-empty reply in about 7.8 seconds.
- Primary code-level risk is the pre-agent `conversations` insert in `useChat.sendMessage`: it is awaited before `/api/agent`, outside the later error/finally boundary, with no timeout. A Supabase session/network/RLS stall can leave the UI waiting without any agent request.
- Recent ECS logs separately show provider latency/retries: one request took about 46 seconds; another returned empty content twice before succeeding on attempt 3.
- To attribute a user incident, inspect the browser Network panel: absence of `/api/agent` points to the Supabase insert path; a long-pending `/api/agent` points to provider latency/retry; 200 JSON points to client response/rendering.
