/** Turns one terminal row (raw ANSI) into styled spans a UI can draw. Only colors and text styles are kept. */

export interface Span {
  text: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  inverse?: boolean;
}

const BASE16 = [
  "#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5",
  "#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#ffffff",
];

function hex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function color256(n: number): string {
  if (n < 16) return BASE16[n] ?? "#ffffff";
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return hex(v, v, v);
  }
  const i = n - 16;
  const level = (x: number) => (x === 0 ? 0 : 55 + x * 40);
  return hex(level(Math.floor(i / 36)), level(Math.floor(i / 6) % 6), level(i % 6));
}

type Style = Omit<Span, "text">;

function applySgr(style: Style, params: number[]): Style {
  let s: Style = { ...style };
  for (let i = 0; i < params.length; i++) {
    const p = params[i]!;
    if (p === 0) s = {};
    else if (p === 1) s.bold = true;
    else if (p === 2) s.dim = true;
    else if (p === 3) s.italic = true;
    else if (p === 4) s.underline = true;
    else if (p === 7) s.inverse = true;
    else if (p === 9) s.strike = true;
    else if (p === 22) { delete s.bold; delete s.dim; }
    else if (p === 23) delete s.italic;
    else if (p === 24) delete s.underline;
    else if (p === 27) delete s.inverse;
    else if (p === 29) delete s.strike;
    else if (p >= 30 && p <= 37) s.fg = BASE16[p - 30]!;
    else if (p >= 90 && p <= 97) s.fg = BASE16[p - 90 + 8]!;
    else if (p === 39) delete s.fg;
    else if (p >= 40 && p <= 47) s.bg = BASE16[p - 40]!;
    else if (p >= 100 && p <= 107) s.bg = BASE16[p - 100 + 8]!;
    else if (p === 49) delete s.bg;
    else if (p === 38 || p === 48) {
      const target = p === 38 ? "fg" : "bg";
      const mode = params[i + 1];
      if (mode === 5 && params[i + 2] !== undefined) {
        s[target] = color256(params[i + 2]!);
        i += 2;
      } else if (mode === 2 && params[i + 4] !== undefined) {
        s[target] = hex(params[i + 2]!, params[i + 3]!, params[i + 4]!);
        i += 4;
      } else {
        break;
      }
    }
  }
  return s;
}

// ESC [ params final | ESC ] ... (BEL | ESC \) | other two-byte escapes
const ESCAPE = /\u001b(?:\[([0-9;:?<=> ]*)([@-~])|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[()*+][0-9A-Za-z@]|[@-Z\\-_])/g;

export function parseAnsi(line: string): Span[] {
  const spans: Span[] = [];
  let style: Style = {};
  let last = 0;
  const push = (text: string) => {
    if (text) spans.push({ text, ...style });
  };
  for (const match of line.matchAll(ESCAPE)) {
    push(line.slice(last, match.index));
    last = match.index! + match[0].length;
    if (match[2] === "m") {
      const raw = match[1] ?? "";
      const params: number[] = [];
      for (const token of raw === "" ? ["0"] : raw.split(";")) {
        if (token.includes(":")) {
          const parts = token.split(":").map((x) => (x === "" ? 0 : Number(x)));
          // 38:2:<colorspace>:r:g:b carries an extra colorspace field; drop it.
          if ((parts[0] === 38 || parts[0] === 48) && parts[1] === 2 && parts.length >= 6) parts.splice(2, 1);
          params.push(...parts);
        } else {
          params.push(token === "" ? 0 : Number(token));
        }
      }
      style = applySgr(style, params);
    }
  }
  push(line.slice(last).replace(/[\u0000-\u0008\u000b-\u001f]/g, ""));
  return spans;
}

/** The row without any styling. */
export function stripAnsi(line: string): string {
  return parseAnsi(line).map((s) => s.text).join("");
}

/**
 * Marks the cursor cell in a row: splits the spans at column `x` and flips that cell to inverse.
 * Columns count characters; a cursor past the end of the row adds a blank cell.
 */
export function withCursor(spans: Span[], x: number): Span[] {
  if (x < 0) return spans;
  const out: Span[] = [];
  let column = 0;
  let placed = false;
  for (const span of spans) {
    const chars = Array.from(span.text);
    if (placed || x >= column + chars.length) {
      out.push(span);
      column += chars.length;
      continue;
    }
    const offset = x - column;
    const before = chars.slice(0, offset).join("");
    const at = chars[offset]!;
    const after = chars.slice(offset + 1).join("");
    const { text: _text, ...style } = span;
    if (before) out.push({ text: before, ...style });
    out.push({ text: at, ...style, inverse: !style.inverse });
    if (after) out.push({ text: after, ...style });
    column += chars.length;
    placed = true;
  }
  if (!placed) {
    if (x > column) out.push({ text: " ".repeat(x - column) });
    out.push({ text: " ", inverse: true });
  }
  return out;
}
