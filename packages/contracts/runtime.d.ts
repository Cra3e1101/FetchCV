export type Scope = { workspaceId: string; candidateId?: string; jobId?: string };
export type Reference = { kind: 'document' | 'message' | 'artifact'; id: string; version: number };
export type RuntimeRequest = { v: 1; id: string; method: 'agent.turn' | 'agent.cancel' | 'agent.task' | 'agent.steer' | 'agent.events' | 'agent.ack'; workspaceId: string; deadlineMs: number; payload: Record<string, unknown> };
export type RuntimeEvent = { v: 1; streamId: string; seq: number; entityId: string; revision: number; name: 'user' | 'reasoning' | 'status' | 'delta' | 'queue' | 'done'; payload: Record<string, unknown> };
export interface RuntimeHost {
  invoke(call: { runId: string; callId: string; toolId: string; args: unknown }, signal: AbortSignal): Promise<{ callId: string; status: 'ok' | 'denied' | 'unknown'; content: unknown; receiptId: string }>;
  emit(event: RuntimeEvent): Promise<void>;
}
