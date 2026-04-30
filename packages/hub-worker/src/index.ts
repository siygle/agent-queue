import {
  assertAgentRegistration,
  assertCompleteTaskRequest,
  assertCreateTaskRequest,
  createId,
  nowIso,
  signBody,
  type AgentRegistration,
  type CompleteTaskRequest,
  type CreateTaskRequest,
  type QueueTask,
} from "@siygle/agent-queue-shared";

export interface Env {
  DB: D1Database;
  AGENT_INCOMING: Queue<QueueTask>;
  AGENT_RESULTS: Queue<Record<string, unknown>>;
  HUB_TOKEN: string;
  CALLBACK_SECRET?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  },

  async queue(batch: MessageBatch<QueueTask | Record<string, unknown>>, env: Env): Promise<void> {
    if (batch.queue === "agent-incoming") {
      await consumeIncoming(batch as MessageBatch<QueueTask>, env);
      return;
    }
    if (batch.queue === "agent-results") {
      await consumeResults(batch as MessageBatch<Record<string, unknown>>, env);
    }
  },
};

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return json({ ok: true, service: "agent-queue-hub" });
  }

  if (!isAuthorized(request, env)) return json({ ok: false, error: "Unauthorized" }, 401);

  if (request.method === "POST" && url.pathname === "/tasks") return createTask(request, env);
  if (request.method === "GET" && url.pathname.startsWith("/tasks/")) return getTask(url.pathname.split("/")[2], env);
  if (request.method === "POST" && url.pathname.match(/^\/tasks\/[^/]+\/result$/)) {
    return completeTask(url.pathname.split("/")[2], request, env);
  }
  if (request.method === "POST" && url.pathname.match(/^\/tasks\/[^/]+\/cancel$/)) {
    return cancelTask(url.pathname.split("/")[2], env);
  }
  if (request.method === "POST" && url.pathname === "/agents/register") return registerAgent(request, env);
  if (request.method === "POST" && url.pathname.match(/^\/agents\/[^/]+\/heartbeat$/)) {
    return heartbeat(url.pathname.split("/")[2], env);
  }
  if (request.method === "GET" && url.pathname.match(/^\/agents\/[^/]+\/tasks\/next$/)) {
    return nextTask(url.pathname.split("/")[2], env);
  }
  if (request.method === "POST" && url.pathname.match(/^\/topics\/[^/]+\/subscribe$/)) {
    return subscribe(decodeURIComponent(url.pathname.split("/")[2]), request, env);
  }
  if (request.method === "POST" && url.pathname.match(/^\/topics\/[^/]+\/publish$/)) {
    return publishTopic(decodeURIComponent(url.pathname.split("/")[2]), request, env);
  }

  return json({ ok: false, error: "Not found" }, 404);
}

function isAuthorized(request: Request, env: Env): boolean {
  const token = request.headers.get("authorization");
  return Boolean(env.HUB_TOKEN && token === `Bearer ${env.HUB_TOKEN}`);
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  return text ? JSON.parse(text) : {};
}

async function createTask(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  assertCreateTaskRequest(body);
  const task = await insertTask(env, body);
  await env.AGENT_INCOMING.send(task);
  await addEvent(env, task.id, "created", "Task created");
  return json({ ok: true, data: { taskId: task.id, task } }, 201);
}

async function publishTopic(topic: string, request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (!body || typeof body !== "object") throw new Error("Request body must be an object");
  const raw = body as Record<string, unknown>;
  const taskReq: CreateTaskRequest = { ...raw, topic, target: undefined } as CreateTaskRequest;
  assertCreateTaskRequest(taskReq);
  const task = await insertTask(env, taskReq);
  await env.AGENT_INCOMING.send(task);
  await addEvent(env, task.id, "created", `Topic task created for ${topic}`);
  return json({ ok: true, data: { taskId: task.id, task } }, 201);
}

async function insertTask(env: Env, req: CreateTaskRequest): Promise<QueueTask> {
  const timestamp = nowIso();
  const task: QueueTask = {
    id: createId("task"),
    status: "queued",
    prompt: req.prompt,
    target: req.target ?? null,
    topic: req.topic ?? null,
    source: req.source ?? null,
    requester: req.requester ?? null,
    payload: req.payload ?? null,
    options: req.options ?? {},
    callbackUrl: req.callbackUrl ?? null,
    assignedAgent: null,
    result: null,
    error: null,
    attempts: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: null,
    completedAt: null,
  };

  await env.DB.prepare(
    `INSERT INTO tasks (id,status,source,target,topic,prompt,payload,options,callback_url,requester,attempts,created_at,updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`,
  )
    .bind(
      task.id,
      task.status,
      task.source,
      task.target,
      task.topic,
      task.prompt,
      JSON.stringify(task.payload),
      JSON.stringify(task.options),
      task.callbackUrl,
      task.requester,
      task.attempts,
      task.createdAt,
      task.updatedAt,
    )
    .run();
  return task;
}

async function getTask(taskId: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?1").bind(taskId).first<Record<string, unknown>>();
  if (!row) return json({ ok: false, error: "Task not found" }, 404);
  return json({ ok: true, data: rowToTask(row) });
}

async function registerAgent(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  assertAgentRegistration(body);
  const agent: AgentRegistration = body;
  const timestamp = nowIso();
  await env.DB.prepare(
    `INSERT INTO agents (id,name,capabilities,status,last_heartbeat_at,created_at,updated_at)
     VALUES (?1,?2,?3,'online',?4,?4,?4)
     ON CONFLICT(id) DO UPDATE SET name=?2, capabilities=?3, status='online', last_heartbeat_at=?4, updated_at=?4`,
  )
    .bind(agent.id, agent.name ?? null, JSON.stringify(agent.capabilities ?? []), timestamp)
    .run();
  return json({ ok: true, data: { agentId: agent.id } });
}

async function heartbeat(agentId: string, env: Env): Promise<Response> {
  const timestamp = nowIso();
  await env.DB.prepare("UPDATE agents SET status='online', last_heartbeat_at=?1, updated_at=?1 WHERE id=?2")
    .bind(timestamp, agentId)
    .run();
  return json({ ok: true, data: { agentId, at: timestamp } });
}

async function subscribe(topic: string, request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (!body || typeof body !== "object" || typeof (body as Record<string, unknown>).agentId !== "string") {
    throw new Error("agentId is required");
  }
  const agentId = (body as { agentId: string }).agentId;
  await env.DB.prepare("INSERT OR IGNORE INTO subscriptions (topic,agent_id,created_at) VALUES (?1,?2,?3)")
    .bind(topic, agentId, nowIso())
    .run();
  return json({ ok: true, data: { topic, agentId } });
}

async function nextTask(agentId: string, env: Env): Promise<Response> {
  const inbox = await env.DB.prepare(
    "SELECT task_id FROM agent_inbox WHERE agent_id=?1 ORDER BY id ASC LIMIT 1",
  )
    .bind(agentId)
    .first<{ task_id: string }>();
  if (!inbox) return json({ ok: true, data: null });

  const timestamp = nowIso();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM agent_inbox WHERE agent_id=?1 AND task_id=?2").bind(agentId, inbox.task_id),
    env.DB.prepare(
      "UPDATE tasks SET status='running', assigned_agent=?1, started_at=COALESCE(started_at, ?2), updated_at=?2 WHERE id=?3",
    ).bind(agentId, timestamp, inbox.task_id),
  ]);
  await addEvent(env, inbox.task_id, "running", `Assigned to ${agentId}`);
  const row = await env.DB.prepare("SELECT * FROM tasks WHERE id=?1").bind(inbox.task_id).first<Record<string, unknown>>();
  return json({ ok: true, data: row ? rowToTask(row) : null });
}

async function completeTask(taskId: string, request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  assertCompleteTaskRequest(body);
  const req: CompleteTaskRequest = body;
  const timestamp = nowIso();
  await env.DB.prepare(
    "UPDATE tasks SET status=?1, result=?2, error=?3, completed_at=?4, updated_at=?4 WHERE id=?5",
  )
    .bind(req.status, req.result ?? req.summary ?? null, req.error ?? null, timestamp, taskId)
    .run();
  await addEvent(env, taskId, req.status, req.summary ?? req.error ?? "Task finished");
  const taskRow = await env.DB.prepare("SELECT * FROM tasks WHERE id=?1").bind(taskId).first<Record<string, unknown>>();
  const task = taskRow ? rowToTask(taskRow) : null;
  await env.AGENT_RESULTS.send({ taskId, status: req.status, task });
  return json({ ok: true, data: { taskId, status: req.status } });
}

async function cancelTask(taskId: string, env: Env): Promise<Response> {
  const timestamp = nowIso();
  await env.DB.prepare("UPDATE tasks SET status='cancelled', updated_at=?1, completed_at=?1 WHERE id=?2")
    .bind(timestamp, taskId)
    .run();
  await addEvent(env, taskId, "cancelled", "Task cancelled");
  return json({ ok: true, data: { taskId, status: "cancelled" } });
}

async function consumeIncoming(batch: MessageBatch<QueueTask>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    const task = message.body;
    try {
      const agents = await resolveAgents(task, env);
      if (agents.length === 0) {
        await failTask(env, task.id, `No agent subscription/target for task`);
        message.ack();
        continue;
      }
      const timestamp = nowIso();
      const statements: D1PreparedStatement[] = [
        env.DB.prepare("UPDATE tasks SET status='assigned', updated_at=?1 WHERE id=?2").bind(timestamp, task.id),
      ];
      for (const agentId of agents) {
        statements.push(
          env.DB.prepare("INSERT OR IGNORE INTO agent_inbox (agent_id, task_id, created_at) VALUES (?1,?2,?3)").bind(
            agentId,
            task.id,
            timestamp,
          ),
        );
      }
      await env.DB.batch(statements);
      await addEvent(env, task.id, "assigned", `Assigned to ${agents.join(", ")}`);
      message.ack();
    } catch (err) {
      console.error("consumeIncoming failed", err);
      message.retry();
    }
  }
}

async function resolveAgents(task: QueueTask, env: Env): Promise<string[]> {
  if (task.target) return [task.target.replace(/^agent:/, "")];
  if (!task.topic) return [];
  const result = await env.DB.prepare("SELECT agent_id FROM subscriptions WHERE topic=?1").bind(task.topic).all<{ agent_id: string }>();
  return result.results.map((row) => row.agent_id);
}

async function consumeResults(batch: MessageBatch<Record<string, unknown>>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    const task = (message.body as { task?: QueueTask }).task;
    if (task?.callbackUrl) {
      try {
        await sendCallback(task, env);
      } catch (err) {
        console.error("callback failed", err);
        message.retry();
        continue;
      }
    }
    message.ack();
  }
}

async function sendCallback(task: QueueTask, env: Env): Promise<void> {
  if (!task.callbackUrl) return;
  const body = JSON.stringify({ taskId: task.id, status: task.status, result: task.result, error: task.error });
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (env.CALLBACK_SECRET) headers["x-agent-queue-signature-256"] = await signBody(env.CALLBACK_SECRET, body);
  const res = await fetch(task.callbackUrl, { method: "POST", headers, body });
  if (!res.ok) throw new Error(`Callback failed: ${res.status}`);
}

async function failTask(env: Env, taskId: string, error: string): Promise<void> {
  await env.DB.prepare("UPDATE tasks SET status='failed', error=?1, updated_at=?2, completed_at=?2 WHERE id=?3")
    .bind(error, nowIso(), taskId)
    .run();
  await addEvent(env, taskId, "failed", error);
}

async function addEvent(env: Env, taskId: string, type: string, message: string): Promise<void> {
  await env.DB.prepare("INSERT INTO task_events (task_id,type,message,created_at) VALUES (?1,?2,?3,?4)")
    .bind(taskId, type, message, nowIso())
    .run();
}

function rowToTask(row: Record<string, unknown>): QueueTask {
  return {
    id: String(row.id),
    status: row.status as QueueTask["status"],
    prompt: String(row.prompt),
    target: nullableString(row.target),
    topic: nullableString(row.topic),
    source: nullableString(row.source),
    requester: nullableString(row.requester),
    payload: parseJson(row.payload),
    options: parseJson(row.options) as QueueTask["options"],
    callbackUrl: nullableString(row.callback_url),
    assignedAgent: nullableString(row.assigned_agent),
    result: nullableString(row.result),
    error: nullableString(row.error),
    attempts: Number(row.attempts ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    startedAt: nullableString(row.started_at),
    completedAt: nullableString(row.completed_at),
  };
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
