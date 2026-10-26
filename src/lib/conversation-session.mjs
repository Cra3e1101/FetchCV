import {mergeProcessingEvent} from './processing.js';

// A turn belongs to its conversation, not to the currently mounted view.
// Unsubscribing only detaches rendering; cancellation is an explicit action.
export function createConversationSessions(api) {
  const sessions = new Map();
  const forget = session => {
    for (const [key, value] of sessions) if (value === session) sessions.delete(key);
  };
  return {
    get(key, conversationId = null) {
      const existing = sessions.get(conversationId) || sessions.get(key);
      if (existing) return existing;
      // Bound completed, detached history without evicting running work.
      if (sessions.size > 32) for (const session of new Set(sessions.values())) {
        if (!session.getSnapshot().busy && !session.subscribers) forget(session);
      }
      const session = createSession(api, conversationId, id => sessions.set(id, session));
      sessions.set(key, session);
      return session;
    },
    async remove(id) {
      const session = sessions.get(id);
      if (!session) return;
      session.cancel();
      await session.settled;
      forget(session);
    },
  };
}

function createSession(api, conversationId, identify) {
  let state = {chat: null, messages: [], busy: false, stopping: false, finishing: false, loading: Boolean(conversationId), error: ''};
  const listeners = new Set();
  let controller = null, loading = null, settled = Promise.resolve(), revision = 0;
  const update = patch => {
    state = {...state, ...(typeof patch === 'function' ? patch(state) : patch)};
    for (const listener of listeners) listener();
  };
  const messages = fn => update(value => ({messages: fn(value.messages)}));
  const processing = fn => messages(items => items.map(item => item.id === 'streaming-assistant'
    ? {...item, metadata_json: fn(item.metadata_json || {})} : item));
  const session = {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    get subscribers() { return listeners.size; },
    get settled() { return settled; },
    cancel() { controller?.abort(); },
    async load() {
      if (state.busy || !conversationId) return;
      if (loading) return loading;
      const ticket = revision;
      loading = api.conversation(conversationId).then(chat => {
        if (ticket === revision && !state.busy) update({chat, messages: chat.messages, error: ''});
      }).catch(error => { if (ticket === revision) update({error: error.message}); })
        .finally(() => { loading = null; if (ticket === revision) update({loading: false}); });
      return loading;
    },
    async link(jobId, onChanged) {
      if (!state.chat || state.busy) return;
      try { update({chat: await api.linkConversation(state.chat.id, jobId), error: ''}); onChanged?.(); }
      catch (error) { update({error: error.message}); }
    },
    send(content, options = {}, onChanged) {
      if (controller || state.loading) return settled;
      revision += 1;
      const abort = new globalThis.AbortController();
      controller = abort;
      settled = run(content, options, onChanged, abort);
      return settled;
    },
  };
  async function run(content, options, onChanged, abort) {
    const pendingId = `pending-user:${globalThis.crypto.randomUUID()}`, startedAt = Date.now();
    let current = state.chat, finished = false, receivedDone = false, frame = null, buffer = '';
    const isCurrent = () => controller === abort;
    const clear = () => { if (frame !== null) globalThis.clearTimeout(frame); frame = null; buffer = ''; };
    const flush = () => {
      frame = null;
      const text = buffer; buffer = '';
      if (!text || !isCurrent() || abort.signal.aborted || finished) return;
      messages(items => items.map(item => item.id === 'streaming-assistant' ? {...item, content: item.content + text} : item));
    };
    const onAbort = () => { clear(); update({stopping: true}); processing(meta => ({...meta, processing_status: 'stopping'})); };
    abort.signal.addEventListener('abort', onAbort, {once: true});
    update({busy: true, stopping: false, finishing: false, error: ''});
    messages(items => [...items,
      {id: pendingId, role: 'user', content, metadata_json: {delivery_status: 'sending', attachment_paths: options.attachmentPaths || [], quoted_text: options.quote?.text || ''}},
      {id: 'streaming-assistant', role: 'assistant', content: '', metadata_json: {
        delivery_status: 'streaming', processing_status: 'running', processing_started_at: startedAt,
        processing_label: '正在理解你的问题', processing_trace: [], tool_receipts: [],
      }},
    ]);
    try {
      if (!current) {
        current = await api.createConversation();
        conversationId = current.id;
        identify(current.id);
        update({chat: current});
        onChanged?.();
        if (abort.signal.aborted) return;
      }
      await api.streamConversation(current.id, content, {...options, signal: abort.signal, onEvent(event, data) {
        if (!isCurrent() || abort.signal.aborted || finished) return;
        if (event === 'user') {
          messages(items => items.map(item => item.id === pendingId ? data.message : item));
          onChanged?.();
        }
        if (event === 'status') processing(meta => ({...meta, processing_label: data.label || meta.processing_label,
          processing_status: data.label === '等待联网批准' || meta.tool_receipts?.some(item => item.status === 'awaiting_approval') ? 'awaiting_approval' : 'running'}));
        if (event === 'reasoning') processing(meta => ({...meta, processing_trace: mergeProcessingEvent(meta.processing_trace, data.event)}));
        if (event === 'context_usage') processing(meta => ({...meta, context_usage: data.usage}));
        if (event === 'tool_receipt' && data.receipt?.tool_call_id) processing(meta => {
          const receipts = meta.tool_receipts || [], receipt = data.receipt;
          const next = receipts.some(item => item.tool_call_id === receipt.tool_call_id)
            ? receipts.map(item => item.tool_call_id === receipt.tool_call_id ? {...item, ...receipt} : item) : [...receipts, receipt];
          return {...meta, tool_receipts: next, processing_status: next.some(item => item.status === 'awaiting_approval') ? 'awaiting_approval' : 'running'};
        });
        if (event === 'delta' && data.text) {
          buffer += data.text;
          if (frame === null) frame = globalThis.setTimeout(flush, 16);
        }
        if (event === 'done') {
          finished = true; receivedDone = Boolean(data.assistant); clear(); update({finishing: true});
          if (data.assistant) messages(items => [...items.filter(item => item.id !== 'streaming-assistant' && item.id !== data.assistant.id), data.assistant]);
        }
      }});
      if (!finished) flush();
    } catch (error) {
      update({error: abort.signal.aborted || error.name === 'AbortError' ? '已停止生成' : error.message});
    } finally {
      finished = true; clear(); update({finishing: true});
      abort.signal.removeEventListener('abort', onAbort);
      if (!receivedDone) processing(meta => ({...meta,
        processing_status: abort.signal.aborted ? 'cancelled' : 'failed', processing_duration_ms: Math.max(1, Date.now() - startedAt),
        tool_receipts: (meta.tool_receipts || []).map(item => ['running', 'active', 'pending', 'awaiting_approval'].includes(item.status)
          ? {...item, status: 'interrupted', requires_user_action: false} : item),
      }));
      if (current) {
        try {
          const saved = await api.conversation(current.id);
          update(value => ({chat: saved, messages: [...saved.messages,
            ...value.messages.filter(item => item.id.startsWith('pending-user:') && !saved.messages.some(row => row.role === 'user' && row.content === item.content)).map(item => ({...item, metadata_json: {...item.metadata_json, delivery_status: 'failed'}})),
            ...value.messages.filter(item => !receivedDone && item.id === 'streaming-assistant'),
          ]}));
        } catch (error) { update({error: error.message}); }
        onChanged?.();
      }
      messages(items => items.map(item => item.id === 'streaming-assistant' || item.id === pendingId
        ? {...item, id: item.id === 'streaming-assistant' ? `local-assistant:${pendingId}` : item.id, metadata_json: {...item.metadata_json, delivery_status: abort.signal.aborted ? 'cancelled' : 'failed'}} : item));
      controller = null;
      update({busy: false, stopping: false, finishing: false});
    }
  }
  return session;
}
