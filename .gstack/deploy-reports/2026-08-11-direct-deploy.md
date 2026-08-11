# Direct deployment — 2026-08-11

- Branch: `feature/priority-engine-v2`
- Commit: `dbe3756`
- Command: `scripts/deploy-ecs.sh --full`
- Target: `root@8.153.96.57:/opt/focustree`
- Result: deployed successfully

## Deployment

- Local Vite build passed.
- `dist/`, `server/`, `package.json`, `package-lock.json`, and `sql/` synchronized.
- Remote `npm ci --omit=dev` completed.
- `dist` switched atomically.
- `focustree.service` restarted and reported `active`.
- Deployment script `/health` check returned HTTP 200.

## Canary

- `npm run cloud:smoke -- https://focus.buzzegg.cn --require-readiness` passed on the final run.
- `/health`, `/readiness`, `/runtime-config.js`, `/`, and SPA fallback all passed.
- Managed browser loaded the login page with HTTP 200, `document.readyState=complete`, title `专注树`, and expected login/register copy; screenshot captured.
- The first post-deploy readiness probe briefly returned 503 for `priority_analysis_runs`; an immediate retry returned 200 with every table healthy.

## Notes

- Remote `npm ci --omit=dev` reported 5 dependency vulnerabilities: 1 low, 1 moderate, 1 high, and 2 critical. No automatic audit fix was run.
- No new commit was created during this retry. The deployment used the existing `dbe3756` revision.
