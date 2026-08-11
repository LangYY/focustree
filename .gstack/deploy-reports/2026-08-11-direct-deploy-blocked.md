# Direct deployment attempt — 2026-08-11

- Branch: `feature/priority-engine-v2`
- Commit: `dbe3756`
- Approval: user explicitly authorized publishing
- Command: `scripts/deploy-ecs.sh --full`
- Result: blocked before the first remote SSH command

## Evidence

- `focus.buzzegg.cn` resolves to `8.153.96.57`, matching the deployment script.
- TCP 22 and 443 are reachable, but SSH banner and HTTPS handshakes time out.
- WSL, Git Bash, and Windows native OpenSSH all reproduce the SSH banner timeout.
- `npm run cloud:smoke -- https://focus.buzzegg.cn --require-readiness` returns `fetch failed`.

The local production build completed successfully. No remote `dist` switch, server upload, production dependency install, or `focustree.service` restart was confirmed. Retry the same `--full` deployment after the ECS SSH/Nginx/network entry point recovers.
