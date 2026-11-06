#!/bin/sh
# One rehearsal run: a fresh Claude Code session, the showcase-studio
# plugin running the studio under test, on a scratch library holding only
# a scenario's raw inputs, with the scenario's brief as the whole prompt.
#
#   scripts/rehearsal/run.sh <scenario> <run-name> --inputs <folder> \
#       (--source <checkout> | --app <Showcase Studio.app>) [--out <folder>]
#
#   scenario   a folder under rehearsal/scenarios/ (brief.md, inputs.txt,
#              rubric.yaml, settings.yaml)
#   run-name   names the run folder: <out>/<scenario>/<run-name>/
#   --inputs   where the scenario's raw files are (a showcase's assets
#              folder, say); inputs.txt lists the ones to copy
#   --source   run the studio from this checkout (npm i done, whisper
#              vendored), the way SHOWCASE_STUDIO_SRC does
#   --app      run the packaged app, the way a user does
#   --out      where runs go (default: $TMPDIR/showcase-rehearsal). Outside
#              the repository on purpose: inside it, the scratch library
#              would sit in a gitignored folder, so the studio could keep
#              no history of the session's commits, and a session run
#              from source could browse the scenarios and rubrics.
#
# Writes <run>/library (the scratch library, exports inside it),
# <run>/brief.md, <run>/transcript.jsonl (stream-json) and <run>/stderr.log.
# Grade it with scripts/rehearsal/grade.py <run>.
set -e
here="$(cd "$(dirname "$0")/../.." && pwd)"
scenario="${1:?scenario}"; name="${2:?run name}"; shift 2
inputs=""; source=""; app=""; out="${TMPDIR:-/tmp}/showcase-rehearsal"
while [ $# -gt 0 ]; do
  case "$1" in
    --inputs) inputs="$2"; shift 2 ;;
    --source) source="$2"; shift 2 ;;
    --app) app="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    *) echo "run.sh: unknown option $1" >&2; exit 2 ;;
  esac
done
dir="$here/rehearsal/scenarios/$scenario"
[ -d "$dir" ] || { echo "run.sh: no scenario at $dir" >&2; exit 2; }
[ -n "$inputs" ] || { echo "run.sh: --inputs <folder> is required (where the raw files are)" >&2; exit 2; }
[ -n "$source" ] || [ -n "$app" ] || { echo "run.sh: give --source <checkout> or --app <app>" >&2; exit 2; }
plugin="${source:-$here}/plugins/showcase-studio"

run="$out/$scenario/$name"
rm -rf "$run"
mkdir -p "$run/library/raw"
cp "$dir/settings.yaml" "$run/library/showcase_settings.yaml"
while IFS= read -r file; do
  [ -n "$file" ] || continue
  case "$file" in \#*) continue ;; esac
  [ -f "$inputs/$file" ] || { echo "run.sh: input not found: $inputs/$file" >&2; exit 2; }
  cp "$inputs/$file" "$run/library/raw/"
done < "$dir/inputs.txt"
cp "$dir/brief.md" "$run/brief.md"

cd "$run/library"
echo "rehearsal $scenario/$name: library $run/library" >&2
if [ -n "$source" ]; then
  node="${SHOWCASE_STUDIO_NODE:-$(command -v node)}"
  echo "  studio from source: $source (node $node)" >&2
  export SHOWCASE_STUDIO_SRC="$source" SHOWCASE_STUDIO_NODE="$node"
  # The session's own shell commands (ffmpeg probes, scripts) get the same Node.
  PATH="$(dirname "$node"):$PATH"; export PATH
else
  echo "  studio from the app: $app" >&2
  export SHOWCASE_STUDIO_APP="$app"
  unset SHOWCASE_STUDIO_SRC
fi
started=$(date +%s)
claude -p "$(cat "$run/brief.md")" \
  --plugin-dir "$plugin" \
  --output-format stream-json --verbose \
  --dangerously-skip-permissions \
  > "$run/transcript.jsonl" 2> "$run/stderr.log" || echo "  claude exited $?" >&2
echo "rehearsal $scenario/$name: done in $(( $(date +%s) - started )) s" >&2
