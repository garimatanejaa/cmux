// l10n-allow-file: probe
import { afterAll, beforeAll, test } from "bun:test";
import type { AcpmuxRow } from "../model";
import { turnView } from "./turns";
beforeAll(() => { globalThis.cmuxExperiments = { "claude-turn-fold": "runs" }; });
afterAll(() => { delete globalThis.cmuxExperiments; });
const START = Date.UTC(2026, 10, 24, 1, 0, 0);
const row = (id: string, kind: string, second: number, extra: Partial<AcpmuxRow> = {}): AcpmuxRow => ({ id, kind, version: 1, at: START + second * 1000, ...extra });
const note = (i: number, extra: Partial<AcpmuxRow> = {}) => row(`n-${i}`, "user", 400 + i, { text: `<task-notification>x</task-notification>`, steer: "landed", incoming: { kind: "notice", text: `Agent ${i} completed`, lineOrigin: "task-notification" }, ...extra } as never);
const peer = (i: number) => row(`p-${i}`, "user", 450 + i, { text: "hi", steer: "landed", incoming: { kind: "message", message: { name: `lane-${i}`, text: "done", raw: "done", lineOrigin: "peer" } } } as never);
const inbox = (i: number) => row(`i-${i}`, "user", 470 + i, { text: "inbox", steer: "landed", incoming: { kind: "inbox", notice: { threads: [{ id: `t${i}`, label: "", from: ["lane-x"], count: 2, preview: "p", blocker: false, promptIds: [] }] } } } as never);
const report = (i: number) => row(`backgroundTurn-r${i}`, "backgroundTurn", 490 + i, { background: { id: `r${i}`, trigger: "task_notification", running: false, quiet: true, hasRows: true, cause: { kind: "subagent", status: "completed", weight: "result" } } } as never);
const work = row("t-1", "activity", 1, { items: [{ kind: "tool", text: "", tool: { id: "c1", title: "bun test", kind: "execute", status: "completed" } }] } as never);
const steered = (burst: AcpmuxRow[]): AcpmuxRow[] => [
  row("u-0", "user", 0, { text: "Land the lanes" }), work,
  row("s-1", "user", 100, { text: "Also check lane 9", steer: "landed" }),
  row("a-1", "assistant", 300, { text: "Checked; lane 9 is green." }),
  row("sum", "turnSummary", 310, { status: "completed", durationMs: 310_000, toolCount: 1 }),
  ...burst,
];
const show = (name: string, rows: AcpmuxRow[]) => {
  const v = turnView(rows, new Set(), { agentFamily: "claude", now: START + 900_000 }).filter((r) => r.kind !== "date");
  console.log(`== ${name}\n` + v.map((r) => `${r.id} ${r.kind}${r.foldOpen !== undefined ? ` open=${r.foldOpen}` : ""}${r.toolCount !== undefined ? ` tc=${r.toolCount}` : ""}${r.backgroundRun ? ` run=${JSON.stringify(r.backgroundRun)}` : ""}`).join("\n"));
};
test("probe", () => {
  show("notes after steer", steered([note(0), note(1), note(2)]));
  show("notes + summary each", steered([note(0), row("a-n0", "assistant", 401, { text: "." }), row("sum2", "turnSummary", 402, { status: "completed", toolCount: 0 }), note(1)]));
  show("peers", steered([peer(0), peer(1)]));
  show("inbox", steered([inbox(0)]));
  show("reports", steered([report(0), report(1)]));
  show("mixed", steered([note(0), peer(0), inbox(0), note(1)]));
  show("legacy notice opens turn", [...steered([]), row("L-0", "user", 500, { text: "<task-notification>", incoming: { kind: "notice", text: "Agent done" } } as never), row("L-a", "assistant", 501, { text: "." }), row("L-s", "turnSummary", 502, { status: "completed", toolCount: 0 })]);
  show("legacy notice steer", steered([note(0, { incoming: { kind: "notice", text: "Agent done" } } as never), note(1, { incoming: { kind: "notice", text: "Agent done" } } as never)]));
  show("notes then reply turn", [...steered([note(0), note(1), row("a-2", "assistant", 420, { text: "Both lanes are done." }), row("sum2", "turnSummary", 430, { status: "completed", toolCount: 0 })])]);
  show("report tail turn", [...steered([report(0), row("a-2", "assistant", 495, { text: "Helper reported.", inBackground: "r0" }), row("sum2", "turnSummary", 496, { status: "completed", toolCount: 0 })])]);
  show("no steer, notes after answer", [row("u-0", "user", 0, { text: "Go" }), work, row("a-1", "assistant", 300, { text: "Done." }), row("sum", "turnSummary", 310, { status: "completed", toolCount: 1 }), note(0), note(1)]);
});
