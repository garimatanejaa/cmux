#!/usr/bin/env python3
"""Learn acpmux's per-command auto-background waits from Claude Code transcripts.

Reads Bash calls in ~/.claude/projects/*/*.jsonl, takes each foreground call's time to its result,
and writes ~/.config/acpmux/auto-background.json: for each command prefix (the first word, or two
for gh, glaeda-gh, git, cmux-ci, reach, wt) with at least MIN_N finished calls, the wait is its
99th percentile, rounded up to 30 s and kept within [FLOOR, CEIL]. Usage: auto_background_table.py
[--days 7] [--out PATH]. Run nightly (a timer); acpmux re-reads the file when it changes.
"""
import argparse, collections, datetime, glob, json, math, os, re, time

MIN_N, FLOOR, CEIL = 200, 120, 900
TWO = {"gh", "glaeda-gh", "git", "cmux-ci", "reach", "wt"}


def prefix(cmd):
    cmd = re.sub(r"^(\s*cd [^;&]+(&&|;)\s*)+", "", cmd).strip()
    w = cmd.split()
    if not w:
        return ""
    return " ".join(w[:2]) if w[0] in TWO and len(w) > 1 else w[0]


def stamp(s):
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def durations(days):
    cut = time.time() - days * 86400
    for f in glob.glob(os.path.expanduser("~/.claude/projects/*/*.jsonl")):
        if os.path.getmtime(f) < cut:
            continue
        uses = {}
        for line in open(f, errors="replace"):
            if '"tool_use"' not in line and '"tool_result"' not in line:
                continue
            try:
                d = json.loads(line)
                t = stamp(d["timestamp"])
            except Exception:
                continue
            c = (d.get("message") or {}).get("content")
            for b in c if isinstance(c, list) else []:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "tool_use" and b.get("name") == "Bash":
                    i = b.get("input", {})
                    if not i.get("run_in_background"):
                        uses[b["id"]] = (t, i.get("command", ""))
                elif b.get("type") == "tool_result" and b.get("tool_use_id") in uses:
                    t0, cmd = uses.pop(b["tool_use_id"])
                    x = b.get("content")
                    x = " ".join(y.get("text", "") for y in x if isinstance(y, dict)) if isinstance(x, list) else (x or "")
                    if "backgrounded by user" in x or "moved to the background" in x or "did not complete within" in x:
                        continue  # not a finished foreground call
                    yield prefix(cmd), t - t0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--out", default=os.path.expanduser("~/.config/acpmux/auto-background.json"))
    a = ap.parse_args()
    by = collections.defaultdict(list)
    for k, d in durations(a.days):
        if k and d >= 0:
            by[k].append(d)
    rows = {}
    for k, v in by.items():
        if len(v) >= MIN_N:
            v.sort()
            p99 = v[min(len(v) - 1, int(len(v) * 0.99))]
            rows[k] = int(min(CEIL, max(FLOOR, math.ceil(p99 / 30) * 30)))
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    tmp = a.out + ".tmp"
    json.dump({"prefixes": dict(sorted(rows.items()))}, open(tmp, "w"), indent=1)
    os.replace(tmp, a.out)
    print(f"{len(rows)} prefixes -> {a.out}")


if __name__ == "__main__":
    main()
