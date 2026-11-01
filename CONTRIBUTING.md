# Contributing

## Rule

This is a port. Behaviour follows Helix at commit `ba40e54742`. If Helix does not have a command or an option, this plugin does not have it either. Where Obsidian needs a different answer (pickers, links, files), `docs/scope.md` says what and why.

The Helix engine, its wasm modules and the comparison with real Helix live in [helix-cm6](https://github.com/Kosyakssss/helix-cm6). This repo has the Obsidian parts. Engine changes go to helix-cm6 first.

## Setup

```sh
bun install
bun run build        # into test-vault/.obsidian/plugins/helix-motions
bun run dev          # rebuild on change and reload the plugin
bun run check        # TypeScript
bun run lint         # Obsidian's review rules
```

Open `test-vault` in Obsidian to try changes. Its `helix.toml` is a real-world config.

## Tests

- With Obsidian running and `test-vault` open, `bun test/e2e/scenarios.ts` drives Obsidian with real key events, and `bun test/e2e/differential.ts` types the Helix cases as real keys and compares Obsidian with the headless engine. They only use `scratch.md`.
- The engine is checked against real Helix in helix-cm6.

See `docs/testing.md` for details.

## Pull requests

Send engine changes to helix-cm6, with a case in its `test/oracle/suites.ts`. Add a scenario to `test/e2e/scenarios.ts` for Obsidian behaviour. Keep `bun run check`, `bun run lint` and the e2e tests passing.

To work on both repos, point the dependency at a local copy for a while: `bun add helix-cm6@file:../helix-cm6`. Do not commit that; commit the helix-cm6 commit it needs.
