#!/usr/bin/env python3
"""Follows a rehearsal transcript and prints one short line per studio
tool call (and every error), then the final result line, and exits."""
import json
import sys
import time

path = sys.argv[1]
PLUGIN = "mcp__plugin_showcase-studio_showcase-studio__"
pending = {}
with open(path) as f:
    while True:
        line = f.readline()
        if not line:
            time.sleep(1)
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        t = ev.get("type")
        if t == "assistant":
            for b in ev.get("message", {}).get("content", []):
                if b.get("type") != "tool_use":
                    continue
                name = b["name"].replace(PLUGIN, "studio.")
                pending[b["id"]] = name
                if name.startswith("studio."):
                    inp = b.get("input", {})
                    gist = {k: v for k, v in inp.items() if k not in ("edits",)}
                    if "edits" in inp:
                        gist["edits"] = len(inp["edits"])
                    print(f"{name} {json.dumps(gist)[:140]}", flush=True)
        elif t == "user":
            for b in ev.get("message", {}).get("content", []):
                if b.get("type") == "tool_result" and b.get("is_error"):
                    c = b.get("content")
                    text = c if isinstance(c, str) else " ".join(x.get("text", "") for x in c if isinstance(x, dict))
                    print(f"ERROR in {pending.get(b['tool_use_id'], '?')}: {text[:160]}", flush=True)
        elif t == "result":
            print(f"RESULT turns={ev.get('num_turns')} ms={ev.get('duration_ms')} cost={ev.get('total_cost_usd')}", flush=True)
            break
