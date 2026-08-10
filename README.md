# 🌳 专注树 FocusTree

> 一个为自由职业者 / 内容创作者打造的「外脑 + 个人助理 + 成长地图」

帮一个多线程的个体工作者回答三个问题：

1. **我现在该做什么？** ——在多个项目、多种身份间不迷失方向
2. **我做完了什么？** ——让进展被看见、被沉淀
3. **我想到了什么？** ——灵感不丢，自动归位到合适的项目枝

## 形态

```
┌───────────────────────────────────┬─────────────────┐
│  D3 树形可视化                     │  Focus Agent 面板    │
│  · 项目 / 分类 / 任务三层结构      │  · 自然语言操作 │
│  · 状态：进行中 / 已完成 / 暂停    │  · 深度推理推荐 │
│  · 节点策略标签（ROI / 时段等）    │  · 长期记忆     │
└───────────────────────────────────┴─────────────────┘
```

## 核心特性

- **目标对齐推荐** —— AI 推荐时强制标注 🎯 对齐目标 ✓ 或 ⚠️ 偏离原因
- **7 字段深度思考** —— 每次推荐都暴露权衡、陷阱、下一步、完成标准等
- **四层记忆系统** —— 长期画像 / 会话摘要 / 当前对话 / 原始存档
- **闭环对账** —— 推荐→完成→命中率→AI 自我修正
- **今日聚焦** —— 早晨 AI 生成今天 3 件事（时段错峰）
- **周末回顾** —— 距上次 > 7 天自动主动反思

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 18 + Vite + Tailwind v4 |
| 可视化 | D3.js v7 |
| 后端代理 | Express.js |
| 数据库 | Supabase（PostgreSQL + RLS） |
| AI 模型 | DeepSeek V4-flash / V4-pro |

## 本地开发

```bash
# 1. 安装依赖
npm install

# 2. 复制环境变量模板并填入真实值
cp .env.example .env
# 编辑 .env，填入 Supabase 项目地址、密钥、DeepSeek 或 OpenAI API key

# 3. 跑数据库迁移
# 把 sql/*.sql 文件按编号顺序在 Supabase SQL Editor 里执行
# 000_core_tables.sql 必须最先执行

# 4. 启动（同时跑 Vite + 后端代理）
npm run dev
```

访问 [http://localhost:5173](http://localhost:5173)。
后端健康检查：[http://localhost:3001/health](http://localhost:3001/health)。

没有 `.env` 时应用也可以启动，但会停在配置提示页；填好 Supabase 和模型密钥后重启即可登录和保存数据。

## 云端部署

FocusTree 可以作为单个 Node 服务部署：先执行 `npm run build`，再用 `npm start` 启动。生产环境里 Express 会同时提供 API、前端页面和 `/runtime-config.js` 运行时配置。

详细步骤见 [DEPLOY.md](./DEPLOY.md)。

## 项目文档

- [PRODUCT_SPEC.md](./PRODUCT_SPEC.md) — 当前产品说明（产品逻辑、用户流程、核心算法）
- [PROJECT_PLAN.md](./PROJECT_PLAN.md) — 完整设计文档（含架构、记忆系统、agent 内部机制、lessons learned、协作约定）
- `sql/` — 数据库迁移按编号执行
- Notion 同步页：见 PROJECT_PLAN 顶部链接

## 当前状态

Phase 1-5 已完成（目标、节点标签、模型路由、四层记忆、Outcome 闭环 + Today + 周回顾）。
下一阶段：Phase 6 移动端 + 快速捕捉。UI 美化（Phase 11）留到所有功能稳定后做。

详见 [PROJECT_PLAN.md](./PROJECT_PLAN.md) 与 Notion 子页《使用指南 & 反馈记录》。
