import { sha256, toHex, utf8 } from "./sha256.js";
import type { DiffOp, ScreenChecksum, ScreenDiff, ScreenFull } from "./types.js";

/** What a terminal view shows for one surface. */
export interface ScreenState {
  surfaceId: string;
  rev: number;
  rows: string[];
  cols: number;
  cursor: { x: number; y: number };
  activeScreen?: string;
}

export function fromFull(frame: ScreenFull): ScreenState {
  const state: ScreenState = {
    surfaceId: frame.surface_id,
    rev: frame.rev,
    rows: [...frame.rows],
    cols: frame.cols,
    cursor: { ...frame.cursor },
  };
  if (frame.activeScreen !== undefined) state.activeScreen = frame.activeScreen;
  return state;
}

function applyOps(rows: string[], cursor: { x: number; y: number }, ops: DiffOp[]): void {
  for (const op of ops) {
    switch (op.op) {
      case "clear":
        rows.fill("");
        break;
      case "row":
        if (op.y < 0 || op.y > 100_000) break;
        while (rows.length <= op.y) rows.push("");
        rows[op.y] = op.text;
        break;
      case "cursor":
        cursor.x = op.x;
        cursor.y = op.y;
        break;
    }
  }
}

/**
 * Applies a diff to a screen. Returns the new state, or null when the diff cannot be
 * applied (different surface or a revision that does not follow), in which case the caller
 * should ask for a full screen with `surface.read_text`.
 */
export function applyDiff(state: ScreenState, diff: ScreenDiff): ScreenState | null {
  if (diff.surface_id !== state.surfaceId) return null;
  if (diff.rev <= state.rev) return state; // already seen
  const rows = [...state.rows];
  const cursor = { ...state.cursor };
  applyOps(rows, cursor, diff.ops);
  return { ...state, rev: diff.rev, rows, cursor };
}

function int64LE(value: number): number[] {
  // Two's complement, 8 bytes, little endian (matches Swift's Int on 64-bit).
  let big = BigInt(value);
  if (big < 0n) big += 1n << 64n;
  const out: number[] = [];
  for (let i = 0; i < 8; i++) {
    out.push(Number(big & 0xffn));
    big >>= 8n;
  }
  return out;
}

/** The relay's checksum over rows and cursor: first 8 bytes of SHA-256, as hex. */
export function screenHash(rows: string[], cursor: { x: number; y: number }): string {
  const parts: number[] = [];
  for (const row of rows) {
    parts.push(...utf8(row), 0x0a);
  }
  parts.push(0xff, ...int64LE(cursor.x), ...int64LE(cursor.y));
  return toHex(sha256(Uint8Array.from(parts))).slice(0, 16);
}

/**
 * Whether a checksum frame agrees with our copy of the screen. Frames for another
 * revision say nothing about this copy, so they count as consistent.
 */
export function checksumMatches(state: ScreenState, frame: ScreenChecksum): boolean {
  if (frame.surface_id !== state.surfaceId || frame.rev !== state.rev) return true;
  return screenHash(state.rows, state.cursor) === frame.hash;
}
