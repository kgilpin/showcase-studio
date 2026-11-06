#!/usr/bin/env python3
"""Grades one rehearsal run from its transcript, never from the session's
own summary: every tool call in order with a one-line gist, the counts,
the cost, the scenario's rubric as a yes/no table, and the session's last
long message (its real recap). Usage: grade.py <run folder>

The run folder holds transcript.jsonl (claude -p --output-format
stream-json) and sits under <out>/<scenario>/<name>/, so the rubric is
rehearsal/scenarios/<scenario>/rubric.yaml."""
import json
import re
import sys
from collections import Counter
from pathlib import Path

run = Path(sys.argv[1]).resolve()
PLUGIN = "mcp__plugin_showcase-studio_showcase-studio__"
STUDIO = "mcp__showcase-studio__"


def short(name):
    return name.replace(PLUGIN, "studio.").replace(STUDIO, "studio.")


def load_rubric():
    scenario = run.parent.name
    here = Path(__file__).resolve().parent.parent.parent
    file = here / "rehearsal" / "scenarios" / scenario / "rubric.yaml"
    if not file.exists():
        return None
    try:
        import yaml  # type: ignore

        return yaml.safe_load(file.read_text())
    except ImportError:
        pass
    # A small reader for the rubric's own shape: keys, lists, and one level of maps.
    data, current, sub = {}, None, None
    for raw in file.read_text().splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        if not line.startswith(" "):
            key, _, value = line.partition(":")
            current, sub = key.strip(), None
            data[current] = value.strip() or None
            if data[current] is None:
                data[current] = {}
        elif line.strip().startswith("- "):
            if not isinstance(data[current], list):
                data[current] = []
            data[current].append(line.strip()[2:].strip().strip('"'))
        else:
            key, _, value = line.strip().partition(":")
            data[current][key.strip()] = int(value) if value.strip().isdigit() else value.strip()
    return data


events = []
for line in (run / "transcript.jsonl").read_text().splitlines():
    line = line.strip()
    if not line:
        continue
    try:
        events.append(json.loads(line))
    except json.JSONDecodeError:
        pass

calls, results, texts, usage = [], {}, [], None
for ev in events:
    t = ev.get("type")
    if t == "assistant":
        for b in ev.get("message", {}).get("content", []):
            if b.get("type") == "tool_use":
                calls.append((b["id"], short(b["name"]), b.get("input", {})))
            elif b.get("type") == "text" and len(b.get("text", "")) > 400:
                texts.append(b["text"])
    elif t == "user":
        for b in ev.get("message", {}).get("content", []):
            if b.get("type") == "tool_result":
                c = b.get("content")
                text = c if isinstance(c, str) else " ".join(
                    x.get("text", "") for x in (c or []) if isinstance(x, dict) and x.get("type") == "text"
                )
                results[b["tool_use_id"]] = (bool(b.get("is_error")), text)
    elif t == "result" and ev.get("num_turns", 0) > 1:
        usage = {k: ev.get(k) for k in ("duration_ms", "num_turns", "total_cost_usd")}


def gist(name, inp):
    if name == "studio.edit_showcase":
        edits = inp.get("edits", [])
        return f"{len(edits)} edits " + str(sorted({str(e.get('field', '')) for e in edits})[:6])
    if name == "studio.screenshot_frame":
        return f"atMs={inp.get('atMs')} safeArea={inp.get('safeArea')}"
    if name == "studio.ffmpeg":
        return f"output={inp.get('output')}"
    if name == "Bash":
        return (inp.get("command") or "")[:100].replace("\n", " ")
    if name in ("Read", "Write", "Edit"):
        return str(inp.get("file_path", "")).replace(str(run), "<run>")
    if name == "Skill":
        return inp.get("skill", "")
    if name.startswith("studio."):
        return json.dumps({k: v for k, v in inp.items() if k != "edits"})[:100]
    return json.dumps(inp)[:80]


print(f"== {run.parent.name}/{run.name}: {len(calls)} tool calls, {usage}")
print()
for i, (cid, name, inp) in enumerate(calls, 1):
    err, text = results.get(cid, (False, ""))
    tail = ""
    if name == "studio.check_framing":
        try:
            tail = " -> " + json.loads(text).get("summary", "")
        except Exception:
            tail = " -> " + text[:100]
    print(f"{i:3d} {name:28s} {gist(name, inp)}{' !! ERROR' if err else ''}{tail}")
print()
counts = Counter(name for _, name, _ in calls)
print("== per tool")
for name, n in counts.most_common():
    print(f"{n:4d} {name}")

# A run from source: every look at the studio's code is a finding on its
# own — a user's session has no source, so what it learned there, it
# learned a way the user's session can't.
try:
    meta = json.loads((run / "run.json").read_text())
except (OSError, json.JSONDecodeError):
    meta = {}
source = meta.get("source") or ""
if source:
    plugin = str(Path(source) / "plugins")
    looks = []
    for _, name, inp in calls:
        text = inp.get("command", "") if name == "Bash" else str(inp.get("file_path", "")) if name in ("Read", "Edit") else ""
        if source in text and plugin not in text and "/rehearsal" not in text.split(source, 1)[1][:30]:
            looks.append((name, text[:90].replace("\n", " ")))
    print()
    print(f"== looks at the studio's source ({len(looks)}; the user's session can't do this)")
    for name, text in looks:
        print(f"  {name:5s} {text}")

rubric = load_rubric()
if rubric:
    print()
    print("== rubric")
    rows = []
    for tool in rubric.get("tools_used") or []:
        n = counts.get(f"studio.{tool}", 0)
        rows.append((f"used {tool}", n > 0, f"{n} call(s)"))
    for tool, least in (rubric.get("tools_used_at_least") or {}).items():
        n = counts.get(f"studio.{tool}", 0)
        rows.append((f"{tool} at least {least}x", n >= int(least), f"{n} call(s)"))
    for tool, most in (rubric.get("max_calls") or {}).items():
        n = counts.get(f"studio.{tool}", 0)
        rows.append((f"{tool} at most {most}x", n <= int(most), f"{n} call(s)"))
    for pattern in rubric.get("bash_must_not_match") or []:
        hits = [inp.get("command", "") for _, name, inp in calls if name == "Bash" and re.search(pattern, inp.get("command", ""))]
        rows.append((f"no Bash matching /{pattern}/", not hits, f"{len(hits)} hit(s)"))
    for label, ok, note in rows:
        print(f"  {'yes' if ok else 'NO '}  {label:40s} {note}")
    outcome = rubric.get("outcome") or {}
    if outcome:
        print("  (outcome: check with scripts/rehearsal/verify.sh — "
              + ", ".join(f"{k} = {v}" for k, v in outcome.items()) + ")")

print()
print("== the session's last long message")
print(texts[-1] if texts else "(none)")
