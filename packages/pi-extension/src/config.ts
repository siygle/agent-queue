export interface QueueExtensionConfig {
  agentId: string;
  hubUrl: string;
  token: string;
  pollIntervalMs: number;
  capabilities: string[];
}

export function loadConfig(): QueueExtensionConfig | null {
  const agentId = process.env.PI_AGENT_ID;
  const hubUrl = process.env.PI_AGENT_QUEUE_URL;
  const token = process.env.PI_AGENT_TOKEN;
  if (!agentId || !hubUrl || !token) return null;
  return {
    agentId,
    hubUrl: hubUrl.replace(/\/$/, ""),
    token,
    pollIntervalMs: Number(process.env.PI_AGENT_POLL_INTERVAL_MS) || 3000,
    capabilities: (process.env.PI_AGENT_CAPABILITIES ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
