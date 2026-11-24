// The environment picker's Cloud row (Labs, cloudRun.ts): picking it makes Cloud where the new
// chat runs and hands the keyboard back to the prompt, on the first pick as on a repeat, so Return
// sends the draft. A machine picked after it makes the chat a chat here again.
import { afterEach, expect, test } from "bun:test";
import { act, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { EnvironmentPicker } from "./EnvironmentPicker";
import type { RunMode } from "./sandboxRun";
import { translate } from "./i18n";
import { settleReact } from "../../../test/support/domTeardown";

let dom: JSDOM | undefined;
let root: Root | undefined;
const scope = globalThis as Record<string, unknown>;
const saved = new Map<string, unknown>();

function installDom(): HTMLElement {
  dom = new JSDOM("<!doctype html><html><body><main id=root></main></body></html>");
  const requestAnimationFrame = (callback: FrameRequestCallback) =>
    setTimeout(() => callback(Date.now()), 0) as unknown as number;
  for (const key of [
    "window",
    "document",
    "navigator",
    "Node",
    "HTMLElement",
    "Element",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "IS_REACT_ACT_ENVIRONMENT",
  ])
    saved.set(key, scope[key]);
  Object.assign(scope, {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame,
    cancelAnimationFrame: (handle: number) => clearTimeout(handle),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  return dom.window.document.getElementById("root")!;
}

afterEach(async () => {
  if (root)
    await act(async () => {
      root!.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  root = undefined;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await settleReact();
  dom?.window.close();
  dom = undefined;
  for (const [key, value] of saved) {
    if (value === undefined) delete scope[key];
    else scope[key] = value;
  }
  saved.clear();
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/// A new chat's composer: its prompt, and the picker with Run as rows the test can read back.
function Composer({ modes, picks, start }: { modes: RunMode[]; picks: string[]; start: RunMode }) {
  const [mode, setMode] = useState<RunMode>(start);
  return (
    <div className="nt-composer">
      <textarea aria-label="prompt" />
      <EnvironmentPicker
        label="Environment"
        menu="Computer"
        value="This Mac"
        face={<span>{mode === "cloud" ? "Cloud" : "This Mac"}</span>}
        environments={[
          { id: "local", label: "This Mac", kind: "local", connected: true },
          { id: "gpu-box", label: "gpu-box", kind: "ssh", connected: true },
        ]}
        current="local"
        onPick={(id) => picks.push(id)}
        runMode={{
          mode,
          onMode: (next) => {
            modes.push(next);
            setMode(next);
          },
        }}
      />
    </div>
  );
}

async function render(start: RunMode) {
  const container = installDom();
  const modes: RunMode[] = [];
  const picks: string[] = [];
  await act(async () => {
    root = createRoot(container);
    root.render(<Composer modes={modes} picks={picks} start={start} />);
  });
  return { container, modes, picks };
}

async function open(container: HTMLElement) {
  await act(async () => container.querySelector<HTMLButtonElement>(".acpmux-location-button")!.click());
  await settle();
}

/// The machine list: Machines… on the control's right-click menu (the main list is This Mac and Cloud).
async function openMachines(container: HTMLElement) {
  const button = container.querySelector<HTMLButtonElement>(".acpmux-location-button")!;
  await act(async () =>
    button.dispatchEvent(
      new dom!.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
    ),
  );
  const item = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].find(
    (candidate) => candidate.textContent === translate("composer.machinesList"),
  );
  expect(item).toBeTruthy();
  await act(async () => item!.click());
  await settle();
}

async function choose(selector: string) {
  const row = document.querySelector<HTMLElement>(`.acpmux-env-popover ${selector}`);
  expect(row).not.toBeNull();
  const option = row!.closest<HTMLElement>('[role="option"]') ?? row!;
  await act(async () => option.click());
  await settle();
}

test("the Cloud row heads the Cloud section and picking it makes Cloud the mode and focuses the prompt", async () => {
  const { container, modes } = await render("persistent");
  await open(container);
  await choose('[data-mode="cloud"]');
  expect(modes).toEqual(["cloud"]);
  // The first pick too: the popover returns no focus, so Return would not reach the prompt.
  expect(document.activeElement).toBe(container.querySelector("textarea"));
  expect(container.querySelector(".acpmux-location-button")?.textContent).toBe("Cloud");
});

test("picking Cloud again changes nothing and still focuses the prompt", async () => {
  const { container, modes } = await render("cloud");
  await open(container);
  expect(document.querySelector('.acpmux-env-popover [data-mode="cloud"][data-current]')).not.toBeNull();
  await choose('[data-mode="cloud"]');
  expect(modes).toEqual([]);
  expect(document.activeElement).toBe(container.querySelector("textarea"));
});

test("a machine picked while Cloud is the mode makes the chat a chat here again", async () => {
  const { container, modes, picks } = await render("cloud");
  await openMachines(container);
  await choose('[data-kind="ssh"]');
  expect(modes).toEqual(["persistent"]);
  expect(picks).toEqual(["gpu-box"]);
});

// A new chat's list (Leo, 2026-11-23, of Other devices counting 51: "another chevron, just like how
// cloud goes to another chevron"): This Mac, Cloud (a chevron), the person's own machines as rows
// with ⌥⌘ keys, then Agent machines (a count and a chevron) that cascades BESIDE the list, where
// acpmux's `group` says agent. Add Machine… ends the list.
const DEVICES = [
  { id: "local", label: "This Mac", kind: "local" as const, connected: true },
  { id: "studio", label: "studio", kind: "ssh" as const, connected: true, group: "own" as const },
  { id: "laptop", label: "laptop", kind: "ssh" as const, state: "connecting", group: "own" as const },
  { id: "gpu-box", label: "gpu-box", kind: "ssh" as const, connected: true, group: "own" as const, liveSessions: 3 },
  { id: "lane-1", label: "gcp-agent-lane-1", kind: "ssh" as const, connected: true, group: "agent" as const, liveSessions: 2 },
  { id: "lane-2", label: "gcp-agent-lane-2", kind: "ssh" as const, connected: true, group: "agent" as const },
  { id: "lane-3", label: "gcp-agent-lane-3", kind: "ssh" as const, state: "offline", group: "agent" as const },
  { id: "vm-1", label: "vm-1", kind: "cloud" as const, connected: true },
];

async function renderDevices(
  environments: ComponentProps<typeof EnvironmentPicker>["environments"],
  props: Partial<ComponentProps<typeof EnvironmentPicker>> = {},
) {
  const container = installDom();
  const picks: string[] = [];
  const connects: string[] = [];
  await act(async () => {
    root = createRoot(container);
    root.render(
      <div className="nt-composer">
        <textarea aria-label="prompt" />
        <EnvironmentPicker
          label="Environment"
          menu="Computer"
          value="This Mac"
          face={<span>This Mac</span>}
          environments={environments}
          current="local"
          onPick={(id) => picks.push(id)}
          onConnect={(kind) => connects.push(kind)}
          otherDevices
          {...props}
        />
      </div>,
    );
  });
  return { container, picks, connects };
}

const optionRows = (scope = ".acpmux-env-popover") =>
  [...document.querySelectorAll<HTMLElement>(`${scope} [role="option"]`)].filter(
    (option) => option.querySelector(".acpmux-env-row") !== null,
  );
const rowLabel = (option: HTMLElement) => option.querySelector(".acpmux-menu-label")?.textContent ?? "";
const cascadeRows = () => optionRows(".acpmux-env-cascade");

// A new chat's list: Cloud is where it may run (`runMode`).
const NEW_CHAT = { runMode: { mode: "persistent" as RunMode, onMode: () => undefined } };

test("the list is This Mac, Cloud, the person's own machines, Agent machines, Add Machine…", async () => {
  const { container } = await renderDevices(DEVICES, NEW_CHAT);
  await open(container);
  expect(optionRows().map(rowLabel)).toEqual([
    translate("composer.thisMac"),
    translate("composer.cloud"),
    "gpu-box",
    "studio",
    "laptop",
    translate("composer.agentMachines"),
    translate("composer.addMachine"),
  ]);
});

test("Agent machines counts only the agent machines a chat can start on, and has a chevron", async () => {
  const { container } = await renderDevices(DEVICES, NEW_CHAT);
  await open(container);
  const row = document.querySelector('.acpmux-env-popover [data-action="agentMachines"]')!;
  // lane-1 and lane-2 are ready; lane-3 is offline and vm-1 is a Cloud machine.
  expect(row.querySelector(".acpmux-env-count")?.textContent).toBe("2");
  expect(row.querySelector(".acpmux-env-more-chevron")).not.toBeNull();
});

test("only This Mac, Cloud and the person's own machines carry ⌥⌘ keys; an agent machine never does", async () => {
  const { container } = await renderDevices(DEVICES, NEW_CHAT);
  await open(container);
  const keys = optionRows().map((row) => row.querySelector(".acpmux-env-key")?.textContent ?? "");
  expect(keys).toEqual(["⌥⌘1", "⌥⌘2", "⌥⌘3", "⌥⌘4", "", "", ""]);
  await choose('[data-action="agentMachines"]');
  expect(cascadeRows().some((row) => row.querySelector(".acpmux-env-key") !== null)).toBe(false);
});

test("a row says live sessions when acpmux says so, never SSH", async () => {
  const { container } = await renderDevices(DEVICES, NEW_CHAT);
  await open(container);
  const descriptions = optionRows().map((row) => row.querySelector(".acpmux-menu-description")?.textContent ?? "");
  expect(descriptions[2]).toBe(translate("composer.envLive", { n: 3 }));
  expect(descriptions.join(" ")).not.toContain(translate("composer.envSSH"));
});

test("Agent machines opens beside the list: the list stays, ready machines first, the unreachable under Unavailable", async () => {
  const { container, picks } = await renderDevices(DEVICES, NEW_CHAT);
  await open(container);
  await choose('[data-action="agentMachines"]');
  // The parent list is still open and still lists its rows.
  expect(optionRows().map(rowLabel)).toContain("studio");
  expect(document.querySelector(".acpmux-env-cascade")).not.toBeNull();
  expect(cascadeRows().map(rowLabel)).toEqual([
    "gcp-agent-lane-1",
    "gcp-agent-lane-2",
    translate("composer.envUnavailableGroup", { n: 1 }),
  ]);
  expect(cascadeRows()[0]!.querySelector(".acpmux-menu-description")?.textContent).toBe(
    translate("composer.envLive", { n: 2 }),
  );
  // The parent stays clickable: a pick there closes everything.
  await act(async () => optionRows().find((row) => rowLabel(row) === "studio")!.click());
  await settle();
  expect(picks).toEqual(["studio"]);
  expect(document.querySelector(".acpmux-env-popover")).toBeNull();
});

test("a pick in the Agent machines cascade is the machine's pick", async () => {
  const { container, picks } = await renderDevices(DEVICES, NEW_CHAT);
  await open(container);
  await choose('[data-action="agentMachines"]');
  await act(async () => cascadeRows()[0]!.click());
  await settle();
  expect(picks).toEqual(["lane-1"]);
  expect(document.querySelector(".acpmux-env-popover")).toBeNull();
});

test("← and Escape go back one level: the cascade closes, the list stays", async () => {
  const { container } = await renderDevices(DEVICES, NEW_CHAT);
  await open(container);
  const key = async (target: Element, name: string) =>
    act(async () => {
      target.dispatchEvent(new dom!.window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
    });
  await choose('[data-action="agentMachines"]');
  const field = () => document.querySelector<HTMLInputElement>(".acpmux-env-cascade input")!;
  await key(field(), "ArrowLeft");
  await settle();
  expect(document.querySelector(".acpmux-env-cascade")).toBeNull();
  expect(document.querySelector(".acpmux-env-popover")).not.toBeNull();
  await choose('[data-action="agentMachines"]');
  await key(field(), "Escape");
  await settle();
  expect(document.querySelector(".acpmux-env-cascade")).toBeNull();
  expect(document.querySelector(".acpmux-env-popover")).not.toBeNull();
});

test("Cloud's chevron opens its options beside the list: Auto, checked while Cloud is the pick, then the slot's rows", async () => {
  const slot: string[] = [];
  const { container } = await renderDevices(DEVICES, {
    runMode: { mode: "cloud" as RunMode, onMode: () => undefined },
    cloudOptions: [{ id: "hybrid", label: "Hybrid start", onSelect: () => slot.push("hybrid") }],
  });
  await open(container);
  const cloud = document.querySelector<HTMLElement>('.acpmux-env-popover [data-cascade="cloud"]')!;
  await act(async () => cloud.dispatchEvent(new dom!.window.Event("pointerover", { bubbles: true })));
  await settle();
  const options = [...document.querySelectorAll<HTMLElement>(".ui-cascade-option")];
  expect(options.map((option) => option.querySelector(".acpmux-menu-label")?.textContent)).toEqual([
    translate("composer.cloudAuto"),
    "Hybrid start",
  ]);
  expect(options[0]!.getAttribute("aria-checked")).toBe("true");
  await act(async () => options[1]!.click());
  await settle();
  expect(slot).toEqual(["hybrid"]);
  expect(document.querySelector(".acpmux-env-popover")).toBeNull();
});

test("typing searches every level: an agent machine is found from the list", async () => {
  const many = [
    ...DEVICES,
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `fs-${i}`,
      label: `fs-agent-lane-${i}`,
      kind: "ssh" as const,
      connected: true,
      group: "agent" as const,
    })),
  ];
  const { container } = await renderDevices(many, NEW_CHAT);
  await open(container);
  const field = document.querySelector<HTMLInputElement>(".acpmux-env-popover input")!;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(dom!.window.HTMLInputElement.prototype, "value")!.set!;
    set.call(field, "fs-agent-lane-3");
    field.dispatchEvent(new dom!.window.Event("input", { bubbles: true }));
  });
  await settle();
  expect(optionRows().map(rowLabel)).toEqual(["fs-agent-lane-3"]);
});

test("with no machine the list is This Mac, Cloud and Add Machine…, with no Agent machines row", async () => {
  const { container, connects } = await renderDevices([DEVICES[0]!, DEVICES[7]!]);
  await open(container);
  expect(document.querySelector('.acpmux-env-popover [data-action="agentMachines"]')).toBeNull();
  await choose('[data-action="addMachine"]');
  expect(connects).toEqual(["addMachine"]);
});

test("a device picked stays checked in the list", async () => {
  const picked = await renderDevices(DEVICES, { current: "studio", ...NEW_CHAT });
  await open(picked.container);
  const studio = optionRows().find((row) => rowLabel(row) === "studio")!;
  expect(studio.querySelector("[data-current]")).not.toBeNull();
});

test("without otherDevices (a started chat, the machine list) the main list has no Agent machines row", async () => {
  const { container } = await renderDevices(DEVICES, { otherDevices: false });
  await open(container);
  expect(document.querySelector('.acpmux-env-popover [data-action="agentMachines"]')).toBeNull();
});

// cmux#47677: the Where menu's Cloud row with no run-mode rows (before the host's check answered, a
// chat Cloud isn't offered to) ran New Cloud Machine, which made a machine and a workspace on the
// click. Picking Cloud now makes nothing: no connect, no machine pick.
test("Cloud with no run mode makes nothing: no New Cloud Machine, no machine pick", async () => {
  // A page on its Cloud machine: the row is where the chat runs, and picking it makes nothing.
  const { container, connects, picks } = await renderDevices(DEVICES, { current: "vm-1" });
  await open(container);
  await choose('[data-kind="cloud"]');
  expect(document.querySelector(".acpmux-env-popover")).toBeNull();
  expect(connects).toEqual([]);
  expect(picks).toEqual([]);
});

test("with no run mode and the chat not on Cloud, the list offers no Cloud row that would do nothing", async () => {
  const { container, connects } = await renderDevices(DEVICES);
  await open(container);
  expect(
    document.querySelector('.acpmux-env-popover [data-action="cloud"], .acpmux-env-popover [data-kind="cloud"]'),
  ).toBeNull();
  expect(connects).toEqual([]);
});

// A started chat's Move to… list opens on where the chat runs now, checked: the person sees what
// they are moving from. Picking that row moves nothing and closes the list.
test("Move to… lists where the chat runs now, checked, before its targets; picking it moves nothing", async () => {
  const moves: string[] = [];
  const { container, picks } = await renderDevices(DEVICES.slice(0, 1), {
    otherDevices: false,
    onOffload: () => undefined,
    offload: "move",
    moveTargets: [
      { id: "vm-dev", label: "dev-box", kind: "cloud" },
      { id: "vm-gpu", label: "gpu-box", kind: "cloud" },
    ],
    onMoveTo: (id) => moves.push(id),
  });
  await open(container);
  await choose('[data-action="moveTo"]');
  expect(optionRows().map(rowLabel)).toEqual(["This Mac", "dev-box", "gpu-box"]);
  const here = document.querySelector<HTMLElement>('.acpmux-env-moves [data-action="moveHere"]')!;
  expect(here.hasAttribute("data-current")).toBe(true);
  expect(here.querySelector(".acpmux-location-check svg")).not.toBeNull();
  expect(document.querySelectorAll(".acpmux-env-moves [data-current]").length).toBe(1);
  await choose('[data-action="moveHere"]');
  expect(document.querySelector(".acpmux-env-popover")).toBeNull();
  expect(moves).toEqual([]);
  expect(picks).toEqual([]);
});

test("a target picked from Move to… still moves the chat there", async () => {
  const moves: string[] = [];
  const { container } = await renderDevices(DEVICES.slice(0, 1), {
    otherDevices: false,
    onOffload: () => undefined,
    offload: "move",
    moveTargets: [
      { id: "vm-dev", label: "dev-box", kind: "cloud" },
      { id: "vm-gpu", label: "gpu-box", kind: "cloud" },
    ],
    onMoveTo: (id) => moves.push(id),
  });
  await open(container);
  await choose('[data-action="moveTo"]');
  await choose('[data-action="moveTarget"]');
  expect(moves).toEqual(["vm-dev"]);
});

// cmux#51745: the Environment dropdown resizes as the model menu does, from its edges away from the
// chip, and keeps its size for every composer.
test("the Environment dropdown has resize grips on its edges away from the chip and opens at its kept size", async () => {
  const { setPopupSize } = await import("../../ui/PopupResize");
  setPopupSize("composer.environment", { width: 300, height: 220 });
  try {
    const { container } = await render("persistent");
    await open(container);
    const popup = document.querySelector<HTMLElement>(".acpmux-env-popover")!;
    expect(popup).not.toBeNull();
    const side = popup.dataset.side === "bottom" ? "bottom" : "top";
    expect(popup.querySelector('.ui-popup-resize[data-axis="y"]')?.getAttribute("data-side")).toBe(side);
    expect(popup.querySelector('.ui-popup-resize[data-axis="x"]')?.getAttribute("data-edge")).toBe("end");
    expect(popup.querySelector('.ui-popup-resize[data-axis="both"]')).not.toBeNull();
    expect(popup.style.width).toContain("300px");
    expect(popup.style.height).toContain("220px");
  } finally {
    setPopupSize("composer.environment", { width: undefined, height: undefined });
  }
});
