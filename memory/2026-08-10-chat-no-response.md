# Root-cause investigation — AI assistant no response (2026-08-10)

## Scope

Investigation only. No application code, deployment, database, cloud `.env`, credentials, or git commit was changed. No credentials were requested or used.

## Conclusion

The public backend and DeepSeek provider are currently reachable and can complete an agent request. The strongest code-level failure path is in `useChat.sendMessage`: it sets the loading state and awaits the user-scoped Supabase `conversations` insert before calling `/api/agent`. That await is outside the main error/finally boundary and has no timeout. If session/network/RLS makes that insert hang or reject, the browser sends no `/api/agent` request and can remain in the waiting state without an assistant reply or cleanup.

There is also verified provider-side intermittency: recent ECS logs show one agent request taking about 46 seconds before succeeding and another receiving empty content twice before succeeding on retry 3. This explains a long apparent wait when `/api/agent` is already pending, but does not indicate a current provider outage.

## Evidence

- `ChatPanel.handleSend` invokes `onSend` for non-empty input and clears the input; `useChat.sendMessage` sets loading before the Supabase conversation insert.
- The insert precedes local command handling and `callAgent`; its await is not protected by the later `try/finally`.
- Public `/health`: HTTP 200, `llm_configured`, public Supabase, and service Supabase all true.
- Public `/readiness`: HTTP 200; all checked tables, including `conversations`, passed.
- A bounded unauthenticated probe with a synthetic `ping` payload reached `/api/agent` and returned HTTP 200 JSON in about 7.8 seconds, with `model_used=deepseek-v4-flash` and a non-empty reply.
- ECS logs show `/api/agent`, provider success, and retry behavior; no client-disconnect or all-attempt failure was observed in the bounded log window.

## How to distinguish the incident

- No `/api/agent` in the browser Network panel after Send: the pre-agent Supabase insert/session path is the confirmed code-level explanation.
- `/api/agent` pending for tens of seconds: provider latency or the observed empty-content retries are involved.
- `/api/agent` returns 200 JSON: route/provider/JSON parsing succeeded; inspect client response state/rendering next.
- HTTP error: capture status/body and correlate with the server request log; do not infer a provider failure from the UI alone.

The exact authenticated user incident cannot be attributed to one branch without that Network-panel observation; the controlled browser was intentionally left unauthenticated.

