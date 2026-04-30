import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "typebox";
import type { QueueTask } from "@siygle/agent-queue-shared";
import { AgentQueueClient } from "./client";
import { loadConfig } from "./config";

export default function (pi: ExtensionAPI) {
  const loadedConfig = loadConfig();
  if (!loadedConfig) {
    pi.on("session_start", async (_event, ctx) => {
      ctx.ui.notify("agent-queue disabled: set PI_AGENT_ID, PI_AGENT_QUEUE_URL, PI_AGENT_TOKEN", "warning");
    });
    return;
  }

  const config = loadedConfig;
  const client = new AgentQueueClient(config);
  let timer: ReturnType<typeof setInterval> | undefined;
  let activeTask: QueueTask | undefined;
  let paused = false;
  let polling = false;

  async function start() {
    await client.register({ id: config.agentId, name: config.agentId, capabilities: config.capabilities });
    await client.heartbeat();
    timer = setInterval(() => void tick(), config.pollIntervalMs);
    void tick();
  }

  async function tick() {
    if (paused || polling || activeTask) return;
    polling = true;
    try {
      await client.heartbeat();
      const task = await client.nextTask();
      if (task) {
        activeTask = task;
        pi.sendUserMessage(formatTaskPrompt(task), { deliverAs: "followUp" });
      }
    } catch (err) {
      console.error("[agent-queue] poll failed", err);
    } finally {
      polling = false;
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("agent-queue", `📬 ${config.agentId}`);
    try {
      await start();
      ctx.ui.notify(`Agent queue connected as ${config.agentId}`, "info");
    } catch (err) {
      ctx.ui.notify(`Agent queue failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  });

  pi.on("session_shutdown", async () => {
    if (timer) clearInterval(timer);
  });

  pi.registerTool({
    name: "complete_queue_task",
    label: "Complete Queue Task",
    description: "Mark the current Cloudflare queue task as completed or failed and send the result back to the hub.",
    promptSnippet: "Complete and report a Cloudflare Queue task result",
    promptGuidelines: [
      "When processing an agent-queue task, call complete_queue_task exactly once after finishing the task.",
    ],
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ID to complete" }),
      status: StringEnum(["completed", "failed"] as const),
      result: Type.Optional(Type.String({ description: "Final result for completed tasks" })),
      error: Type.Optional(Type.String({ description: "Error message for failed tasks" })),
      summary: Type.Optional(Type.String({ description: "Short summary" })),
    }),
    async execute(_toolCallId, params) {
      await client.completeTask(params.taskId, {
        status: params.status,
        result: params.result,
        error: params.error,
        summary: params.summary,
      });
      if (activeTask?.id === params.taskId) activeTask = undefined;
      return {
        content: [{ type: "text", text: `Queue task ${params.taskId} marked ${params.status}` }],
        details: { taskId: params.taskId, status: params.status },
      };
    },
  });

  pi.registerTool({
    name: "queue_publish_task",
    label: "Publish Queue Task",
    description: "Publish a new task to another Pi agent via the Cloudflare queue hub.",
    parameters: Type.Object({
      target: Type.String({ description: "Target agent id, e.g. pi-market" }),
      prompt: Type.String({ description: "Task prompt" }),
      source: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params) {
      const taskId = await client.createTask({ target: params.target, prompt: params.prompt, source: params.source ?? config.agentId });
      return { content: [{ type: "text", text: `Published task ${taskId} to ${params.target}` }], details: { taskId } };
    },
  });

  pi.registerTool({
    name: "queue_publish_topic",
    label: "Publish Queue Topic",
    description: "Publish a task to all agents subscribed to a topic via the Cloudflare queue hub.",
    parameters: Type.Object({
      topic: Type.String({ description: "Topic name" }),
      prompt: Type.String({ description: "Task prompt" }),
      source: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params) {
      const taskId = await client.publishTopic(params.topic, { prompt: params.prompt, source: params.source ?? config.agentId });
      return { content: [{ type: "text", text: `Published topic task ${taskId} to ${params.topic}` }], details: { taskId } };
    },
  });

  pi.registerCommand("queue-status", {
    description: "Show agent queue status",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        `Agent queue: ${paused ? "paused" : "running"}\nAgent: ${config.agentId}\nActive task: ${activeTask?.id ?? "none"}\nHub: ${config.hubUrl}`,
        "info",
      );
    },
  });

  pi.registerCommand("queue-pause", {
    description: "Pause queue polling",
    handler: async (_args, ctx) => {
      paused = true;
      ctx.ui.setStatus("agent-queue", `⏸ ${config.agentId}`);
      ctx.ui.notify("Agent queue paused", "info");
    },
  });

  pi.registerCommand("queue-resume", {
    description: "Resume queue polling",
    handler: async (_args, ctx) => {
      paused = false;
      ctx.ui.setStatus("agent-queue", `📬 ${config.agentId}`);
      ctx.ui.notify("Agent queue resumed", "info");
      void tick();
    },
  });
}

function formatTaskPrompt(task: QueueTask): string {
  const payload = task.payload === null ? "null" : JSON.stringify(task.payload, null, 2);
  return [
    "[Agent Queue Task]",
    `Task ID: ${task.id}`,
    `Source: ${task.source ?? "unknown"}`,
    `Requester: ${task.requester ?? "unknown"}`,
    "",
    task.prompt,
    "",
    "Payload:",
    "```json",
    payload,
    "```",
    "",
    "When finished, you MUST call the complete_queue_task tool exactly once with this taskId and the final result.",
  ].join("\n");
}
