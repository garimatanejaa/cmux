export type KeyModifier = "ctrl" | "alt" | "shift" | "cmd";

const ORDER: KeyModifier[] = ["ctrl", "alt", "shift", "cmd"];

/** Named keys the relay understands without modifiers. */
export const SIMPLE_KEYS = [
  "enter", "tab", "esc", "up", "down", "left", "right",
  "home", "end", "page_up", "page_down", "backspace", "delete",
] as const;

/** Encodes a key the way `surface.send_key` expects: modifiers in fixed order, joined by `+`. */
export function encodeKey(name: string, modifiers: Iterable<KeyModifier> = []): string {
  const set = new Set(modifiers);
  const prefix = ORDER.filter((m) => set.has(m));
  return [...prefix, name].join("+");
}

/** Splits an encoded key back into its name and modifiers, or null if malformed. */
export function decodeKey(encoded: string): { name: string; modifiers: KeyModifier[] } | null {
  if (!encoded) return null;
  const parts = encoded.split("+");
  const name = parts.pop();
  if (!name) return null;
  const modifiers: KeyModifier[] = [];
  for (const part of parts) {
    if (!(ORDER as string[]).includes(part)) return null;
    modifiers.push(part as KeyModifier);
  }
  return { name, modifiers };
}
