import type { AgentRegistration, ApiResponse, CompleteTaskRequest, CreateTaskRequest, QueueTask } from "@siygle/agent-queue-shared";
import type { QueueExtensionConfig } from "./config";

export class AgentQueueClient {
  constructor(private readonly config: QueueExtensionConfig) {}

  async register(agent: AgentRegistration): Promise<void> {
    await this.request("/agents/register", { method: "POST", body: agent });
  }

  async heartbeat(): Promise<void> {
    await this.request(`/agents/${encodeURIComponent(this.config.agentId)}/heartbeat`, { method: "POST", body: {} });
  }

  async nextTask(): Promise<QueueTask | null> {
    const res = await this.request<QueueTask | null>(`/agents/${encodeURIComponent(this.config.agentId)}/tasks/next`);
    return res.data ?? null;
  }

  async completeTask(taskId: string, body: CompleteTaskRequest): Promise<void> {
    await this.request(`/tasks/${encodeURIComponent(taskId)}/result`, { method: "POST", body });
  }

  async createTask(body: CreateTaskRequest): Promise<string> {
    const res = await this.request<{ taskId: string }>("/tasks", { method: "POST", body });
    return res.data?.taskId ?? "";
  }

  async publishTopic(topic: string, body: Omit<CreateTaskRequest, "topic" | "target">): Promise<string> {
    const res = await this.request<{ taskId: string }>(`/topics/${encodeURIComponent(topic)}/publish`, { method: "POST", body });
    return res.data?.taskId ?? "";
  }

  private async request<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<ApiResponse<T>> {
    const response = await fetch(`${this.config.hubUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        authorization: `Bearer ${this.config.token}`,
        "content-type": "application/json",
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const data = (await response.json()) as ApiResponse<T>;
    if (!response.ok || !data.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
    return data;
  }
}
