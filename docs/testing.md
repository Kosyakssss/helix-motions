# Testing

## Against real Helix

`~/code/helix` holds Helix at `ba40e54742` with a local test, `helix-term/tests/oracle.rs` (not upstream). It runs key sequences in real Helix and returns text, selections and mode.

- `bun test`: runs the hand suite (3,528 cases) and 5 fuzz seeds (~15,000 cases) through the headless engine and compares with Helix. Results from Helix are cached in `test/oracle/cache.json` (not committed). Missing cases call Helix, so `cargo` must work in `~/code/helix`.
- `bun test/oracle/diff.ts hand|fuzz [filter]`: same, with a readable failure list.
- `bun test/oracle/one.ts cases.json`: check a few `[markup, keys]` pairs.

## Inside Obsidian

Needs Obsidian running with the `test-vault` vault open. The tests drive Obsidian through its CLI (`obsidian eval`, `obsidian dev:cdp`) with real key events.

- `bun build.ts` builds into `test-vault/.obsidian/plugins/helix-motions/`; `bun build.ts --watch` rebuilds and reloads the plugin.
- `bun test/e2e/differential.ts words,code,...`: the Helix cases again, typed as real keys in Obsidian, with the default config.
- `bun test/e2e/scenarios.ts [name]`: Obsidian behaviour (Live Preview, Cmd shortcuts, Russian layout, lists, mouse, prompt, pickers, splits, scrolling, Kote's config).
- `bun test/e2e/visual.ts`: screenshots to `/tmp/hm-vis-*.png`.

The tests use `scratch.md` and never touch another vault.
