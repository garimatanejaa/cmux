import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha256, toHex, utf8 } from "../src/sha256.js";
import { applyDiff, checksumMatches, fromFull, screenHash } from "../src/screen.js";
import { decodeKey, encodeKey } from "../src/keys.js";
import type { ScreenDiff, ScreenFull } from "../src/types.js";

test("sha256 matches node for many lengths", () => {
  for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 1000]) {
    const data = Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 0xff);
    assert.equal(toHex(sha256(data)), createHash("sha256").update(data).digest("hex"), `length ${n}`);
  }
  const text = "héllo ✅ \u001b[31mred\u001b[0m";
  assert.equal(toHex(sha256(utf8(text))), createHash("sha256").update(text).digest("hex"));
});

test("screenHash follows the relay's recipe (rows + LF, 0xFF, cursor as two LE int64)", () => {
  const rows = ["abc", "", "ünï"];
  const cursor = { x: 5, y: -1 };
  const bytes: number[] = [];
  for (const r of rows) bytes.push(...Buffer.from(r, "utf8"), 0x0a);
  bytes.push(0xff);
  const buf = Buffer.alloc(16);
  buf.writeBigInt64LE(BigInt(cursor.x), 0);
  buf.writeBigInt64LE(BigInt(cursor.y), 8);
  bytes.push(...buf);
  const expected = createHash("sha256").update(Uint8Array.from(bytes)).digest("hex").slice(0, 16);
  assert.equal(screenHash(rows, cursor), expected);
});

const full: ScreenFull = {
  type: "screen.full", surface_id: "s1", rev: 1, rows: ["a", "b"], cols: 80, rowsCount: 2, cursor: { x: 0, y: 0 },
};

test("diff applies rows and cursor, ignores old revisions, rejects other surfaces", () => {
  const state = fromFull(full);
  const diff: ScreenDiff = {
    type: "screen.diff", surface_id: "s1", rev: 2,
    ops: [{ op: "row", y: 1, text: "B" }, { op: "row", y: 3, text: "d" }, { op: "cursor", x: 2, y: 1 }],
  };
  const next = applyDiff(state, diff)!;
  assert.deepEqual(next.rows, ["a", "B", "", "d"]);
  assert.deepEqual(next.cursor, { x: 2, y: 1 });
  assert.equal(next.rev, 2);
  assert.equal(applyDiff(next, { ...diff, rev: 2 }), next);
  assert.equal(applyDiff(state, { ...diff, surface_id: "other" }), null);
  const cleared = applyDiff(next, { type: "screen.diff", surface_id: "s1", rev: 3, ops: [{ op: "clear" }] })!;
  assert.deepEqual(cleared.rows, ["", "", "", ""]);
  assert.deepEqual(state.rows, ["a", "b"], "input state is not mutated");
});

test("checksum check", () => {
  const state = fromFull(full);
  const good = { type: "screen.checksum" as const, surface_id: "s1", rev: 1, hash: screenHash(state.rows, state.cursor) };
  assert.equal(checksumMatches(state, good), true);
  assert.equal(checksumMatches(state, { ...good, hash: "0000000000000000" }), false);
  assert.equal(checksumMatches(state, { ...good, rev: 9, hash: "0000000000000000" }), true);
});

test("keys encode in fixed modifier order and decode back", () => {
  assert.equal(encodeKey("c", ["shift", "ctrl"]), "ctrl+shift+c");
  assert.equal(encodeKey("enter"), "enter");
  assert.deepEqual(decodeKey("ctrl+alt+up"), { name: "up", modifiers: ["ctrl", "alt"] });
  assert.equal(decodeKey("hyper+x"), null);
  assert.equal(decodeKey(""), null);
});
