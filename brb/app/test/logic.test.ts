import test from "node:test";
import assert from "node:assert/strict";
import { ntfyDeepLink, replyFor, toBaseUrl } from "../src/logic.ts";

test("addresses become base URLs", () => {
  assert.equal(toBaseUrl("100.101.102.103"), "http://100.101.102.103:4399");
  assert.equal(toBaseUrl(" mac.tail1234.ts.net "), "http://mac.tail1234.ts.net:4399");
  assert.equal(toBaseUrl("100.1.2.3:5000"), "http://100.1.2.3:5000");
  assert.equal(toBaseUrl("https://mac.ts.net/"), "https://mac.ts.net");
  assert.equal(toBaseUrl(""), null);
  assert.equal(toBaseUrl("not a host"), null);
  assert.equal(toBaseUrl("http://"), null);
});

const permission = { id: "1", request_id: "r1", kind: "permission", source: "claude", workstream_id: "w" } as const;
const plan = { ...permission, kind: "plan" } as const;
const question = { ...permission, kind: "question" } as const;

test("replies match what the relay accepts for each kind", () => {
  assert.deepEqual(replyFor(permission, "once"), { request_id: "r1", kind: "permission", mode: "once" });
  assert.equal(replyFor(permission, "autoAccept"), null);
  assert.deepEqual(replyFor(plan, "autoAccept"), { request_id: "r1", kind: "plan", mode: "autoAccept" });
  assert.equal(replyFor(plan, "once"), null);
  assert.deepEqual(replyFor(question, "", ["A"]), { request_id: "r1", kind: "question", selections: ["A"] });
  assert.equal(replyFor(question, "", []), null);
  assert.equal(replyFor(question, "once"), null);
});

test("ntfy deep links", () => {
  assert.equal(ntfyDeepLink("https://ntfy.sh/brb-x"), "ntfy://ntfy.sh/brb-x");
  assert.equal(ntfyDeepLink("https://my.example.com/brb-x"), "ntfys://my.example.com/brb-x");
  assert.equal(ntfyDeepLink("http://10.0.0.5:8080/brb-x"), "ntfy://10.0.0.5:8080/brb-x");
});
