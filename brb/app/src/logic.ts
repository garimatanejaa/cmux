import type { FeedPendingItem, FeedReply } from "@brb/protocol";

/** Accepts "100.64.1.2", "mac.tailnet.ts.net:4399" or a full http(s) URL; returns a base URL. */
export function toBaseUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (/^https?:\/\/[^/\s]+/i.test(text)) return text.replace(/\/+$/, "");
  if (!/^[A-Za-z0-9.\-]+(:\d{1,5})?$/.test(text)) return null;
  return text.includes(":") ? `http://${text}` : `http://${text}:4399`;
}

/** The reply to send for a tapped button, or null when the item has none. */
export function replyFor(item: FeedPendingItem, choice: string, selections?: string[]): FeedReply | null {
  if (item.kind === "permission" && (choice === "once" || choice === "always" || choice === "deny")) {
    return { request_id: item.request_id, kind: "permission", mode: choice };
  }
  if (item.kind === "plan" && (choice === "autoAccept" || choice === "manual" || choice === "deny")) {
    return { request_id: item.request_id, kind: "plan", mode: choice };
  }
  if (item.kind === "question" && selections && selections.length > 0) {
    return { request_id: item.request_id, kind: "question", selections };
  }
  return null;
}

/** `https://ntfy.sh/topic` -> `ntfy://ntfy.sh/topic` (the ntfy app's subscribe link). */
export function ntfyDeepLink(subscribeUrl: string): string {
  const secure = subscribeUrl.startsWith("https://");
  const rest = subscribeUrl.replace(/^https?:\/\//, "");
  return secure && rest.startsWith("ntfy.sh/") ? `ntfy://${rest}` : `${secure ? "ntfy" + "s" : "ntfy"}://${rest}`;
}
