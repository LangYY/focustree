# 阿里云 ECS 部署 FocusTree

这套部署使用 Docker Compose：

- `app`：FocusTree Node 服务，监听容器内 `3001`
- `caddy`：反向代理和自动 HTTPS，监听公网 `80/443`

## 1. ECS 前置条件

在阿里云控制台确认：

1. ECS 有公网 IP。
2. 安全组放行 TCP `80` 和 `443`。
3. 域名已备案或当前解析/访问符合你的使用场景。
4. 域名 A 记录指向 ECS 公网 IP，例如 `focus.example.com -> 1.2.3.4`。

## 2. 拷贝代码到 ECS

推荐放在：

```bash
/opt/focustree
```

可以用 `git clone`，也可以从本机打包上传。

## 3. 配置环境变量

```bash
cd /opt/focustree/deploy/ecs
cp .env.example .env
nano .env
```

必须填写：

```env
FOCUSTREE_DOMAIN=focus.example.com
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=...
```

## 4. 安装 Docker

```bash
cd /opt/focustree/deploy/ecs
chmod +x bootstrap-docker.sh deploy.sh
./bootstrap-docker.sh
```

如果脚本提示需要重新登录，让当前 SSH 退出再重新登录。

## 5. 准备 Supabase

在本机或 ECS 上生成整合 SQL：

```bash
npm run db:bundle
```

把 `dist/focustree-supabase.sql` 整份复制到 Supabase SQL Editor 执行。

## 6. 启动

```bash
cd /opt/focustree/deploy/ecs
./deploy.sh
```

查看状态：

```bash
docker compose ps
docker compose logs -f app
docker compose logs -f caddy
```

## 7. Supabase Auth 回跳

服务上线后，在 Supabase Dashboard 设置：

- Site URL: `https://focus.example.com`
- Redirect URLs: `https://focus.example.com`

## 8. 验收

```bash
npm run cloud:smoke -- https://focus.example.com --require-readiness
```

然后打开浏览器访问：

```text
https://focus.example.com
```
