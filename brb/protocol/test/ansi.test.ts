import test from "node:test";
import assert from "node:assert/strict";
import { color256, parseAnsi, stripAnsi } from "../src/ansi.js";

test("plain text is one span", () => {
  assert.deepEqual(parseAnsi("hello"), [{ text: "hello" }]);
  assert.deepEqual(parseAnsi(""), []);
});

test("basic colors, bold and reset", () => {
  const spans = parseAnsi("\u001b[1;31mred\u001b[0m plain \u001b[32mgreen");
  assert.deepEqual(spans[0], { text: "red", bold: true, fg: "#cd3131" });
  assert.deepEqual(spans[1], { text: " plain " });
  assert.deepEqual(spans[2], { text: "green", fg: "#0dbc79" });
});

test("256 and truecolor, foreground and background", () => {
  const spans = parseAnsi("\u001b[38;5;196ma\u001b[48;2;1;2;3mb\u001b[39;49mc");
  assert.equal(spans[0]!.fg, "#ff0000");
  assert.equal(spans[1]!.fg, "#ff0000");
  assert.equal(spans[1]!.bg, "#010203");
  assert.deepEqual(spans[2], { text: "c" });
  assert.equal(color256(232), "#080808");
  assert.equal(color256(15), "#ffffff");
});

test("colon-separated truecolor and bright colors", () => {
  assert.equal(parseAnsi("\u001b[38:2::10:20:30mx")[0]!.fg, "#0a141e");
  assert.equal(parseAnsi("\u001b[91mx")[0]!.fg, "#f14c4c");
});

test("styles turn off individually", () => {
  const spans = parseAnsi("\u001b[1;3;4;7;9mA\u001b[22;23;24;27;29mB");
  assert.deepEqual(spans[0], { text: "A", bold: true, italic: true, underline: true, inverse: true, strike: true });
  assert.deepEqual(spans[1], { text: "B" });
});

test("cursor, OSC and other sequences are dropped, text kept", () => {
  assert.equal(stripAnsi("a\u001b[2Kb\u001b[?25hc\u001b]0;title\u0007d\u001b(Be"), "abcde".replace("e", "e"));
  assert.equal(stripAnsi("x\u001b]8;;http://a\u001b\\link\u001b]8;;\u001b\\y"), "xlinky");
});

test("control characters other than tab are removed", () => {
  assert.equal(stripAnsi("a\u0007b\u0000c\td"), "abc\td");
});

import { withCursor } from "../src/ansi.js";

test("cursor splits a span and inverts one cell", () => {
  assert.deepEqual(withCursor([{ text: "abc", fg: "#fff" }], 1), [
    { text: "a", fg: "#fff" }, { text: "b", fg: "#fff", inverse: true }, { text: "c", fg: "#fff" },
  ]);
  assert.deepEqual(withCursor([{ text: "ab" }], 5), [{ text: "ab" }, { text: "   " }, { text: " ", inverse: true }]);
  assert.deepEqual(withCursor([], 0), [{ text: " ", inverse: true }]);
  assert.deepEqual(withCursor([{ text: "ab" }], -1), [{ text: "ab" }]);
  assert.equal(withCursor([{ text: "a" }, { text: "b" }], 1)[1]!.inverse, true);
});
