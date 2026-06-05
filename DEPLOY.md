# FocusTree 云端部署指南

FocusTree 生产环境是一个 Node 服务：Express 提供 `/api/*`，同时托管 `dist` 前端页面。

## 1. 准备 Supabase

1. 新建 Supabase project。
2. 生成数据库脚本：

```bash
npm run db:bundle
```

3. 在 SQL Editor 里执行 `dist/focustree-supabase.sql`。
4. 如果不使用打包脚本，也可以按文件名顺序执行 `sql/*.sql`，并确认 `000_core_tables.sql` 最先执行。
5. 在 Authentication 里开启 Email 登录。
6. 部署完成拿到线上域名后，把 Auth 的 Site URL 设置为线上域名。
7. 在 Auth 的 Redirect URLs 里加入线上域名，例如 `https://your-domain.example.com`。

## 2. 云端环境变量

这些变量需要配置在云平台里。前端会通过 `/runtime-config.js` 在运行时读取公开 Supabase 配置，因此 Docker 镜像不需要为不同环境重新构建。

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-or-legacy-anon-key

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-secret-or-legacy-service-role-key

LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-xxx

# 或改用 OpenAI
# LLM_PROVIDER=openai
# OPENAI_API_KEY=sk-xxx
# OPENAI_MODEL_CHAT=gpt-4o-mini
# OPENAI_MODEL_REASONER=gpt-4o

LLM_TIMEOUT_MS=45000
```

Supabase 新版 API Keys 页面里，`VITE_SUPABASE_ANON_KEY` 可以填 publishable key，`SUPABASE_SERVICE_ROLE_KEY` 可以填 secret key。旧项目也可以继续使用 legacy `anon` 和 `service_role`。

## 3. Render / Railway / 类似 Node 平台

部署前可以先检查环境变量：

```bash
npm run cloud:check
```

Build command:

```bash
npm ci && npm run build
```

Start command:

```bash
npm start
```

Health check:

```text
/health
```

平台需要使用 Node 22 或更高版本。

## 4. Docker 平台

仓库包含 `Dockerfile`。

```bash
docker build -t focustree .
docker run --env-file .env -p 3001:3001 focustree
```

本地访问：

```text
http://127.0.0.1:3001
```

云端访问时使用平台分配的 HTTPS 域名。

## 4.1 阿里云 ECS

如果使用已有 ECS，推荐走 `deploy/ecs`：

```bash
cd deploy/ecs
cp .env.example .env
# 填写域名、Supabase、DeepSeek 等配置
./bootstrap-docker.sh
./deploy.sh
```

详细步骤见 [deploy/ecs/README.md](./deploy/ecs/README.md)。

## 5. 部署后验收

自动验收：

```bash
npm run cloud:smoke -- https://你的域名 --require-readiness
```

1. 打开 `https://你的域名/health`，应返回 `ok: true`。
2. 打开 `https://你的域名/readiness`，应返回 `ok: true`。
3. 打开 `https://你的域名`，应显示 FocusTree 页面。
4. 注册或登录一个测试账号。
5. 右键或 AI 创建一个项目节点。
6. 刷新页面后确认项目仍然存在。
7. 点击生成今日聚焦，确认 AI 接口可用。

如果 `/health` 里 `llm_configured` 或 `supabase_configured` 是 `false`，说明云平台环境变量还没配完整。
如果 `/readiness` 不是 `ok: true`，通常是 Supabase service role、数据库迁移或 RLS 配置还没完成。
