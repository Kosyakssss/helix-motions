# Testing

## Against real Helix

The engine is [helix-cm6](https://github.com/Kosyakssss/helix-cm6). Its tests run about 34,000 key sequences in real Helix and in the headless engine and compare the results, and run the hand suite as real key events in a plain CodeMirror 6 editor. See its `docs/testing.md`.

## Inside Obsidian

Needs Obsidian running with the `test-vault` vault open. The tests drive Obsidian through its CLI (`obsidian eval`, `obsidian dev:cdp`) with real key events.

- `bun run build` builds into the test vault's plugin folder; `bun run dev` rebuilds and reloads the plugin on change. `bun build.ts` alone builds into `dist/`.
- `bun test/e2e/differential.ts words,code,...`: the Helix hand cases again, typed as real keys in Obsidian with the default config, and compared with the headless engine from helix-cm6. helix-cm6 checks the headless engine against Helix.
- `bun test/e2e/scenarios.ts [name]`: Obsidian behaviour (Live Preview, Cmd shortcuts, Russian layout, lists, mouse, prompt, pickers, splits, scrolling, the example config).
- `bun test/e2e/visual.ts`: screenshots to `/tmp/hm-vis-*.png`.

The tests use `scratch.md` and never touch another vault.
