import test from "node:test";
import assert from "node:assert/strict";
import { getState, health, register, tokenIsValid, type FetchLike } from "../src/http.js";
import { RelayConnectionError, RelayHTTPError } from "../src/errors.js";

function fakeFetch(status: number, body: string, headers: Record<string, string> = {}, calls: any[] = []): FetchLike {
  return async (url, init) => {
    calls.push({ url, init });
    return { status, ok: status >= 200 && status < 300, text: async () => body, headers: { get: (n) => headers[n] ?? null } };
  };
}

test("register posts the trimmed code and returns the device and token", async () => {
  const calls: any[] = [];
  const result = await register("http://100.1.2.3:4399/", "  ABCD-EFGH  ",
    { fetch: fakeFetch(200, '{"device_id":"d1","token":"tok"}', {}, calls) });
  assert.deepEqual(result, { deviceId: "d1", token: "tok" });
  assert.equal(calls[0].url, "http://100.1.2.3:4399/v1/devices/me/register");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(JSON.parse(calls[0].init.body).code, "ABCD-EFGH");
  assert.equal(calls[0].init.headers["Authorization"], undefined);
});

test("register errors are classified", async () => {
  await assert.rejects(register("http://x", "c", { fetch: fakeFetch(403, "") }), (e: any) => e instanceof RelayHTTPError && e.isRefused);
  await assert.rejects(register("http://x", "c", { fetch: fakeFetch(429, "", { "Retry-After": "60" }) }),
    (e: any) => e.isLockedOut && e.retryAfterSeconds === 60);
  await assert.rejects(register("http://x", "c", { fetch: fakeFetch(503, "") }), (e: any) => e.isTailscaleUnavailable);
  await assert.rejects(register("http://x", "c", { fetch: async () => { throw new Error("boom"); } }), RelayConnectionError);
});

test("health, state and token checks", async () => {
  assert.equal(await health("http://x", { fetch: fakeFetch(200, '{"ok":true}') }), true);
  assert.equal(await health("http://x", { fetch: fakeFetch(500, "") }), false);
  const calls: any[] = [];
  const state = await getState("http://x", "tok", { fetch: fakeFetch(200, '{"snippets":[{"label":"a","text":"b"}],"default_fps":10}', {}, calls) });
  assert.deepEqual(state, { snippets: [{ label: "a", text: "b" }], defaultFps: 10 });
  assert.equal(calls[0].init.headers["Authorization"], "Bearer tok");
  assert.equal(await tokenIsValid("http://x", "t", { fetch: fakeFetch(200, "{}") }), true);
  assert.equal(await tokenIsValid("http://x", "t", { fetch: fakeFetch(401, "") }), false);
  await assert.rejects(tokenIsValid("http://x", "t", { fetch: async () => { throw new Error("x"); } }), RelayConnectionError);
});

import { getMe, getPush } from "../src/http.js";

test("getMe reads the access level; missing means read-only", async () => {
  assert.deepEqual(await getMe("http://x", "t", { fetch: fakeFetch(200, '{"device_id":"d","scope":"control"}') }), { deviceId: "d", scope: "control" });
  assert.deepEqual(await getMe("http://x", "t", { fetch: fakeFetch(200, '{"device_id":"d"}') }), { deviceId: "d", scope: "read" });
});

test("getPush reads the ntfy subscribe address", async () => {
  assert.deepEqual(await getPush("http://x", "t", { fetch: fakeFetch(200, '{"enabled":true,"subscribe_url":"https://ntfy.sh/brb-x","include_text":false}') }),
    { enabled: true, includeText: false, subscribeUrl: "https://ntfy.sh/brb-x" });
  assert.deepEqual(await getPush("http://x", "t", { fetch: fakeFetch(200, '{"enabled":false}') }), { enabled: false, includeText: false });
});
