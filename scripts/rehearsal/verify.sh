#!/bin/sh
# Checks a run's result from outside the session, through a studio on
# :<port> over MCP: check_framing, then frames at the given times.
#   verify.sh <port> <run dir> [--view 43] [--live] <ms> [<ms>...]
# The showcase is the one the session made in <run dir>/library.
# --view 43 takes the 4:3 frame instead of TikTok's. --live leaves
# animations where the clock has them, to check a graphic's timing.
port="${1:?port}"; run="${2:?run dir}"; shift 2
view=tiktok; animations=finished
while [ $# -gt 0 ]; do
  case "$1" in
    --view) view="${2:?--view needs tiktok or 43}"; shift 2 ;;
    --live) animations=live; shift ;;
    *) break ;;
  esac
done
cd "$run" || exit 1
showcase="$(ls -d library/*/showcase.yaml 2>/dev/null | head -1 | cut -d/ -f2)"
[ -n "$showcase" ] || { echo "no showcase in $run/library"; exit 1; }
echo "showcase: $showcase"
for i in $(seq 1 60); do curl -s -m 2 "http://localhost:$port/studio/api/info" >/dev/null && break; sleep 1; done
mcpcall() {
  curl -s -m 300 -X POST "http://localhost:$port/mcp" \
    -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d "$1"
}
unwrap='
import json,sys
raw=sys.stdin.read()
if raw.startswith(("event:","data:")): raw=[l[5:] for l in raw.splitlines() if l.startswith("data:")][-1]
r=json.loads(raw)
if "error" in r: print("ERROR", r["error"]); sys.exit(1)
print(json.dumps(r["result"]))
'
echo "--- check_framing ---"
mcpcall "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"check_framing\",\"arguments\":{\"showcaseId\":\"$showcase\"}}}" \
  | python3 -c "$unwrap" | python3 -c "
import json,sys; r=json.load(sys.stdin); a=json.loads(r['content'][0]['text']); print(a.get('summary') or a)
for o in a.get('overlaps', []): print('-', o['sceneId'], o['atMs'], o['message'][:120])"
[ $# -gt 0 ] || exit 0
times="$(printf '%s,' "$@" | sed 's/,$//')"
safe=true; [ "$view" = 43 ] && safe=false
echo "--- frames at $times ($view, animations $animations) ---"
mcpcall "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"screenshot_frame\",\"arguments\":{\"showcaseId\":\"$showcase\",\"atMs\":[$times],\"safeArea\":$safe,\"view\":\"$view\",\"animations\":\"$animations\"}}}" \
  | python3 -c "$unwrap" | python3 -c "
import json,sys,base64; r=json.load(sys.stdin); n=0
for c in r['content']:
    if c['type']=='image':
        n+=1; open(f'verify-frame-$view-{n}.png','wb').write(base64.b64decode(c['data']))
    else: print(c['text'])"
ls verify-frame-$view-*.png
