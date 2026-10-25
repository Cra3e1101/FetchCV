const compact = (value, limit = 240) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';

// Only observable operation targets belong in the timeline, never arbitrary
// arguments, request headers, scraped content or model reasoning.
export function activityUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return '';
  try {
    const url = new globalThis.URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return '';
    url.username = ''; url.password = ''; url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|secret|password|signature|credential|auth|session|code|ticket/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch { return ''; }
}

export function toolActivity(name, args = {}, result = {}) {
  if (['search_web', 'web_search', 'search_workspace_text', 'search_interview_knowledge'].includes(name)) {
    const text = compact(args.query);
    return text ? {kind: 'search', text} : null;
  }
  if (['read_web_page', 'web_read', 'open_browser_page', 'read_browser_page', 'capture_interview_source', 'read_interview_source'].includes(name)) {
    const artifact = result.artifacts?.find(item => typeof item === 'string' && item.startsWith('url:'));
    const href = activityUrl(args.url || args.source_url || result.data?.url || result.data?.source_url || artifact?.slice(4));
    return href ? {kind: 'url', text: href, href} : null;
  }
  if (['read_workspace_file', 'write_workspace_file', 'delete_workspace_file', 'list_workspace_files', 'read_skill'].includes(name)) {
    const text = compact(args.path || args.name);
    return text ? {kind: 'file', text} : null;
  }
  if (name === 'move_workspace_file') {
    const from = compact(args.source_path), to = compact(args.destination_path);
    return from && to ? {kind: 'file', text: `${from} → ${to}`} : null;
  }
  return null;
}

export function receiptActivity(receipt) {
  const activity = receipt.activity;
  if (activity?.kind === 'url') {
    const href = activityUrl(activity.href);
    if (href) return {kind: 'url', text: href, href};
  } else if (['search', 'file'].includes(activity?.kind)) {
    const text = compact(activity.text, 500);
    if (text) return {kind: activity.kind, text};
  }
  // Old receipts can still expose a recorded URL, but missing inputs are not
  // reconstructed from a tool name or a generic result summary.
  return toolActivity(receipt.tool_name, {}, receipt);
}
