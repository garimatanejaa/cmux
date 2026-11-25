import { RelayConnectionError, RelayRPCError } from "./errors.js";
import { normalizeBaseUrl } from "./http.js";
import { checksumMatches, applyDiff, fromFull, type ScreenState } from "./screen.js";
import {
  PROTOCOL_VERSION,
  WIRE_SUBPROTOCOL,
  type EventFrame,
  type FeedPendingList,
  type FeedReply,
  type JSONValue,
  type NotificationInfo,
  type PushFrame,
  type RPCResponse,
  type Surface,
  type Workspace,
} from "./types.js";
import { encodeKey, type KeyModifier } from "./keys.js";

/** The slice of the WebSocket API the client uses (browser, React Native and `ws` all fit). */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}
export type SocketFactory = (url: string, protocols: string[]) => SocketLike;

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface RelayClientOptions {
  baseUrl: string;
  token: string;
  deviceId: string;
  appVersion?: string;
  /** Defaults to the global WebSocket. */
  socketFactory?: SocketFactory;
  /** How long a call waits for its answer. Default 15 s. */
  requestTimeoutMs?: number;
  /** Reconnect with backoff after the connection drops. Default true. */
  reconnect?: boolean;
  /** Backoff bounds. Defaults 1 s and 30 s. */
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
}

interface Listeners {
  status: Set<(status: ConnectionStatus) => void>;
  screen: Set<(state: ScreenState) => void>;
  event: Set<(event: EventFrame) => void>;
  notification: Set<(notification: NotificationInfo) => void>;
  revoked: Set<() => void>;
}

interface Pending {
  resolve(value: JSONValue): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const SOCKET_OPEN = 1;

function wsUrl(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl);
  if (base.startsWith("https://")) return `wss://${base.slice(8)}/v1/ws`;
  if (base.startsWith("http://")) return `ws://${base.slice(7)}/v1/ws`;
  throw new RelayConnectionError(`relay address must start with http:// or https:// (got "${baseUrl}")`);
}

function asString(value: JSONValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Reads a `notification.created` event into something an app can show. */
export function notificationFromEvent(event: EventFrame): NotificationInfo | null {
  if (event.category !== "notification" || event.name !== "notification.created") return null;
  if (typeof event.payload !== "object" || event.payload === null || Array.isArray(event.payload)) return null;
  const p = event.payload;
  const id = asString(p["id"]) ?? asString(p["notification_id"]);
  if (!id) return null;
  const info: NotificationInfo = {
    id,
    title: asString(p["title"]) ?? "",
    body: asString(p["body"]) ?? "",
  };
  const workspaceId = asString(p["workspace_id"]);
  const surfaceId = asString(p["surface_id"]);
  if (workspaceId !== undefined) info.workspaceId = workspaceId;
  if (surfaceId !== undefined) info.surfaceId = surfaceId;
  return info;
}

/**
 * A live connection to the relay. Create one, call `connect()`, then use the methods.
 * It reconnects on its own and re-subscribes to the terminals you had open.
 */
export class RelayClient {
  private socket: SocketLike | null = null;
  private status: ConnectionStatus = "closed";
  private nextId = 1;
  private readonly pending = new Map<string, Pending>();
  private readonly screens = new Map<string, ScreenState>();
  private readonly subscriptions = new Map<string, { workspaceId: string; lines: number }>();
  private readonly listeners: Listeners = {
    status: new Set(), screen: new Set(), event: new Set(), notification: new Set(), revoked: new Set(),
  };
  private stopped = true;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private firstOpen: { resolve(): void; reject(error: Error): void } | null = null;

  constructor(private readonly options: RelayClientOptions) {}

  // ---- events ----

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.listeners.status.add(listener);
    return () => this.listeners.status.delete(listener);
  }
  /** Fires with the up-to-date screen whenever a terminal changes. */
  onScreen(listener: (state: ScreenState) => void): () => void {
    this.listeners.screen.add(listener);
    return () => this.listeners.screen.delete(listener);
  }
  onEvent(listener: (event: EventFrame) => void): () => void {
    this.listeners.event.add(listener);
    return () => this.listeners.event.delete(listener);
  }
  /** Fires when an agent raises a notification (for example, needs input). */
  onNotification(listener: (notification: NotificationInfo) => void): () => void {
    this.listeners.notification.add(listener);
    return () => this.listeners.notification.delete(listener);
  }
  /** Fires when the Mac has removed this phone, so the app can go back to pairing. */
  onRevoked(listener: () => void): () => void {
    this.listeners.revoked.add(listener);
    return () => this.listeners.revoked.delete(listener);
  }

  get connectionStatus(): ConnectionStatus {
    return this.status;
  }

  screenFor(surfaceId: string): ScreenState | undefined {
    return this.screens.get(surfaceId);
  }

  // ---- connection ----

  /** Resolves when the first connection is open; rejects if it cannot be opened. */
  connect(): Promise<void> {
    this.stopped = false;
    this.attempt = 0;
    return new Promise<void>((resolve, reject) => {
      this.firstOpen = { resolve, reject };
      this.open();
    });
  }

  /** Closes the connection and stops reconnecting. */
  close(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close(1000, "client closed");
    this.failAll(new RelayConnectionError("connection closed"));
    this.setStatus("closed");
  }

  private open(): void {
    const factory = this.options.socketFactory ?? defaultSocketFactory;
    this.setStatus("connecting");
    let socket: SocketLike;
    try {
      socket = factory(wsUrl(this.options.baseUrl), [WIRE_SUBPROTOCOL, `bearer.${this.options.token}`]);
    } catch (error) {
      this.firstOpen?.reject(error instanceof Error ? error : new RelayConnectionError(String(error)));
      this.firstOpen = null;
      this.setStatus("closed");
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      socket.send(JSON.stringify({
        deviceId: this.options.deviceId,
        appVersion: this.options.appVersion ?? "0.1.0",
        protocolVersion: PROTOCOL_VERSION,
      }));
      this.attempt = 0;
      this.setStatus("open");
      this.firstOpen?.resolve();
      this.firstOpen = null;
      void this.resubscribe();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      if (typeof event.data === "string") this.handleText(event.data);
    };
    const dropped = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.failAll(new RelayConnectionError("connection lost"));
      this.setStatus("closed");
      if (this.firstOpen) {
        this.firstOpen.reject(new RelayConnectionError("could not open the connection (wrong address, Tailscale off, or this phone was removed)"));
        this.firstOpen = null;
        return;
      }
      this.scheduleReconnect();
    };
    socket.onclose = dropped;
    socket.onerror = () => { /* onclose follows */ };
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.options.reconnect === false) return;
    const min = this.options.reconnectMinMs ?? 1000;
    const max = this.options.reconnectMaxMs ?? 30_000;
    const delay = Math.min(max, min * 2 ** this.attempt);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.open();
    }, delay);
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.listeners.status) listener(status);
  }

  private failAll(error: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  private async resubscribe(): Promise<void> {
    for (const [surfaceId, sub] of this.subscriptions) {
      this.screens.delete(surfaceId);
      try {
        await this.call("surface.subscribe", {
          workspace_id: sub.workspaceId, surface_id: surfaceId, lines: sub.lines,
        });
      } catch {
        // The next reconnect or an explicit subscribe will try again.
      }
    }
  }

  // ---- incoming frames ----

  private handleText(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;
    const record = parsed as Record<string, unknown>;
    if (typeof record["type"] === "string") {
      this.handlePush(parsed as PushFrame);
    } else if (typeof record["id"] === "string") {
      this.handleResponse(parsed as RPCResponse);
    }
  }

  private handlePush(frame: PushFrame): void {
    switch (frame.type) {
      case "ping":
        this.sendRaw({ type: "pong", ts: frame.ts });
        break;
      case "pong":
        break;
      case "screen.full": {
        const state = fromFull(frame);
        this.screens.set(state.surfaceId, state);
        this.emitScreen(state);
        break;
      }
      case "screen.diff": {
        const current = this.screens.get(frame.surface_id);
        if (!current) { void this.requestFull(frame.surface_id); break; }
        const next = applyDiff(current, frame);
        if (!next) { void this.requestFull(frame.surface_id); break; }
        if (next !== current) {
          this.screens.set(next.surfaceId, next);
          this.emitScreen(next);
        }
        break;
      }
      case "screen.checksum": {
        const current = this.screens.get(frame.surface_id);
        if (current && !checksumMatches(current, frame)) void this.requestFull(frame.surface_id);
        break;
      }
      case "event": {
        for (const listener of this.listeners.event) listener(frame);
        const notification = notificationFromEvent(frame);
        if (notification) for (const listener of this.listeners.notification) listener(notification);
        break;
      }
    }
  }

  private emitScreen(state: ScreenState): void {
    for (const listener of this.listeners.screen) listener(state);
  }

  private handleResponse(response: RPCResponse): void {
    const entry = this.pending.get(response.id);
    if (!entry) return;
    this.pending.delete(response.id);
    clearTimeout(entry.timer);
    if (response.error || response.ok === false) {
      const error = response.error ?? { code: "error", message: "request failed" };
      entry.reject(new RelayRPCError(error.code, error.message, error.data));
    } else {
      entry.resolve(response.result ?? null);
    }
  }

  private sendRaw(value: unknown): boolean {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) return false;
    this.socket.send(JSON.stringify(value));
    return true;
  }

  // ---- calls ----

  /** Sends one request and waits for its answer. Rejects with `RelayRPCError` on an error answer. */
  call(method: string, params: Record<string, JSONValue> = {}): Promise<JSONValue> {
    return new Promise<JSONValue>((resolve, reject) => {
      const id = String(this.nextId++);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RelayConnectionError(`${method} timed out`));
      }, this.options.requestTimeoutMs ?? 15_000);
      this.pending.set(id, { resolve, reject, timer });
      if (!this.sendRaw({ id, method, params })) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new RelayConnectionError("not connected"));
      }
    });
  }

  async listWorkspaces(): Promise<Workspace[]> {
    const result = await this.call("workspace.list");
    const list = (result as { workspaces?: { id: string; title?: string; name?: string; index?: number }[] } | null)?.workspaces ?? [];
    return list.map((w, i) => ({ id: w.id, title: w.title ?? w.name ?? w.id, index: w.index ?? i }));
  }

  async listSurfaces(workspaceId: string): Promise<Surface[]> {
    const result = await this.call("surface.list", { workspace_id: workspaceId });
    const list = (result as { surfaces?: Surface[] } | null)?.surfaces ?? [];
    return list.map((s, i) => ({ ...s, index: s.index ?? i, title: s.title ?? s.id }));
  }

  /** Starts live updates for a terminal. Screens arrive through `onScreen`. Read access is enough. */
  async subscribe(workspaceId: string, surfaceId: string, lines = 200): Promise<void> {
    this.subscriptions.set(surfaceId, { workspaceId, lines });
    await this.call("surface.subscribe", { workspace_id: workspaceId, surface_id: surfaceId, lines });
  }

  async unsubscribe(surfaceId: string): Promise<void> {
    this.subscriptions.delete(surfaceId);
    this.screens.delete(surfaceId);
    await this.call("surface.unsubscribe", { surface_id: surfaceId });
  }

  /** Asks for a fresh full screen (used after a gap or a checksum mismatch). */
  async requestFull(surfaceId: string): Promise<void> {
    try {
      await this.call("surface.read_text", { surface_id: surfaceId });
    } catch {
      // The next frame or reconnect repairs it.
    }
  }

  /** Types text into a terminal. Needs control access. */
  async sendText(workspaceId: string, surfaceId: string, text: string): Promise<void> {
    await this.call("surface.send_text", { workspace_id: workspaceId, surface_id: surfaceId, text });
  }

  /** Presses a key (`enter`, `esc`, `up`, ...) with optional modifiers. Needs control access. */
  async sendKey(workspaceId: string, surfaceId: string, name: string, modifiers: KeyModifier[] = []): Promise<void> {
    await this.call("surface.send_key", {
      workspace_id: workspaceId, surface_id: surfaceId, key: encodeKey(name, modifiers),
    });
  }

  /** Questions, permission requests and plans waiting for an answer. */
  async pendingPrompts(limit?: number): Promise<FeedPendingList> {
    const result = await this.call("feed.pending.list", limit === undefined ? {} : { limit });
    const parsed = result as Partial<FeedPendingList> | null;
    return { items: parsed?.items ?? [], truncated: parsed?.truncated ?? false, ...(parsed?.omitted_count !== undefined ? { omitted_count: parsed.omitted_count } : {}) };
  }

  /** Answers a pending prompt. Needs control access. */
  async answerPrompt(reply: FeedReply): Promise<void> {
    await this.call("feed.reply", reply as unknown as Record<string, JSONValue>);
  }

  /** Marks this client revoked (call when a request answers 401/403 repeatedly). */
  notifyRevoked(): void {
    for (const listener of this.listeners.revoked) listener();
  }
}

function defaultSocketFactory(url: string, protocols: string[]): SocketLike {
  const Ctor = (globalThis as { WebSocket?: new (url: string, protocols?: string[]) => unknown }).WebSocket;
  if (!Ctor) throw new RelayConnectionError("no WebSocket available in this runtime");
  return new Ctor(url, protocols) as SocketLike;
}
