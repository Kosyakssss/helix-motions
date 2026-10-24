# Contributing

## Rule

This is a port. Behaviour follows Helix at commit `ba40e54742` with PR #16370 applied (Helix commit `cee7102d98`). If Helix does not have a command or an option, this plugin does not have it either. Where Obsidian needs a different answer (pickers, links, files), `docs/scope.md` says what and why.

## Setup

```sh
bun install
bun run build        # into test-vault/.obsidian/plugins/helix-motions
bun run dev          # rebuild on change and reload the plugin
bun run check        # TypeScript
bun run lint         # Obsidian's review rules
sh tree-sitter/build.sh  # rebuild tree-sitter.wasm (downloads wasi-sdk once)
sh regex/build.sh        # rebuild regex.wasm (needs rustup; installs Rust 1.99.1 with the wasm target)
```

Open `test-vault` in Obsidian to try changes. Its `helix.toml` is a real-world config.

## Tests

- `sh test/oracle/setup.sh` puts Helix next to this repo with the oracle test and the markdown grammars. Then `bun test` compares the headless engine with real Helix: plain text, and markdown with its syntax tree.
- `bun test/oracle/diff.ts hand|fuzz|md|mdfuzz [filter]` lists failures in a readable form.
- With Obsidian running and `test-vault` open, `bun test/e2e/scenarios.ts` drives Obsidian with real key events. It only uses `scratch.md`.

See `docs/testing.md` for details.

## Pull requests

Add a case to `test/oracle/suites.ts` for engine changes, or a scenario to `test/e2e/scenarios.ts` for Obsidian behaviour. Keep `bun run check`, `bun run lint` and `bun test` passing.
