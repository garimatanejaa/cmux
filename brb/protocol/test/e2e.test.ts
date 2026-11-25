/**
 * End-to-end test against an in-process mock of the relay: a real HTTP server for pairing and a
 * real WebSocket server for the wire protocol, with the relay's rules (one-time codes, lockout,
 * read versus control, revocation). No Mac, Tailscale or cmux needed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import WebSocket from "ws";
import { RelayClient, getMe, getPush, register, RelayHTTPError, RelayRPCError, tokenIsValid, unpair, type SocketFactory, type ScreenState } from "../src/index.js";
import { screenHash } from "../src/screen.js";
import { waitFor } from "./helpers.js";

interface Device { id: string; scope: "read" | "control" }

async function startMockRelay() {
  let codes = new Map<string, "read" | "control">();
  const devices = new Map<string, Device>(); // token -> device
  let failures = 0;
  let lockedUntil = 0;
  const inputs: string[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      const bearer = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
      const send = (status: number, json?: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { "Content-Type": "application/json", ...headers });
        res.end(json === undefined ? "" : JSON.stringify(json));
      };
      if (req.method === "GET" && req.url === "/v1/health") return send(200, { ok: true });
      if (req.method === "POST" && req.url === "/v1/devices/me/register") {
        if (Date.now() < lockedUntil) return send(429, { error: "locked" }, { "Retry-After": "60" });
        const code = String((JSON.parse(body || "{}") as { code?: string }).code ?? "").toUpperCase();
        const scope = codes.get(code);
        if (!scope) {
          if (++failures >= 3) lockedUntil = Date.now() + 60_000;
          return send(403);
        }
        codes.delete(code);
        const token = `tok-${devices.size + 1}`;
        devices.set(token, { id: `dev-${devices.size + 1}`, scope });
        return send(200, { device_id: devices.get(token)!.id, token });
      }
      const device = devices.get(bearer);
      if (!device) return send(401);
      if (req.method === "GET" && req.url === "/v1/devices/me") return send(200, { device_id: device.id, scope: device.scope });
      if (req.method === "GET" && req.url === "/v1/push") return send(200, { enabled: true, subscribe_url: "https://ntfy.sh/brb-test", include_text: false });
      if (req.method === "DELETE" && req.url === "/v1/devices/me") { devices.delete(bearer); return send(204); }
      return send(404);
    });
  });
  const wss = new WebSocketServer({ noServer: true, handleProtocols: (offered) => [...offered][0] ?? false });
  const sockets = new Map<string, WebSocket>();
  server.on("upgrade", (req, socket, head) => {
    const offered = String(req.headers["sec-websocket-protocol"] ?? "").split(",").map((p) => p.trim());
    const token = offered.find((p) => p.startsWith("bearer."))?.slice(7) ?? "";
    const device = devices.get(token);
    if (req.url !== "/v1/ws" || !device) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.set(token, ws);
      let helloed = false;
      ws.on("message", (data) => {
        const msg = JSON.parse(String(data));
        if (!helloed) { helloed = msg.protocolVersion === 1; if (!helloed) ws.close(); return; }
        if (msg.type === "pong") return;
        const current = devices.get(token);
        if (!current) return ws.close();
        const reply = (result: unknown) => ws.send(JSON.stringify({ id: msg.id, result }));
        const fail = (code: string, message: string) => ws.send(JSON.stringify({ id: msg.id, ok: false, error: { code, message } }));
        switch (msg.method) {
          case "workspace.list": return reply({ workspaces: [{ id: "w1", title: "api", index: 0 }] });
          case "surface.list": return reply({ surfaces: [{ id: "s1", title: "claude", index: 0, type: "terminal" }, { id: "s2", title: "web", index: 1, type: "browser" }] });
          case "surface.subscribe": {
            reply({});
            ws.send(JSON.stringify({ type: "screen.full", surface_id: msg.params.surface_id, rev: 1, rows: ["$ claude", "> hello"], cols: 80, rowsCount: 2, cursor: { x: 7, y: 1 } }));
            return;
          }
          case "surface.unsubscribe": return reply({});
          case "surface.read_text": return reply({});
          case "feed.pending.list":
            return reply({ items: [{ id: "i1", request_id: "r1", kind: "permission", source: "claude", workstream_id: "x", tool_name: "Bash", available_modes: ["once", "always", "deny"] }], truncated: false });
          case "surface.send_text":
          case "surface.send_key":
          case "feed.reply":
            if (current.scope !== "control") return fail("forbidden", "This device is not allowed to use " + msg.method);
            inputs.push(`${msg.method}:${JSON.stringify(msg.params)}`);
            return reply({});
          default: return fail("not_found", "unknown method");
        }
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    baseUrl, inputs,
    makeCode: (code: string, scope: "read" | "control" = "read") => { codes.set(code, scope); },
    revokeAll: () => { devices.clear(); },
    push: (token: string, frame: unknown) => sockets.get(token)?.send(JSON.stringify(frame)),
    resetLock: () => { failures = 0; lockedUntil = 0; },
    close: () => new Promise<void>((resolve) => { for (const s of sockets.values()) s.terminate(); wss.close(); server.close(() => resolve()); }),
  };
}

const factory: SocketFactory = (url, protocols) => new WebSocket(url, protocols) as any;

test("full journey: pair, watch a terminal, type, answer a prompt, unpair", async () => {
  const relay = await startMockRelay();
  relay.makeCode("AAAA-BBBB-CCCC-DDDD", "control");
  const paired = await register(relay.baseUrl, "aaaa-bbbb-cccc-dddd");
  assert.deepEqual(await getMe(relay.baseUrl, paired.token), { deviceId: paired.deviceId, scope: "control" });
  assert.equal((await getPush(relay.baseUrl, paired.token)).subscribeUrl, "https://ntfy.sh/brb-test");

  const client = new RelayClient({ baseUrl: relay.baseUrl, token: paired.token, deviceId: paired.deviceId, socketFactory: factory });
  const screens: ScreenState[] = [];
  client.onScreen((s) => screens.push(s));
  await client.connect();

  const workspaces = await client.listWorkspaces();
  assert.equal(workspaces[0]!.title, "api");
  const surfaces = await client.listSurfaces("w1");
  assert.equal(surfaces.length, 2);

  await client.subscribe("w1", "s1");
  await waitFor(() => screens.length === 1);
  assert.deepEqual(screens[0]!.rows, ["$ claude", "> hello"]);

  relay.push(paired.token, { type: "screen.diff", surface_id: "s1", rev: 2, ops: [{ op: "row", y: 1, text: "> hello world" }, { op: "cursor", x: 13, y: 1 }] });
  await waitFor(() => screens.length === 2);
  assert.deepEqual(client.screenFor("s1")!.rows, ["$ claude", "> hello world"]);
  relay.push(paired.token, { type: "screen.checksum", surface_id: "s1", rev: 2, hash: screenHash(["$ claude", "> hello world"], { x: 13, y: 1 }) });

  await client.sendText("w1", "s1", "yes");
  await client.sendKey("w1", "s1", "enter");
  const prompts = await client.pendingPrompts();
  assert.equal(prompts.items[0]!.tool_name, "Bash");
  await client.answerPrompt({ request_id: "r1", kind: "permission", mode: "once" });
  assert.equal(relay.inputs.length, 3);
  assert.match(relay.inputs[0]!, /surface\.send_text.*"text":"yes"/);
  assert.match(relay.inputs[1]!, /"key":"enter"/);
  assert.match(relay.inputs[2]!, /feed\.reply.*"mode":"once"/);

  const notified: string[] = [];
  client.onNotification((n) => notified.push(n.title));
  relay.push(paired.token, { type: "event", category: "notification", name: "notification.created", payload: { id: "n1", title: "Claude needs input", body: "", workspace_id: "w1", surface_id: "s1" } });
  await waitFor(() => notified.length === 1);

  client.close();
  await unpair(relay.baseUrl, paired.token);
  assert.equal(await tokenIsValid(relay.baseUrl, paired.token), false);
  await relay.close();
});

test("a read-only phone can watch but not type or answer", async () => {
  const relay = await startMockRelay();
  relay.makeCode("READ-ONLY", "read");
  const paired = await register(relay.baseUrl, "READ-ONLY");
  assert.equal((await getMe(relay.baseUrl, paired.token)).scope, "read");
  const client = new RelayClient({ baseUrl: relay.baseUrl, token: paired.token, deviceId: paired.deviceId, socketFactory: factory });
  await client.connect();
  await client.listWorkspaces();
  await client.subscribe("w1", "s1");
  await assert.rejects(client.sendText("w1", "s1", "rm -rf /"), (e: any) => e instanceof RelayRPCError && e.isForbidden);
  await assert.rejects(client.answerPrompt({ request_id: "r1", kind: "permission", mode: "always" }), (e: any) => e.isForbidden);
  assert.deepEqual(relay.inputs, []);
  client.close();
  await relay.close();
});

test("codes work once, wrong codes lock the address out", async () => {
  const relay = await startMockRelay();
  relay.makeCode("ONE-TIME");
  await register(relay.baseUrl, "ONE-TIME");
  await assert.rejects(register(relay.baseUrl, "ONE-TIME"), (e: any) => e instanceof RelayHTTPError && e.isRefused);
  await assert.rejects(register(relay.baseUrl, "nope"), (e: any) => e.isRefused);
  await assert.rejects(register(relay.baseUrl, "nope2"), (e: any) => e.isRefused);
  relay.makeCode("GOOD");
  await assert.rejects(register(relay.baseUrl, "GOOD"), (e: any) => e.isLockedOut && e.retryAfterSeconds === 60);
  relay.resetLock();
  assert.ok((await register(relay.baseUrl, "GOOD")).token);
  await relay.close();
});

test("a removed phone cannot connect and sees its token is invalid", async () => {
  const relay = await startMockRelay();
  relay.makeCode("GONE");
  const paired = await register(relay.baseUrl, "GONE");
  relay.revokeAll();
  assert.equal(await tokenIsValid(relay.baseUrl, paired.token), false);
  const client = new RelayClient({ baseUrl: relay.baseUrl, token: paired.token, deviceId: paired.deviceId, socketFactory: factory, reconnect: false });
  await assert.rejects(client.connect());
  client.close();
  await relay.close();
});

test("an open connection is closed when the phone is removed", async () => {
  const relay = await startMockRelay();
  relay.makeCode("LIVE", "control");
  const paired = await register(relay.baseUrl, "LIVE");
  const client = new RelayClient({ baseUrl: relay.baseUrl, token: paired.token, deviceId: paired.deviceId, socketFactory: factory, reconnect: false, requestTimeoutMs: 500 });
  await client.connect();
  await client.listWorkspaces();
  relay.revokeAll();
  await assert.rejects(client.listWorkspaces());
  await waitFor(() => client.connectionStatus === "closed");
  await relay.close();
});
