# HANDOFF

当前项目状态的唯一事实来源。信息过时就直接替换，不要堆积历史（历史进 `MEMORY.md`）。

最后更新：2026-08-12。

## 当前分支

`feature/priority-engine-v2`。当前 `HEAD` 为已有提交 `cf1eb13`；轨道 E 已完成并已发布。本轮树画布标签胶囊衬底已完成本地实现与验证，工作树保留未提交改动，未 commit、未部署，等待用户验收。

## 当前架构

### 新手引导

- `src/lib/onboarding.js` 是纯状态机；`src/hooks/useOnboarding.js` 只负责用户、树、消息和本地存储的协调。
- `src/components/Onboarding/` 负责空画布岔路、对话内行动提示、三个示例输入和收尾。没有遮罩、tooltip tour、气泡教学层或步骤计数器。
- 首次进入条件是当前用户节点数为 0 且 `localStorage.ft_onboarded` 未置位。真实输入沿用现有 `/api/agent`；提案卡用 `--ft-accent` 呼吸描边；全部采纳后等待树生长并 fit-to-view；最后自动发送「问问今天该做什么」，推荐返回后置位完成标记。
- 每一步都可以跳过；账户菜单提供「重新看一遍引导」「载入示例数据」「清空全部」。结束后常驻界面不保留引导元素。

### 示例数据

- `src/lib/exampleData.js` 生成 22 个当前用户节点：3 project、6 category、13 task，三条互相争夺注意力的主线分别是 B 站频道、现金流与求职、独立产品副线。
- 每个节点都有 `status`、`current_priority`、`target_completion_date`；示例阶段目标为「在 9 月前发布 3 条视频，同时稳住现金流」。数据通过当前用户 `user_id` 写入，可由「清空全部」重置。
- 在固定 2026-08-10 参考时间下，三条顶层主线的 direct / branch / cultivation 约为：内容 `67 / 71 / 67`，现金流 `83 / 83 / 64`，副线 `8 / 40 / 53`；三个视觉通道在示例树上有明显差异。当前树画布视觉修正见下方专节，交互层保持原有实现。

### 周回顾与模型

- `src/lib/reviewSerialization.js` 负责干净小标题的序列化；`useWeeklyReview` 使用并重新导出 `serializeReview`。
- `useChat.injectReviewMessage` 先用 `reviewFormat.js` 解析，再序列化为无 emoji 文本；`reviewFormat.js` 对历史 emoji 数据的清洗保留。对话注入和 Review 视图共用同一解析契约。
- `server/agent.js` 的 Agent 请求恢复 `temperature: 0.3`，保留 `deepseek-v4-flash`、`reasoning_effort: max` 和 `max_tokens: 16000`。

### 树画布视觉精修

- `TreeView.jsx` 的 direct glow 在晨纸与林夜都使用节点自身的 `__displayColor`；晨纸只保留 `0.58` opacity 折减，年轮通道保持独立。
- `render/labels.js` 按下一层水平间距的约一半计算像素宽度上限，保留最多两行与省略号；碰撞索引只检查当前深度及相邻深度。
- 标签沿枝干末端切线方向做 `t=0.88`、8px 的非旋转锚点偏移，并纳入同一碰撞布局。真实组件浏览器验证覆盖双主题、22 个标签、缩放、平移、展开/折叠和拖拽预览，未发现标签碰撞或布局抖动；探索性实现保留。
- 标签衬底复用 `layoutLabelPositions()` 的宽高，统一向外扩 3px，以 `--ft-surface-hover` 绘制纯色胶囊；晨纸/林夜 opacity 分别为 `.42` / `.34`，`rx` 始终为总高度的一半，无边框、投影或命中区域。保留文字 `stroke/paint-order` 挖空（方案 A），方案 B 在枝干交叠处的字符边缘不如 A 稳定。

## 验证

- `npm test`：61/61 通过。
- `npm run lint`：0 error，5 个既有 exhaustive-deps warning（`useChat.js` / `useWeeklyReview.js`）。
- `npm run build`：通过；保留既有 runtime-config 非 module 提示和大 chunk warning。
- 真实组件浏览器验证：晨纸/林夜、22 个标签、密集分叉、缩放、平移、展开/折叠和拖拽预览均通过；胶囊与标签一一对应，几何校验无异常，标签碰撞数为 0。
- 额外性能抽样：500 个合成节点的标签布局约 8.38ms，未做全树碰撞扫描；本轮未新增几何相交判断。

## 禁改边界

- 未修改 `src/lib/priorityEngine.js`、`src/lib/priorityAnalysis.js`、`src/lib/intentClassifier.js`、`src/lib/supabase.js`、数据库结构或 `TreeView.jsx` 的交互层。
- 未新增依赖；未改变现有 hooks 的对外参数签名。

## 下一步

等待用户验收本轮树画布标签视觉精修。`.codex-task.md` 与临时浏览器实验文件已删除；本轮未新增 commit、未部署。

## 2026-08-11 — `/readiness` 间歇性 503 独立诊断

- `server/index.js` 的 `supa` 确认为模块级 service-role 单例，未配置自定义 fetch、keep-alive 或数据库超时；`/readiness` 原先并发检查 10 张表，单表一次失败就把整体响应变成 503。`@supabase/supabase-js` 锁定为 2.105.4，Node 24 使用内置 Undici 7.21.0；PostgREST 默认只覆盖网络错误、503/520 的 SDK 重试，不覆盖本地复现的 502 空响应。
- 本地空闲实验中，Node 24 全局 fetch 约 1 秒就释放 idle keep-alive，未复现长时间闲置后复用失效连接；人为断开 socket 时 SDK 默认重试成功，错误对象为非空 `TypeError: fetch failed`。模拟 502 空响应则精确得到 `error.message === ''`，下一次请求恢复 200。公网 curl 只读探测共 113 次，捕获 1 次瞬态 503，随后立即恢复；其余窗口均 200，无法在不接触生产日志/凭据的前提下确认失败表名。
- 针对性修复只在 `/readiness` 内增加每表一次、200ms 延迟的有界重试；两次失败才返回 `ok:false`，并通过 `console.warn` 记录表名、错误 name/code/message/status。新增 `test/readiness.test.js` 覆盖重试后成功和重试后仍失败两条路径。`npm test` 60/60 通过，`npm run lint` 0 error、5 个既有 warning，`npm run build` 通过并保留既有 Vite 提示。未新增依赖、未 commit、未部署，等待验收。
