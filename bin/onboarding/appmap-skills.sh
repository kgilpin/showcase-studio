#!/bin/sh
# Installs the AppMap skills for this user, as the README's "The AppMap
# skills" section says: a clone in ~/.appmap/skills, linked into
# ~/.claude/skills. Gold-trace review and releases need them.
# Usage: sh bin/onboarding/appmap-skills.sh check|fix
set -eu

skills="appmap-gold-traces appmap-record appmap-review appmap-config"
clone="$HOME/.appmap/skills"
links="$HOME/.claude/skills"

case "${1:-}" in
  check)
    missing=""
    for skill in $skills; do
      [ -e "$links/$skill" ] || missing="$missing $skill"
    done
    if [ -n "$missing" ]; then
      echo "Missing in $links:$missing"
      exit 1
    fi
    ;;
  fix)
    [ -d "$clone" ] || git clone https://github.com/getappmap/skills.git "$clone"
    mkdir -p "$links"
    for skill in $skills; do
      [ -e "$links/$skill" ] || ln -s "$clone/$skill" "$links/$skill"
    done
    ;;
  *)
    echo "usage: sh bin/onboarding/appmap-skills.sh check|fix"
    exit 2
    ;;
esac
