#!/bin/sh
# Checks that the cmake first on the PATH is built for this Mac's
# architecture. `npm run vendor:whisper` builds whisper.cpp with it, and
# refuses an Intel cmake (Homebrew's /usr/local copy) on Apple silicon.
set -eu

cmake_path=$(command -v cmake || true)
if [ -z "$cmake_path" ]; then
  echo "cmake is not installed"
  exit 1
fi

arch=$(uname -m)
kind=$(file -b "$(realpath "$cmake_path")")
case "$kind" in
  *"$arch"*) ;;
  *)
    echo "This Mac is $arch, but $cmake_path is: $kind"
    exit 1
    ;;
esac
