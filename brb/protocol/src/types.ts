/** Wire types for the BRB relay. Field names match the relay exactly. */

export const PROTOCOL_VERSION = 1;
/** WebSocket subprotocol the relay speaks. */
export const WIRE_SUBPROTOCOL = "cmuxremote.v1";

export type JSONValue =
  | null
  | boolean
  | number
  | string
  | JSONValue[]
  | { [key: string]: JSONValue };

export type DeviceScope = "read" | "control";

export interface Workspace {
  id: string;
  /** cmux calls this `title`. */
  title: string;
  index: number;
}

export interface Surface {
  id: string;
  title: string;
  index: number;
  /** `terminal`, `browser`, `markdown`, ...; absent on older cmux. */
  type?: string;
}

export function isTerminalSurface(surface: Surface): boolean {
  return surface.type === undefined || surface.type === "terminal";
}

export interface CursorPos {
  x: number;
  y: number;
}

export interface ScreenFull {
  type: "screen.full";
  surface_id: string;
  rev: number;
  /** Raw ANSI rows. */
  rows: string[];
  cols: number;
  rowsCount: number;
  cursor: CursorPos;
  activeScreen?: string;
}

export type DiffOp =
  | { op: "row"; y: number; text: string }
  | { op: "cursor"; x: number; y: number }
  | { op: "clear" };

export interface ScreenDiff {
  type: "screen.diff";
  surface_id: string;
  rev: number;
  ops: DiffOp[];
}

export interface ScreenChecksum {
  type: "screen.checksum";
  surface_id: string;
  rev: number;
  hash: string;
}

export type EventCategory =
  | "workspace"
  | "surface"
  | "notification"
  | "system"
  | "agent"
  | "hook"
  | "unknown";

export interface EventFrame {
  type: "event";
  category: EventCategory;
  name: string;
  payload: JSONValue;
}

export interface PingFrame {
  type: "ping" | "pong";
  ts: number;
}

export type PushFrame = ScreenFull | ScreenDiff | ScreenChecksum | EventFrame | PingFrame;

export interface RPCError {
  code: string;
  message: string;
  data?: JSONValue;
}

export interface RPCResponse {
  id: string;
  ok?: boolean;
  result?: JSONValue;
  error?: RPCError;
}

export interface RegisterResult {
  deviceId: string;
  token: string;
}

export interface RelayState {
  snippets: { label: string; text: string }[];
  defaultFps: number;
}

export type FeedItemKind = "question" | "permission" | "plan";

export interface FeedOption {
  id: string;
  label: string;
}

export interface FeedQuestion {
  id: string;
  prompt: string;
  multi_select: boolean;
  options: FeedOption[];
}

export interface FeedPendingItem {
  id: string;
  request_id: string;
  kind: FeedItemKind;
  source: string;
  workstream_id: string;
  created_at?: number;
  title?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: string;
  tool_input_truncated?: boolean;
  available_modes?: string[];
  default_mode?: string;
  plan_text?: string;
  plan_text_truncated?: boolean;
  questions?: FeedQuestion[];
}

export interface FeedPendingList {
  items: FeedPendingItem[];
  truncated: boolean;
  omitted_count?: number;
}

export type FeedReply =
  | { request_id: string; kind: "permission"; mode: "once" | "always" | "deny" }
  | { request_id: string; kind: "plan"; mode: "autoAccept" | "manual" | "deny" }
  | { request_id: string; kind: "question"; selections: string[] };

/** Notification as carried by `notification.created` events. */
export interface NotificationInfo {
  id: string;
  workspaceId?: string;
  surfaceId?: string;
  title: string;
  body: string;
}

export interface DeviceInfo {
  deviceId: string;
  /** Older relays do not say; treat missing as read-only. */
  scope: DeviceScope;
}

export interface PushInfo {
  enabled: boolean;
  /** Where the ntfy phone app subscribes, for example `https://ntfy.sh/brb-...`. */
  subscribeUrl?: string;
  /** Whether notifications carry real text (default: they only say an agent needs attention). */
  includeText: boolean;
}
