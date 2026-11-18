/** Lightweight startup check. Keep the tool execution engine out of the splash bundle. */
export const MCP_OAUTH_PENDING_STORAGE_KEY = "ai_phone_mcp_oauth_pending_v1";
export const MCP_OAUTH_CALLBACK_STORAGE_KEY = "ai_phone_mcp_oauth_callback_v1";

export function hasPendingMcpOAuthCallback(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const pending = JSON.parse(window.localStorage.getItem(MCP_OAUTH_PENDING_STORAGE_KEY) || "null");
    const callback = JSON.parse(window.localStorage.getItem(MCP_OAUTH_CALLBACK_STORAGE_KEY) || "null");
    return Boolean(pending?.state && callback?.state && pending.state === callback.state);
  } catch {
    return false;
  }
}
