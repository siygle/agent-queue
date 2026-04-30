export type TaskStatus = "queued" | "assigned" | "running" | "completed" | "failed" | "cancelled" | "timeout";
export type TaskPriority = "low" | "normal" | "high";

export interface TaskOptions {
  timeoutMs?: number;
  priority?: TaskPriority;
  cwd?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateTaskRequest {
  prompt: string;
  target?: string;
  topic?: string;
  source?: string;
  requester?: string;
  payload?: unknown;
  options?: TaskOptions;
  callbackUrl?: string;
}

export interface QueueTask {
  id: string;
  status: TaskStatus;
  prompt: string;
  target: string | null;
  topic: string | null;
  source: string | null;
  requester: string | null;
  payload: unknown;
  options: TaskOptions;
  callbackUrl: string | null;
  assignedAgent: string | null;
  result: string | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AgentRegistration {
  id: string;
  name?: string;
  capabilities?: string[];
}

export interface CompleteTaskRequest {
  status: "completed" | "failed";
  result?: string;
  error?: string;
  summary?: string;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(prefix: string): string {
  const random = crypto.getRandomValues(new Uint8Array(12));
  const suffix = [...random].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${Date.now().toString(36)}_${suffix}`;
}

export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signBody(secret: string, body: string): Promise<string> {
  return `sha256=${await hmacSha256Hex(secret, body)}`;
}

export async function verifySignature(secret: string, body: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const expected = await signBody(secret, body);
  return timingSafeEqual(expected, signature);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function assertCreateTaskRequest(value: unknown): asserts value is CreateTaskRequest {
  if (!value || typeof value !== "object") throw new Error("Request body must be an object");
  const body = value as Record<string, unknown>;
  if (typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
    throw new Error("prompt is required");
  }
  if (body.target !== undefined && typeof body.target !== "string") throw new Error("target must be a string");
  if (body.topic !== undefined && typeof body.topic !== "string") throw new Error("topic must be a string");
  if (!body.target && !body.topic) throw new Error("target or topic is required");
}

export function assertAgentRegistration(value: unknown): asserts value is AgentRegistration {
  if (!value || typeof value !== "object") throw new Error("Request body must be an object");
  const body = value as Record<string, unknown>;
  if (typeof body.id !== "string" || body.id.trim().length === 0) throw new Error("id is required");
}

export function assertCompleteTaskRequest(value: unknown): asserts value is CompleteTaskRequest {
  if (!value || typeof value !== "object") throw new Error("Request body must be an object");
  const body = value as Record<string, unknown>;
  if (body.status !== "completed" && body.status !== "failed") throw new Error("status must be completed or failed");
  if (body.result !== undefined && typeof body.result !== "string") throw new Error("result must be a string");
  if (body.error !== undefined && typeof body.error !== "string") throw new Error("error must be a string");
}
