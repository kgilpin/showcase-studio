#!/bin/sh
# Checks that `node` in this folder is Volta's shim and that the Node
# pinned in package.json ("volta") is already downloaded. Another Node
# first on the PATH (nvm, Homebrew, an old /usr/local copy) would hide it.
set -eu

node_path=$(command -v node || true)
case "$node_path" in
  */.volta/bin/node) ;;
  *)
    echo "node on the PATH is '${node_path:-none}', not Volta's shim (~/.volta/bin/node)"
    exit 1
    ;;
esac

if ! volta list node --format plain | grep -q '(current @'; then
  echo "The Node version pinned in package.json is not downloaded yet"
  exit 1
fi
