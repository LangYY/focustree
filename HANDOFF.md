# HANDOFF

当前项目状态的唯一事实来源。信息过时就直接替换，不要堆积历史（历史进 `MEMORY.md`）。

最后更新：2026-08-13。

## 当前分支

`feature/priority-engine-v2`，`HEAD` 为 `3961b8e`。工作树干净，已推送到 origin，已通过
`scripts/deploy-ecs.sh` 部署到 https://focus.buzzegg.cn 并验证（`/health`、`/readiness`
全 `ok:true`，10 张表探测通过，线上资源指纹与本次构建一致）。

## 当前架构

### 树画布标签

- **位置在节点正上方**，不在右侧。右侧是子枝干的出发方向，标签放那里和枝干必然重叠；
  上方是兄弟节点之间稳定空着的区域。单行，`x = 0` 从圆心向右起排，基线 `-(r + 9)`。
- 避让**从画布最下方往上**依次放置，碰撞时把上面那个继续往上顶（向下会压到自己的节点），
  包围盒之间至少 4px。宽度上限为下一层水平间距的 `0.85`，超出加 `…`。
- **没有文字描边，也没有任何几何衬底**。可读性由 `.node-label` 的 `drop-shadow` 承担，
  颜色走 `--ft-label-halo`（林夜暗影 / 晨纸画布色柔光）。这两条都是实测否掉旧方案后定的，
  原因见 `MEMORY.md` 2026-08-12 条目，不要回退。
- 标签自己接收点击：`.node text.node-label` 单独放开 `pointer-events`，`click`/`dblclick`
  绑在 text 上。移到上方后它不再落在向右延伸的 `.node-hit-area` 里。

### 字体

全应用只有 `--ft-font-sans` 一个字族，`--ft-font-serif` 已删除。层级只由字号和字重区分
（树标签 project/category 15px/600，task 12.5px/400）。

### 主题

只有深色和浅色两档，「系统」已移除。`index.html` 首屏 bootstrap 与 `App.jsx` 必须同口径读
`ft_theme`（旧的 `'system'` 存量值归到深色），否则首屏会闪一下错误主题。

### 新手引导

- `src/lib/onboarding.js` 是纯状态机，`src/hooks/useOnboarding.js` 负责协调。
- 流程：`WELCOME`（这是什么）→ `READING`（三个视觉通道逐个讲）→ `DECISION`（真实输入 /
  看示例）→ `SPEAK` → `WAITING` → `CONFIRM` → `WITNESS` → `TODAY` →
  `RECOMMENDATION_WAITING` → `CLOSING`。
- 两个等待态都有 45s 超时兜底；`WAITING` 收到不含提案的回复会转 `RETRY` 而不是干等。
- `canGoBack` 规定可退步骤：已写库或已发出请求的不给退。
- `READING` 的示意图是自带极简 SVG，不读真实数据。

### 示例数据（破坏性，已加防护）

`useTree.js` 的 `loadExampleData` **会硬删该用户全部节点**再插入示例，且不进撤销栈。
`App.jsx` 的 `loadExample` 是唯一入口（账户菜单与引导都走它）：树非空时先 `window.confirm`
明示删除数量与不可撤销，确认后先 `preDestructiveBackup` 再删；空树不打扰。
改动这一带时先看 `test/exampleDataGuard.test.js`。

### 其余

- `src/lib/exampleData.js` 生成 22 个节点（3 project / 6 category / 13 task），三条互相
  争夺注意力的主线。
- `src/lib/reviewSerialization.js` 负责周回顾的干净序列化；对话注入与 Review 视图共用同一
  解析契约。
- `/readiness` 每张表有一次 200ms 延迟的有界重试，两次失败才返回失败。

## 验证

- `npm test`：68/68 通过。
- `npm run lint`：0 error，5 个既有 exhaustive-deps warning（`useChat.js` / `useWeeklyReview.js`）。
- `npm run build`：通过；保留既有 runtime-config 非 module 提示和大 chunk warning。
- 真实浏览器验证：双主题、密度全开 35 个标签实测重叠对数 0、引导三拍前进与逐级后退、
  三个通道示意图各自正确变化。

## 本地开发注意

`npm run dev` 会同时起 Vite 和 AI 后端。后端读 `PORT`，默认 3001；**若把它的端口设成 5173，
它会抢占通配地址，把 Vite 挤到 `127.0.0.1:5173`**，此时 `localhost:5173` 访问到的是后端提供的
旧 `dist/` 构建，改动看起来「不生效」。`.claude/launch.json`（未纳入版本管理）应把 port 设为
3001，预览地址用 `http://127.0.0.1:5173`。

## 待定

- 「先看个示例」分支仍跳过核心循环（说→提案→确认→树生长），只是现在会先看到 `WELCOME`
  与 `READING` 两拍。是否让它用示例数据也演示一遍，是尚未决定的产品问题。
- `.claude/launch.json` 是否纳入版本管理未定。
