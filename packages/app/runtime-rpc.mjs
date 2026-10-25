import { ContractError, MAX_RPC_BYTES, publicError, validateRequest } from "../contracts/runtime.mjs";

export class EventJournal {
  constructor(streamId, { maxEvents = 256, maxBytes = MAX_RPC_BYTES } = {}) {
    this.streamId = streamId; this.maxEvents = maxEvents; this.maxBytes = maxBytes;
    this.seq = 0; this.rows = []; this.bytes = 0; this.revisions = new Map();
  }
  append(name, payload) {
    if (!["user", "reasoning", "status", "delta", "queue", "done", "tool_receipt"].includes(name)) throw new ContractError("event_type_invalid");
    const entityId = name === "tool_receipt" && payload?.receipt?.tool_call_id
      ? `tool:${payload.receipt.tool_call_id}`
      : String(payload?.event?.id || payload?.message?.id || this.streamId);
    const revision = (this.revisions.get(entityId) || 0) + 1;
    const event = { v: 1, streamId: this.streamId, seq: this.seq + 1, entityId, revision, name, payload: structuredClone(payload) };
    const bytes = Buffer.byteLength(JSON.stringify(event));
    if (bytes > this.maxBytes) throw new ContractError("event_too_large");
    while (this.rows.length >= this.maxEvents || this.bytes + bytes > this.maxBytes) {
      // Only presentation updates are expendable; approval/artifact/commit
      // evidence must be acknowledged or the producer stops on backpressure.
      const index = this.rows.findIndex(row => ["status", "delta", "queue"].includes(row.event.name));
      if (index < 0) throw new ContractError("event_backpressure");
      this.bytes -= this.rows[index].bytes; this.rows.splice(index, 1);
    }
    this.seq++; this.revisions.set(entityId, revision);
    this.rows.push({ event, bytes }); this.bytes += bytes;
    return event;
  }
  replay(afterSeq) {
    const events = this.rows.filter(row => row.event.seq > afterSeq).map(row => structuredClone(row.event));
    let expected = afterSeq + 1;
    let gap = afterSeq > this.seq;
    for (const event of events) { if (event.seq !== expected) gap = true; expected = event.seq + 1; }
    if (expected <= this.seq) gap = true;
    return { events, gap, lastSeq: this.seq, requiresSnapshot: gap };
  }
  acknowledge(seq) {
    if (seq > this.seq) throw new ContractError("invalid_sequence");
    this.rows = this.rows.filter(row => row.event.seq > seq);
    this.bytes = this.rows.reduce((sum, row) => sum + row.bytes, 0);
    return { acknowledged: seq };
  }
}

export function isTrustedFrame(event, allowedURL) {
  try {
    const frame = event.senderFrame;
    if (!frame || event.sender.isDestroyed() || frame !== event.sender.mainFrame) return false;
    const actual = new URL(frame.url), allowed = new URL(allowedURL);
    actual.hash = ""; allowed.hash = "";
    return actual.href === allowed.href;
  } catch { return false; }
}

export class RuntimeRpc {
  constructor(host, { workspaceId = "local", maxStreams = 64 } = {}) {
    this.host = host; this.workspaceId = workspaceId; this.maxStreams = maxStreams;
    this.streams = new Map(); this.scopes = new Map();
  }
  owned(id, owner) {
    const stream = this.streams.get(id);
    if (!stream || stream.owner !== owner) throw new ContractError("stream_not_found");
    return stream;
  }
  async dispatch(raw, owner, notify = () => {}) {
    try {
      const request = validateRequest(raw, this.workspaceId);
      const { id, method, payload } = request;
      if (method === "agent.events") return { ok: true, result: this.owned(payload.streamId, owner).journal.replay(payload.afterSeq) };
      if (method === "agent.ack") return { ok: true, result: this.owned(payload.streamId, owner).journal.acknowledge(payload.afterSeq) };
      if (method === "agent.cancel") {
        const stream = this.owned(payload.requestId, owner);
        if (stream.active) this.host.cancel(payload.requestId);
        return { ok: true, result: { requested: stream.active } };
      }
      if (method === "agent.steer") {
        const task = [...this.streams.values()].find(item => item.active && item.owner === owner && item.runId === payload.runId);
        if (!task) throw new ContractError("task_not_owned");
        return { ok: true, result: await this.host.steerTask(payload.runId, payload) };
      }
      if (this.streams.has(id)) throw new ContractError("duplicate_request");
      const scope = payload.conversationId ? `conversation:${payload.conversationId}` : payload.jobId ? `job:${payload.jobId}` : `run:${payload.runId}`;
      if (this.scopes.has(scope)) throw new ContractError("conversation_busy");
      if ([...this.streams.values()].filter(item => item.active).length >= 2) throw new ContractError("runtime_busy");
      if (this.streams.size >= this.maxStreams) {
        const old = [...this.streams].find(([, stream]) => !stream.active);
        if (!old) throw new ContractError("runtime_busy");
        this.streams.delete(old[0]);
      }
      const stream = { owner, scope, runId: payload.runId, journal: new EventJournal(id), active: true };
      this.streams.set(id, stream); this.scopes.set(scope, id);
      const finish = () => { stream.active = false; clearTimeout(stream.timer); if (this.scopes.get(scope) === id) this.scopes.delete(scope); };
      stream.finish = finish;
      stream.timer = setTimeout(() => this.host.cancel(id), request.deadlineMs - Date.now());
      stream.timer.unref?.();
      const emit = (name, value) => {
        let event;
        try { event = stream.journal.append(name, value); }
        catch (error) { this.host.cancel(id); throw error; }
        // Observer failure must not retry or change the business operation.
        try { notify(event); } catch { /* journal can be fetched independently */ }
        if (name === "done") finish();
      };
      try {
        if (method === "agent.task") {
          const result = await this.host.startTask({ ...payload, requestId: id, onSettled: finish }, emit);
          if(typeof result?.run_id==='string') stream.runId=result.run_id;
          return { ok: true, result };
        }
        const result = await this.host.run({ ...payload, requestId: id }, emit);
        finish(); return { ok: true, result };
      } catch (error) { finish(); throw error; }
    } catch (error) { return { ok: false, error: publicError(error) }; }
  }
  disposeOwner(owner) {
    for (const [id, stream] of this.streams) {
      if (stream.owner !== owner) continue;
      if (stream.active) this.host.cancel(id);
      // Keep active scope occupied until the underlying call actually settles.
      if (!stream.active) this.streams.delete(id);
    }
  }
}
