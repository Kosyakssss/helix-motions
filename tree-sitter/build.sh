#!/bin/sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
ts_rev=v0.26.9
md_rev=f969cd3ae3f9fbd4e43205431d0ae286014c05b5
sdk_version=29
if [ -z "${WASI_SDK_PATH:-}" ]; then
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) platform=arm64-macos ;;
    Darwin-x86_64) platform=x86_64-macos ;;
    Linux-aarch64) platform=arm64-linux ;;
    Linux-x86_64) platform=x86_64-linux ;;
    *) echo "unsupported platform" >&2; exit 1 ;;
  esac
  WASI_SDK_PATH="${XDG_CACHE_HOME:-$HOME/.cache}/helix-motions/wasi-sdk-$sdk_version.0-$platform"
  if [ ! -x "$WASI_SDK_PATH/bin/clang" ]; then
    mkdir -p "$(dirname "$WASI_SDK_PATH")"
    curl -fsSL "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-$sdk_version/wasi-sdk-$sdk_version.0-$platform.tar.gz" | tar -xz -C "$(dirname "$WASI_SDK_PATH")"
  fi
fi
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git -c advice.detachedHead=false clone -q --depth 1 --branch "$ts_rev" https://github.com/tree-sitter/tree-sitter "$tmp/ts"
git init -q "$tmp/md"
git -C "$tmp/md" fetch -q --depth 1 https://github.com/tree-sitter-grammars/tree-sitter-markdown "$md_rev"
git -C "$tmp/md" checkout -q FETCH_HEAD
cp "$here/binding.c" "$tmp/binding.c"
cd "$tmp"
cc="$WASI_SDK_PATH/bin/clang --target=wasm32-wasip1 -O2 -DNDEBUG -ffile-prefix-map=$tmp=."
$cc -c -I ts/lib/include -I ts/lib/src ts/lib/src/lib.c -o lib.o
$cc -c -I ts/lib/include binding.c -o binding.o
for name in markdown markdown-inline; do
  $cc -c -I "md/tree-sitter-$name/src" "md/tree-sitter-$name/src/parser.c" -o "$name-parser.o"
  $cc -c -I "md/tree-sitter-$name/src" "md/tree-sitter-$name/src/scanner.c" -o "$name-scanner.o"
done
$cc -mexec-model=reactor -Wl,--strip-all lib.o binding.o markdown-parser.o markdown-scanner.o markdown-inline-parser.o markdown-inline-scanner.o -o tree-sitter.wasm
cp tree-sitter.wasm "$here/tree-sitter.wasm"
