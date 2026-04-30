# Pi Agent Queue Extension

Pi extension that polls the Cloudflare queue hub for tasks and reports completion.

## Install

```bash
cd ~/.pi/agent/extensions
git clone https://github.com/siygle/agent-queue pi-agent-queue
# or install as a Pi package once published
```

## Env

```bash
export PI_AGENT_ID=pi-market
export PI_AGENT_QUEUE_URL=https://agent.sylee.dev
export PI_AGENT_TOKEN=<same as HUB_TOKEN or agent-scoped token>
export PI_AGENT_POLL_INTERVAL_MS=3000
export PI_AGENT_CAPABILITIES=market,stocks,research
```

Reload Pi with `/reload`.

## Commands

- `/queue-status`
- `/queue-pause`
- `/queue-resume`

## Tools

- `complete_queue_task` — required final tool call for queued tasks
- `queue_publish_task` — publish to a target agent
- `queue_publish_topic` — publish to a subscribed topic
