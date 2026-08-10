#!/usr/bin/env bash
#
# 在本机构建，把产物传到 ECS。构建这一步不在服务器上跑。
#
# 为什么：ECS 是 2 核 / 1.6 GB，上面还跑着 MariaDB 和另外 5 个 Node 应用，
# 空闲内存不到 900 MB。而 vite 构建这个项目（2442 个模块）峰值要几百 MB 到 1 GB，
# 在这台机器上跑有把其他服务一起 OOM 掉的风险。产物只有 750 KB，传上去就行。
#
# 用法：
#   scripts/deploy-ecs.sh              # 只更新前端（零停机，不重启服务）
#   scripts/deploy-ecs.sh --full       # 同时更新 server/ 代码并重启服务
#   scripts/deploy-ecs.sh --dry-run    # 只传到 dist.new/ 不切换，用于验证通道
#
# 可用环境变量覆盖：
#   FT_HOST（默认 root@8.153.96.57）
#   FT_KEY （默认 ~/.ssh/focustree_ecs_ed25519）
#   FT_DIR （默认 /opt/focustree）

set -euo pipefail

HOST="${FT_HOST:-root@8.153.96.57}"
KEY="${FT_KEY:-$HOME/.ssh/focustree_ecs_ed25519}"
REMOTE_DIR="${FT_DIR:-/opt/focustree}"
SSH="ssh -i $KEY -o StrictHostKeyChecking=no -o ConnectTimeout=25"

FULL=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --full)    FULL=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# ── 1. 本机构建 ──────────────────────────────────────
echo "▸ 本机构建"
npm run build

if [ ! -f dist/index.html ]; then
  echo "构建产物缺失：dist/index.html 不存在" >&2
  exit 1
fi
echo "  产物大小：$(du -sh dist | cut -f1)"

# ── 2. 传输前端产物 ──────────────────────────────────
echo "▸ 上传 dist 到 $HOST:$REMOTE_DIR/dist.new"
$SSH "$HOST" "rm -rf $REMOTE_DIR/dist.new && mkdir -p $REMOTE_DIR/dist.new"
tar -czf - -C dist . | $SSH "$HOST" "tar -xzf - --no-same-owner -C $REMOTE_DIR/dist.new"

if [ "$DRY_RUN" = "1" ]; then
  echo "▸ dry-run：已上传到 dist.new，未切换。线上仍是旧版本。"
  $SSH "$HOST" "ls -la $REMOTE_DIR/dist.new/assets | head -5"
  echo "  清理：$SSH $HOST 'rm -rf $REMOTE_DIR/dist.new'"
  exit 0
fi

# ── 3. 可选：更新服务端代码 ───────────────────────────
if [ "$FULL" = "1" ]; then
  echo "▸ 上传 server/ 与依赖清单"
  tar -czf - server package.json package-lock.json sql \
    | $SSH "$HOST" "tar -xzf - --no-same-owner -C $REMOTE_DIR"

  echo "▸ 安装生产依赖（--omit=dev，跳过 vite/tailwind/eslint）"
  $SSH "$HOST" "cd $REMOTE_DIR && npm ci --omit=dev"
fi

# ── 4. 原子切换 dist ─────────────────────────────────
# express.static 每次请求才读磁盘，所以换掉目录即刻生效，前端更新无需重启。
echo "▸ 切换 dist"
$SSH "$HOST" "
  set -e
  cd $REMOTE_DIR
  rm -rf dist.old
  [ -d dist ] && mv dist dist.old
  mv dist.new dist
  if [ -d dist.old/assets ]; then
    cp -an dist.old/assets/. dist/assets/
  fi
"

# ── 5. 仅在服务端代码变化时重启 ────────────────────────
if [ "$FULL" = "1" ]; then
  echo "▸ 重启 focustree.service"
  $SSH "$HOST" "systemctl restart focustree && sleep 2 && systemctl is-active focustree"
fi

# ── 6. 验证 ─────────────────────────────────────────
echo "▸ 验证"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 https://focus.buzzegg.cn/health || echo 000)
if [ "$code" = "200" ]; then
  echo "  /health 200 · 部署完成"
  $SSH "$HOST" "rm -rf $REMOTE_DIR/dist.old"
else
  echo "  /health 返回 $code —— 线上可能有问题" >&2
  echo "  回滚：$SSH $HOST 'cd $REMOTE_DIR && rm -rf dist && mv dist.old dist'" >&2
  exit 1
fi
