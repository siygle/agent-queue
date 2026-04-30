# agent-queue

Cloudflare Queues based async task bus for Pi agents.

## Packages

- `@siygle/agent-queue-shared` — shared schemas, IDs, HMAC helpers.
- `@siygle/agent-queue-hub-worker` — Cloudflare Worker gateway/router using Queues + D1.
- `@siygle/pi-agent-queue-extension` — Pi extension that polls tasks, runs them, and reports results.

## MVP flow

1. `POST /tasks` creates a task in D1 and enqueues it.
2. Queue consumer routes task to an agent inbox.
3. Pi extension polls `GET /agents/:agentId/tasks/next`.
4. Pi handles task and calls `complete_queue_task`.
5. Extension posts `POST /tasks/:taskId/result`.

## Quick commands

```bash
pnpm install
pnpm build
pnpm test
```

## Cloudflare setup

```bash
cd packages/hub-worker
wrangler queues create agent-incoming
wrangler queues create agent-results
wrangler d1 create agent-queue
# copy database_id into wrangler.toml
wrangler d1 execute agent-queue --file schema/d1-init.sql
wrangler secret put HUB_TOKEN
pnpm deploy
```

## Create a task

```bash
curl -X POST https://agent.sylee.dev/tasks \
  -H "Authorization: Bearer $HUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"target":"pi-market","prompt":"Summarize today market focus"}'
```
