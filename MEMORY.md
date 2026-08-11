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
---

## 2026-08-09 — FocusTree UI follow-up tasks

- Replaced the remaining named Tailwind color utilities in Chat, Modal, and Tree surfaces with component-scoped semantic token classes, then removed `legacy-theme.css`.
- Deleted obsolete Toolbar/TodayCard/LeafView/PriorityDebugPanel files. Moved the missing-node and full-tree priority analysis actions into `AuditTab`.
- Added the shared `Button`, `Slider`, `Chip`, `Tooltip`, and `Badge` primitives. Slider keyboard behavior and focus semantics are explicit.
- Inbox is the only full proposal interaction surface. It consumes both structured draft actions and panel-change suggestions, keeps per-entry accept/reject state for seven days, and previews priority changes through the same pure proposal application path used by the tree hook.
- Final verification: `npm test` 14/14 passed, `npm run lint` 0 errors / 5 pre-existing warnings, and `npm run build` passed. Changes remain uncommitted for user acceptance.

---

## 2026-08-09 — Audit truthfulness, motion, and accessibility follow-up

- Audit 的关键路径来自 priority engine 的 `upwardCritical` 传播候选，而不是截断后的前三个子节点；培育度拆成引擎实际使用的四项原始值、权重和贡献，四项合计严格回到 `cultivationScore`。
- `priorityProposal.test.js` 改为模拟 `useTree.applyPriorityAnalyses` 的持久化行，再从干净树重建 metadata；补充缺失节点、根节点和越界信号边界测试，避免用同一 preview/apply 内部实现自证。
- TreeView 保持既有 D3 交互层，只在视觉渲染层加入路径生长/收回、节点半径与标签过渡、完成勾线、布局 transition 和最多三个分数变化脉冲；`prefers-reduced-motion` 同时由 CSS 和 D3 duration 降级。
- 晨纸主题的直接优先级辉光采用 `--ft-text-primary` 暗晕（opacity 乘 0.58，blur 3.5），年轮采用 `--ft-text-secondary`（opacity 乘 1.65，上限 0.85）；实测文字对 surface 为深色 14.72/7.86/4.06、浅色 14.16/5.90/3.03，浅色分支色最低 4.02。
- 本轮不提交、不部署；本地浏览器仅能进入配置提示页，因为 `.env` 未提供 Supabase/AI 配置。

---

## 2026-08-09 — Auth 初始化超时修复

- 根因：`App.jsx` 只等待 `supabase.auth.getSession()` resolve/reject 或 `INITIAL_SESSION` 事件，没有超时；Supabase 会话恢复卡在网络请求或内部锁时，`authLoading` 永远保持 `true`。认证表单的 `signInWithPassword`/`signUp` 也没有请求超时，按钮会永久处于处理中。
- 修复：新增 `src/lib/authSession.js`。会话恢复 8 秒后释放首屏 loading 并显示错误；晚到的 session 仍可更新用户。认证提交请求 15 秒后拒绝，确保表单 finally 能恢复。
- 回归测试：`test/authBootstrap.test.js` 覆盖永不 resolve 的 session restore 和 auth request 两条链路；最终全量测试 21/21 通过。
- 线上浏览器探测在 30 秒内超时，属于需要另外检查 ECS/systemd/Nginx 可达性的部署前事项；本轮只改仓库代码，未部署。

---

## 2026-08-09 — Auth 修复前端部署

- 本地 `npm run build` 成功，产物为 `dist/index.html`、`dist/assets/index-mtElzF47.css`、`dist/assets/index-C4qR1G-k.js`；Windows 默认 WSL `bash.exe` 因 `E_ACCESSDENIED` 导致第一次脚本调用超时，未触碰 ECS，改用已安装的 Git Bash 后按原脚本无参数部署成功。
- 部署完成时间：2026-08-09 21:45:51 +08:00；脚本耗时约 3.13 秒。只上传前端 `dist`，未使用 `--full`，未覆盖线上 `.env`，未重启服务。脚本内 `/health` 200，远端 `dist/index.html` 哈希与本地一致。
- 线上额外验证：首页 200、`/health` 200；`/readiness` 503，唯一失败项是 `node_annotations` 数据库查询检查，响应没有错误 message。该项需要人工检查 Supabase 表/权限或执行现有 `sql/002_annotations_and_log.sql`，不应通过再次部署前端解决。

---

## 2026-08-09 — Stale hashed asset 根因与部署修复

- 根因：旧 `index.html` 仍可能引用已被原子部署删除的 hash bundle；缺失 `/assets/*.js` 被 `server/index.js` 的全量 SPA fallback 返回为当前 `index.html`（200 + `text/html`），浏览器拒绝模块执行，React 不挂载，只留下 `#root:empty::after` 绿色点。Nginx 没有 `proxy_cache`，首页/资产是 `public, max-age=0`，`runtime-config.js` 是 `no-store`。
- 修复：`scripts/deploy-ecs.sh` 切换 `dist` 后以 `cp -an dist.old/assets/. dist/assets/` 保留上一版 hash 资产；新增 `test/deployAssets.test.js` 锁定该部署契约。未修改服务端、数据库或线上 `.env`。
- 验证：`npm test` 22/22、`npm run lint` 0 errors/5 个既有 warnings、`npm run build` 通过。2026-08-09 22:43:15 +08:00 通过无参数前端-only 部署，脚本内 `/health` 200，耗时约 3.43 秒，未重启服务。
- 部署后当前 bundle、首页、`/health` 均 200；历史 `BPqB6IAJ`/`QQUu0Bzt` URL 虽为 200，但仍返回 HTML，因为它们在本次修复前已被清理，未重复部署或直接写入线上恢复旧文件。后续版本切换会保留上一版资产，避免新产生同类断链。

---

## 2026-08-09 — Legacy hashed asset server fallback

- Root cause was confirmed on the public path: a missing old entry such as `/assets/BPqB6IAJ.js` fell through Express SPA routing and returned the current `index.html` with 200 `text/html`, so the browser rejected the module and left `#root` empty.
- `server/index.js` now recognizes only root-level hashed entry-shaped `.js/.css` paths, maps them to the current same-extension `index-*` asset with explicit MIME and `no-store`, and never maps unrelated asset paths to a bundle. Index and SPA fallback responses are also `no-store`.
- `test/legacyAssets.test.js` exercises the real Express app and verifies old JS/CSS bodies, MIME types, status, and non-HTML content. Standard `npm test` passed 23/23; lint has 0 errors and 5 existing hook warnings; build and `node --check server/index.js` passed.
- `scripts/deploy-ecs.sh --full` uploaded `server/` and `dist`, installed production dependencies, restarted `focustree.service`, and passed `/health`. Public probes returned 200 for home/current assets/legacy assets/health; legacy JS and CSS hashes matched their current counterparts. No `.env`, database, or SQL execution was changed.

---

## 2026-08-09 — Local render investigation (temporary changes removed)

- With a local-only test identity, the app passed the auth gate but the controlled browser showed `#root` with zero children.
- The first fatal render error was `src/components/Tree/TreeView.jsx:729`: D3 transition `.on('mouseleave', ...)` throws `unknown type: mouseleave`, and React reports a TreeView render error.
- The offline Supabase query double also lacks `.limit()`, producing unhandled rejections in `src/hooks/useChat.js` and `src/hooks/useWeeklyReview.js`; profile/focus hooks settle after reporting missing config.
- The temporary local files, code, instrumentation, process, logs, and screenshot were removed. No cloud, database, deployment, or commit changed.

---

## 2026-08-10 — TreeView hover binding fix

- The blank authenticated shell was caused by `mouseleave` being registered after `.transition()`, which made D3 treat it as an invalid transition event and throw `unknown type: mouseleave`.
- `TreeView.jsx` now binds the exit handler on the `.node-main-circle` selection before applying the existing animation. `test/treeViewEvents.test.js` proves the old source fails and the fixed source passes.
- Controlled local browser evidence: `#root` child count `1`, tree role present, and `4` rendered nodes; no TreeView error. Full verification passed with `npm test` 24/24, lint 0 errors / 5 existing warnings, and build success.
- Temporary local auth files, processes, browser pages, and logs were removed. No cloud, database, deployment, or commit changed.

---

## 2026-08-10 — AI assistant no-response investigation

- No code, deployment, database, cloud `.env`, credentials, or commit was changed. The controlled browser remained unauthenticated.
- The public `/health` and `/readiness` endpoints returned 200 with LLM/Supabase configuration and all checked tables healthy. A bounded synthetic `/api/agent` probe returned a non-empty DeepSeek JSON reply in about 7.8 seconds.
- The main code-level failure path is `useChat.sendMessage` awaiting the user-scoped `conversations` insert before `/api/agent`; the await is outside the later `try/finally` and has no timeout. A stalled/rejected session/network/RLS write can therefore leave loading active while no agent request is sent.
- ECS logs also show provider intermittency: one request took about 46 seconds, and another received empty content twice before succeeding on retry 3. This is a slow/retry path, not a current provider outage.
- Incident discriminator: no `/api/agent` means the pre-agent Supabase path; a long-pending `/api/agent` means provider latency/retries; a 200 JSON response moves the investigation to client response state/rendering. Full authenticated attribution requires a user-provided Network observation, not credentials.

---

## 2026-08-10 — RCA conclusions merged from temporary reports

- The no-response investigation found a high-risk client path before `/api/agent`: `useChat.sendMessage` awaited the authenticated Supabase conversation insert without a timeout and outside the later `try/finally`. A stalled or rejected session/network/RLS write can leave the loading state active without sending an agent request. If `/api/agent` is already pending, provider latency and empty-content retries are separate possibilities; a bounded synthetic probe reached the public route and returned valid DeepSeek JSON.
- The TreeView blank-shell investigation found that D3 treated a `mouseleave` handler registered after `.transition()` as a transition event. Binding the handler on the selection before starting the transition fixed the `unknown type: mouseleave` crash. The controlled browser then rendered the tree role and four nodes; the local no-config Supabase mock still lacks `.limit()` for chat/review hooks.

---

## 2026-08-10 — Architecture task B implementation

- Replaced the multi-tab right drawer with one resizable Focus Agent conversation panel. Proposal interactions now live under their source assistant message through `ProposalCards`; processed entries remain as one-line records at the original location, while priority previews reuse the existing pure preview map with a 120ms debounce.
- Replaced the right-side detail/audit tabs with a DOM-anchored `NodeInspector` floating card. It retains detail autosave and keyboard restore/save behavior, follows tree pan/zoom, and folds the real priority explanation fields into a collapsed audit section. The whole-tree sortable audit table moved to a centered account modal.
- Fixed the user-facing model contract to DeepSeek V4 Flash with maximum reasoning and a 16k token budget. Empty-content and JSON-parse retries still internally escalate to pro; the UI and request payload no longer expose a model choice. No temperature was sent because this workspace has no DeepSeek key for the requested empirical Flash + max verification.
- Updated `DESIGN.md`, `HANDOFF.md`, and Focus Agent naming across UI/prompt/docs; deleted obsolete drawer/detail components and merged the temporary RCA conclusions into root memory. No commit or deployment was made.

## 2026-08-10 — A/C/D satellite tracks

- Auth now has password sign-up/login plus a parallel magic-link login path. A real `signInWithOtp` call against the current public Supabase runtime config delivered a confirmation link email, not a six-digit code; the UI therefore uses a sent-link message and 60-second resend cooldown. Demo onboarding uses an explicit email guide because confirmation makes a random experience account unreliable.
- Tree labels now use 16px serif for project/category and 12.5px sans for tasks, two lines capped at 11 characters each, 2px text stroke, same-depth greedy vertical avoidance, and done strike-through. Numeric score labels are gone while node size/glow, tapered branch, and rings remain.
- ListView now derives fixed 300px project columns from the existing tree model, flattens category descendants, sorts by direct priority, and filters all valid due states including `later`; cross-project drag is intentionally absent.
- ReviewView renders the six-section review schema as a centered 680px slow-reading page. The server prompt forbids emoji, decorative symbols, and `---`; Views normalizes both new structured reviews and existing serialized summaries, stripping old decorations without changing the server schema.
- Final local verification for this worktree: build passed, `npm test` 41/41 passed, lint 0 errors with the same 5 pre-existing hook warnings. No commit or deployment was performed; changes remain for acceptance.

---

## 2026-08-10 — Track E onboarding and two root fixes

- 新手引导采用独立状态机（`src/lib/onboarding.js` + `useOnboarding` + `components/Onboarding`），把用户带过「表达混乱 → AI 提案 → 全部采纳 → 树生长 → 今日三件事」一轮；明确不做 tooltip tour、遮罩、气泡教学层或步骤计数器。提案卡只使用 accent 呼吸描边，生长后保留可见停顿并 fit-to-view。
- 移除 `useTree` 对新用户自动写入旧三节点样例的行为，改为保持空树等待引导。示例数据单独生成 22 个节点并写入当前用户，阶段目标同时写入用户 profile；账户菜单提供重播、载入示例和清空入口。
- 周回顾序列化抽到纯模块并改为干净文本小标题；聊天注入先解析结构再重新序列化，历史数据仍由 `reviewFormat.js` 清洗。补充序列化→解析往返和两条出口无 emoji 测试。
- 恢复 Agent 请求 `temperature: 0.3`，模型契约测试锁定该参数。
- 本轮验证：`npm test` 53/53、`npm run lint` 0 error（5 个既有 warning）、`npm run build` 通过。未提交、未部署，等待验收。

## 2026-08-11 — Track E 发布尝试

- 用户已验收并授权发布。当前分支 `feature/priority-engine-v2` 的 `HEAD` 为已有提交 `dbe3756`；本次发布尝试未新增提交。
- 按 `scripts/deploy-ecs.sh --full` 进行了多次尝试。WSL 首先暴露默认 `$HOME` 下密钥路径问题，改用 `/mnt/c/Users/XTIA/.ssh/focustree_ecs_ed25519` 后仍在 SSH banner 阶段超时；Git Bash 使用 `/c/Users/XTIA/.ssh/focustree_ecs_ed25519` 及 Windows 原生 OpenSSH 也复现同一问题。
- `focus.buzzegg.cn` 解析到部署脚本中的 `8.153.96.57`；22/443 TCP 端口可达，但 SSH banner、HTTPS `/health` 和项目 `cloud:smoke --require-readiness` 均未完成协议握手，后者返回 `fetch failed`。
- 脚本每次都在第一个远端 SSH 命令前退出，因此未确认发生线上 `dist` 切换、`server/` 上传、生产依赖安装或 systemd 重启。待 ECS SSH/Nginx/网络入口恢复后再重试完整发布。

## 2026-08-11 — Track E 发布成功

- ECS 入口恢复后，用 Git Bash 和 `FT_KEY=/c/Users/XTIA/.ssh/focustree_ecs_ed25519` 重试 `scripts/deploy-ecs.sh --full` 成功：本地构建、dist 上传、server 上传、`npm ci --omit=dev`、dist 原子切换、`focustree.service` 重启及脚本 `/health 200` 全部完成。
- 远端生产依赖安装报告 5 个漏洞（1 low、1 moderate、1 high、2 critical）；本次未自动执行 `npm audit fix`，避免改变发布范围。
- 发布后项目 smoke 全部通过：`/health`、`/readiness`、`/runtime-config.js`、首页和 SPA fallback 均正常。第一次 readiness 瞬间返回 `priority_analysis_runs` 503，立即重跑恢复 200，所有表检查通过。
- 受管浏览器 canary 通过：登录页 HTTP 200、约 896ms 完成 DOM、标题「专注树」、登录/注册关键文案正常，并已保存截图。未使用账户执行认证后新手引导流程。

---

## 2026-08-11 — 树画布视觉精修

- 晨纸主题的 direct glow 不再强制使用 `--ft-text-primary` 暗晕。浏览器对比确认旧方案在米白底上更像阴影/污渍；现在两个主题都使用节点自身的 `__displayColor`，晨纸保留 `0.58` opacity 折减，`stdDeviation = 3.5` 和年轮通道不变。对应判断已先写回 `DESIGN.md`。
- 标签宽度改为像素上限：按下一层实际水平间距的约 `0.5` 倍计算，叶节点回退到 `NODE_H_GAP`；`estimateTextWidth` 驱动最多两行省略号，碰撞候选只读当前深度及相邻深度。500 个合成节点布局抽样约 `8.38ms`，没有全树扫描。
- 探索性切线方案保留：`branchTangent` 在枝干 `t=0.88` 处求单位切线，标签锚点沿切线偏移 8px，不旋转文字，并让碰撞布局使用偏移后的盒子。真实生产 `TreeView` 浏览器验证了晨纸/林夜、缩放、平移、展开全部/折叠全部和拖拽预览；22 个标签无碰撞，切线对比平均垂直偏移约 `1.2px`，未见抖动，因此保留。
- 新增标签/视觉回归测试后，全量 `npm test` 为 `58/58`；`npm run lint` 为 0 error、5 个既有 hook warning；`npm run build` 通过并保留既有 runtime-config 与大 chunk warning。未新增依赖、未提交、未部署；`.codex-task.md` 与临时浏览器实验文件已删除。
