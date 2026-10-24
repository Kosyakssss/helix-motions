#!/bin/sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
cd "$here"
registry="${CARGO_HOME:-$HOME/.cargo}/registry/src"
RUSTFLAGS="--remap-path-prefix=$registry=crates --remap-path-prefix=$here=." \
  rustup run 1.99.1 cargo build --locked --release --target wasm32-unknown-unknown --target-dir "${TMPDIR:-/tmp}/helix-motions-regex"
cp "${TMPDIR:-/tmp}/helix-motions-regex/wasm32-unknown-unknown/release/helix_motions_regex.wasm" "$here/regex.wasm"
