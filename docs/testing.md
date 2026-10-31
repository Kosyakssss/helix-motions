# Testing

## Against real Helix

`test/oracle/oracle.rs` is a Helix integration test that runs key sequences in real Helix and returns text, selections and mode. A case with `lang: "markdown"` opens the text as markdown, with only the markdown and markdown.inline languages loaded (the plugin has no other grammars) and tab indentation. `sh test/oracle/setup.sh` clones Helix at `ba40e54742` next to this repo (or into `$HELIX_DIR`), copies the test in and builds the two markdown grammars. Building it needs `cargo` and `cc`.

- `bun test`: runs the hand suite (3,528 cases), 5 fuzz seeds (~15,000 cases), the markdown suite (9,240 cases) and 3 markdown fuzz seeds (~6,000 cases) through the headless engine and compares with Helix. Results from Helix are cached per Helix commit in `test/oracle/cache-<commit>.json` (not committed). Missing cases call Helix.
- `bun test/oracle/diff.ts hand|fuzz|md|mdfuzz [filter]`: same, with a readable failure list.
- Grapheme clusters: `src/graphemes.ts` ports Helix's `unicode-segmentation` 1.13.3 (Unicode 17). `bun scripts/grapheme-table.ts` regenerates `src/core/grapheme-table.ts` from the crate in the cargo registry. `bun test` compares about 78,000 strings with the crate itself.
- `bun test/oracle/one.ts cases.json`: check a few `[markup, keys]` pairs.

## Inside Obsidian

Needs Obsidian running with the `test-vault` vault open. The tests drive Obsidian through its CLI (`obsidian eval`, `obsidian dev:cdp`) with real key events.

- `bun run build` builds into the test vault's plugin folder; `bun run dev` rebuilds and reloads the plugin on change. `bun build.ts` alone builds into `dist/`.
- `bun test/e2e/differential.ts words,code,...`: the Helix cases again, typed as real keys in Obsidian, with the default config.
- `bun test/e2e/scenarios.ts [name]`: Obsidian behaviour (Live Preview, Cmd shortcuts, Russian layout, lists, mouse, prompt, pickers, splits, scrolling, the example config).
- `bun test/e2e/visual.ts`: screenshots to `/tmp/hm-vis-*.png`.

The tests use `scratch.md` and never touch another vault.
