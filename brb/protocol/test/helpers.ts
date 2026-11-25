import { WebSocketServer, type WebSocket } from "ws";
import type { AddressInfo } from "node:net";

export interface FakeRelay {
  url: string;
  protocols: string[][];
  received: any[];
  sockets: WebSocket[];
  /** Registers a handler answering requests by method. */
  handle(method: string, fn: (params: any, id: string, socket: WebSocket) => unknown): void;
  push(frame: unknown): void;
  dropAll(): void;
  close(): Promise<void>;
}

export async function startFakeRelay(): Promise<FakeRelay> {
  const handlers = new Map<string, (params: any, id: string, socket: WebSocket) => unknown>();
  const received: any[] = [];
  const protocols: string[][] = [];
  const sockets: WebSocket[] = [];
  const server = new WebSocketServer({
    port: 0,
    host: "127.0.0.1",
    handleProtocols: (offered) => [...offered][0] ?? false,
  });
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  server.on("connection", (socket, request) => {
    protocols.push(String(request.headers["sec-websocket-protocol"] ?? "").split(",").map((p) => p.trim()));
    sockets.push(socket);
    socket.on("message", (data) => {
      const message = JSON.parse(String(data));
      received.push(message);
      if (typeof message.method === "string" && typeof message.id === "string") {
        const handler = handlers.get(message.method);
        const result = handler ? handler(message.params, message.id, socket) : {};
        if (result && typeof result === "object" && "__error" in (result as object)) {
          socket.send(JSON.stringify({ id: message.id, ok: false, error: (result as any).__error }));
        } else if (result !== undefined) {
          socket.send(JSON.stringify({ id: message.id, result }));
        }
      }
    });
  });
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    protocols,
    received,
    sockets,
    handle: (method, fn) => { handlers.set(method, fn); },
    push: (frame) => { for (const s of sockets) if (s.readyState === 1) s.send(JSON.stringify(frame)); },
    dropAll: () => { for (const s of sockets) s.terminate(); },
    close: () => new Promise<void>((resolve) => {
      for (const s of sockets) s.terminate();
      server.close(() => resolve());
    }),
  };
}

export function waitFor(check: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() - start > ms) return reject(new Error("timed out waiting"));
      setTimeout(tick, 5);
    };
    tick();
  });
}
