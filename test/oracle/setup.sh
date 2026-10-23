#!/bin/sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
dir=${HELIX_DIR:-$(cd "$here/../../.." && pwd)/helix}
rev=ba40e547426b0f9896c8bdc699a4ab11f2b37dbc
if [ ! -d "$dir/.git" ]; then
  git clone --filter=blob:none https://github.com/helix-editor/helix "$dir"
fi
git -C "$dir" checkout --quiet "$rev"
cp "$here/oracle.rs" "$dir/helix-term/tests/oracle.rs"
echo "Helix oracle ready in $dir"
