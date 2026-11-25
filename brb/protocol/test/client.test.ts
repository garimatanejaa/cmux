import test from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { RelayClient, notificationFromEvent, type SocketFactory } from "../src/client.js";
import { RelayConnectionError, RelayRPCError } from "../src/errors.js";
import { screenHash, type ScreenState } from "../src/screen.js";
import { startFakeRelay, waitFor, type FakeRelay } from "./helpers.js";

const factory: SocketFactory = (url, protocols) => {
  const socket = new WebSocket(url, protocols) as any;
  return new Proxy(socket, {}) as any;
};

async function setup(extra: Partial<ConstructorParameters<typeof RelayClient>[0]> = {}) {
  const relay = await startFakeRelay();
  const client = new RelayClient({
    baseUrl: relay.url, token: "tok123", deviceId: "dev1", socketFactory: factory,
    reconnectMinMs: 10, reconnectMaxMs: 40, requestTimeoutMs: 400, ...extra,
  });
  return { relay, client };
}

async function done(relay: FakeRelay, client: RelayClient) {
  client.close();
  await relay.close();
}

const fullFrame = (rev: number, rows: string[]) => ({
  type: "screen.full", surface_id: "s1", rev, rows, cols: 80, rowsCount: rows.length, cursor: { x: 0, y: 0 },
});

test("connects with both subprotocols and sends hello first", async () => {
  const { relay, client } = await setup();
  await client.connect();
  await waitFor(() => relay.received.length >= 1);
  assert.deepEqual(relay.protocols[0], ["cmuxremote.v1", "bearer.tok123"]);
  assert.deepEqual(relay.received[0], { deviceId: "dev1", appVersion: "0.1.0", protocolVersion: 1 });
  await done(relay, client);
});

test("lists workspaces and surfaces from cmux's shapes", async () => {
  const { relay, client } = await setup();
  relay.handle("workspace.list", () => ({ workspaces: [{ id: "w1", title: "api", index: 0, extra: 1 }] }));
  relay.handle("surface.list", (p) => ({ surfaces: [{ id: "s1", title: "claude", index: 0, type: "terminal", ws: p.workspace_id }, { id: "s2", title: "docs", index: 1, type: "browser" }] }));
  await client.connect();
  assert.deepEqual(await client.listWorkspaces(), [{ id: "w1", title: "api", index: 0 }]);
  const surfaces = await client.listSurfaces("w1");
  assert.equal(surfaces.length, 2);
  assert.equal(relay.received.at(-1).params.workspace_id, "w1");
  await done(relay, client);
});

test("subscribe delivers full then diff screens", async () => {
  const { relay, client } = await setup();
  relay.handle("surface.subscribe", () => ({}));
  const seen: ScreenState[] = [];
  client.onScreen((s) => seen.push(s));
  await client.connect();
  await client.subscribe("w1", "s1", 50);
  assert.deepEqual(relay.received.at(-1).params, { workspace_id: "w1", surface_id: "s1", lines: 50 });
  relay.push(fullFrame(1, ["hello", "world"]));
  relay.push({ type: "screen.diff", surface_id: "s1", rev: 2, ops: [{ op: "row", y: 1, text: "there" }] });
  await waitFor(() => seen.length === 2);
  assert.deepEqual(seen[1]!.rows, ["hello", "there"]);
  assert.deepEqual(client.screenFor("s1")!.rows, ["hello", "there"]);
  await done(relay, client);
});

test("a diff for an unknown screen asks for a full one", async () => {
  const { relay, client } = await setup();
  relay.handle("surface.read_text", () => ({}));
  await client.connect();
  relay.push({ type: "screen.diff", surface_id: "s1", rev: 5, ops: [] });
  await waitFor(() => relay.received.some((m) => m.method === "surface.read_text"));
  assert.equal(relay.received.find((m) => m.method === "surface.read_text").params.surface_id, "s1");
  await done(relay, client);
});

test("a checksum mismatch asks for a full screen; a match does not", async () => {
  const { relay, client } = await setup();
  relay.handle("surface.read_text", () => ({}));
  await client.connect();
  relay.push(fullFrame(1, ["a"]));
  await waitFor(() => client.screenFor("s1") !== undefined);
  relay.push({ type: "screen.checksum", surface_id: "s1", rev: 1, hash: screenHash(["a"], { x: 0, y: 0 }) });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(relay.received.filter((m) => m.method === "surface.read_text").length, 0);
  relay.push({ type: "screen.checksum", surface_id: "s1", rev: 1, hash: "ffffffffffffffff" });
  await waitFor(() => relay.received.some((m) => m.method === "surface.read_text"));
  await done(relay, client);
});

test("answers ping with pong", async () => {
  const { relay, client } = await setup();
  await client.connect();
  relay.push({ type: "ping", ts: 42 });
  await waitFor(() => relay.received.some((m) => m.type === "pong"));
  assert.deepEqual(relay.received.find((m) => m.type === "pong"), { type: "pong", ts: 42 });
  await done(relay, client);
});

test("sendText and sendKey use the relay's parameters", async () => {
  const { relay, client } = await setup();
  relay.handle("surface.send_text", () => ({}));
  relay.handle("surface.send_key", () => ({}));
  await client.connect();
  await client.sendText("w1", "s1", "yes\n");
  await client.sendKey("w1", "s1", "c", ["ctrl"]);
  const text = relay.received.find((m) => m.method === "surface.send_text");
  const key = relay.received.find((m) => m.method === "surface.send_key");
  assert.deepEqual(text.params, { workspace_id: "w1", surface_id: "s1", text: "yes\n" });
  assert.deepEqual(key.params, { workspace_id: "w1", surface_id: "s1", key: "ctrl+c" });
  await done(relay, client);
});

test("a forbidden answer becomes a RelayRPCError", async () => {
  const { relay, client } = await setup();
  relay.handle("surface.send_text", () => ({ __error: { code: "forbidden", message: "not allowed" } }));
  await client.connect();
  await assert.rejects(client.sendText("w", "s", "x"), (e: any) => e instanceof RelayRPCError && e.isForbidden);
  await done(relay, client);
});

test("calls time out and fail when disconnected", async () => {
  const { relay, client } = await setup({ requestTimeoutMs: 60 });
  relay.handle("workspace.list", () => undefined);
  await client.connect();
  await assert.rejects(client.listWorkspaces(), RelayConnectionError);
  client.close();
  await assert.rejects(client.listWorkspaces(), RelayConnectionError);
  await relay.close();
});

test("connect rejects when nothing is listening", async () => {
  const client = new RelayClient({ baseUrl: "http://127.0.0.1:1", token: "t", deviceId: "d", socketFactory: factory, reconnect: false });
  await assert.rejects(client.connect(), RelayConnectionError);
  client.close();
});

test("rejects non-http addresses", async () => {
  const client = new RelayClient({ baseUrl: "ftp://x", token: "t", deviceId: "d", socketFactory: factory });
  await assert.rejects(client.connect(), RelayConnectionError);
});

test("reconnects after a drop and re-subscribes", async () => {
  const { relay, client } = await setup();
  relay.handle("surface.subscribe", () => ({}));
  const statuses: string[] = [];
  client.onStatus((s) => statuses.push(s));
  await client.connect();
  await client.subscribe("w1", "s1");
  relay.dropAll();
  await waitFor(() => relay.received.filter((m) => m.method === "surface.subscribe").length === 2);
  assert.ok(statuses.includes("closed"));
  assert.equal(relay.received.filter((m) => m.deviceId === "dev1").length, 2, "hello again after reconnect");
  assert.equal(client.connectionStatus, "open");
  await done(relay, client);
});

test("notification events are parsed", async () => {
  const event = { type: "event" as const, category: "notification" as const, name: "notification.created",
    payload: { id: "n1", title: "Claude needs input", body: "ok?", workspace_id: "w1", surface_id: "s1" } };
  assert.deepEqual(notificationFromEvent(event), { id: "n1", title: "Claude needs input", body: "ok?", workspaceId: "w1", surfaceId: "s1" });
  assert.equal(notificationFromEvent({ ...event, name: "notification.read" }), null);
  assert.equal(notificationFromEvent({ ...event, payload: { title: "no id" } }), null);

  const { relay, client } = await setup();
  const got: string[] = [];
  client.onNotification((n) => got.push(n.id));
  await client.connect();
  relay.push(event);
  await waitFor(() => got.length === 1);
  await done(relay, client);
});

test("pending prompts and replies", async () => {
  const { relay, client } = await setup();
  relay.handle("feed.pending.list", () => ({ items: [{ id: "1", request_id: "r1", kind: "permission", source: "claude", workstream_id: "x", tool_name: "Bash", available_modes: ["once", "deny"] }], truncated: false }));
  relay.handle("feed.reply", () => ({ request_id: "r1", kind: "permission" }));
  await client.connect();
  const list = await client.pendingPrompts(10);
  assert.equal(list.items[0]!.tool_name, "Bash");
  assert.deepEqual(relay.received.find((m) => m.method === "feed.pending.list").params, { limit: 10 });
  await client.answerPrompt({ request_id: "r1", kind: "permission", mode: "once" });
  assert.deepEqual(relay.received.find((m) => m.method === "feed.reply").params, { request_id: "r1", kind: "permission", mode: "once" });
  await done(relay, client);
});
