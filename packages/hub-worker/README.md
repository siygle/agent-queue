# agent-queue hub worker

Cloudflare Worker gateway/router for Pi agent tasks.

## Setup

```bash
pnpm install
cd packages/hub-worker

wrangler queues create agent-incoming
wrangler queues create agent-results
wrangler d1 create agent-queue
# copy database_id into wrangler.toml
wrangler d1 execute agent-queue --file schema/d1-init.sql
wrangler secret put HUB_TOKEN
wrangler secret put CALLBACK_SECRET # optional
pnpm deploy
```

## MVP API

- `POST /tasks` — create task: `{ "target": "pi-market", "prompt": "..." }`
- `GET /tasks/:id` — get task status/result
- `GET /agents/:agentId/tasks/next` — Pi extension pulls next task
- `POST /tasks/:id/result` — Pi extension reports completion
- `POST /topics/:topic/subscribe` — subscribe an agent
- `POST /topics/:topic/publish` — publish task to topic subscribers

All non-health endpoints require `Authorization: Bearer <HUB_TOKEN>`.
