import { createHmac } from "node:crypto";

export function signWebApproval({ approvalKey, messageId, toolName, payload }) {
  if (!approvalKey || !messageId) throw new Error("缺少桌面审批会话");
  const encoded = Buffer.from(JSON.stringify({
    message_id: messageId, tool: toolName, call_id: payload.idempotency_key,
    arguments: payload.arguments, expires_at: Math.floor(Date.now() / 1000) + 300,
  })).toString("base64url");
  const signature = createHmac("sha256", approvalKey).update(`fetchcv-web-approval-v1:${encoded}`).digest("hex");
  return `${encoded}.${signature}`;
}

export async function requestConversationTool({ request, toolName, payload, signal, confirm, onWaiting, approvalKey, messageId }) {
  try {
    return await request(payload);
  } catch (error) {
    if (error.code !== "web_approval_required" || !["search_web", "read_web_page"].includes(toolName)) throw error;
    signal?.throwIfAborted();
    onWaiting?.();
    const approved = await confirm?.({ toolName, arguments: payload.arguments, signal });
    signal?.throwIfAborted();
    if (!approved) {
      const denied = new Error("用户未批准本次联网操作");
      denied.code = "web_approval_denied";
      throw denied;
    }
    return request({ ...payload, approval_token: signWebApproval({ approvalKey, messageId, toolName, payload }) });
  }
}
