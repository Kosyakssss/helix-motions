# AGENTS.md

A faithful port of Helix to Obsidian. The Helix engine is [helix-cm6](https://github.com/Kosyakssss/helix-cm6), a plain CodeMirror 6 package; this repo has the Obsidian parts. Read `CONTRIBUTING.md` (setup, tests), `docs/scope.md` (every command and option, and the decisions) and `docs/testing.md` first. `docs/obsidian-internals.md` lists Obsidian behaviour that is not documented and that this code works around.

## Philosophy

- Helix is the spec. Behaviour follows the pinned Helix commit in `CONTRIBUTING.md`, and the oracle decides. If Helix does not have an editing command, object or option, we do not have it.
- Obsidian's own commands are the exception. `helix.toml` can bind any of them by its id, so people can use Helix's layout and add Obsidian's features to it. `docs/obsidian-commands.md` lists them.
- If Helix and Obsidian need different behaviour, port the Helix behaviour as an option and make Obsidian's behaviour the default. Auto-pairs and insert keys are examples.
- Native first. Use Obsidian's own UI where it exists: pickers, line numbers, cursorline, indent guides. Draw only what Obsidian cannot. If a `helix.toml` option has an Obsidian setting, switch that setting instead of drawing.
- Helix options live only in `helix.toml`, so people can use their Helix config without changes. The settings tab holds only choices Helix cannot make.
- Colours come from Obsidian theme variables. Fonts follow the text font. It must look right in the default theme and in other themes, with a full-width status bar, and in light and dark mode.
- Nothing moves the layout. Messages, pending keys and labels must not shift text or other status items.
- Think of a 20,000-line note. Measure with `test/perf.ts`.
- Live Preview is secondary, but it must be consistent. Vertical motions move exactly one visual row and land on what was under the column.
- Desktop only.

## Architecture

- The engine, the view layer, the wasm modules and the comparison with real Helix live in helix-cm6. Its `AGENTS.md` has its rules. An engine change goes there first, with a case in its `test/oracle/suites.ts`. Then this repo pins the new helix-cm6 commit in `package.json`.
- Import only from `helix-cm6` (and `helix-cm6/test/*` in tests), never from its `src/`. If something is missing, export it from helix-cm6's `src/index.ts`.
- helix-cm6 has no Obsidian code. Obsidian behaviour goes behind a hook that this repo supplies: `ViewEnv`, `Workspace`, the `dropSelectionChange` facet.
- The only runtime dependencies are helix-cm6 and `smol-toml`. Ask before you add one.
- Tree-sitter and regex are helix-cm6's own wasm builds. Do not use Obsidian's parser.

## How to work

- If the request is to diagnose, find the root cause and report it. Do not fix until asked.
- For UX choices, give the options with their differences in function and in use, and let the maintainer choose. Discuss before you make large changes.
- Test edge cases hard. An engine change gets a case in helix-cm6's `test/oracle/suites.ts`. An Obsidian behaviour change gets a scenario in `test/e2e/scenarios.ts`. Before a release, check that helix-cm6's CI passed on the pinned commit, and run `bun test/e2e/scenarios.ts` and `bun test/e2e/differential.ts`.
- Check behaviour in real Obsidian with `test-vault` open, on `scratch.md`. Never use a personal vault.
- For visual changes, capture only the Obsidian window, in light and dark mode.
- If Helix itself has a bug, find or file a short upstream issue, and write down what the port does.

## Obsidian review rules

The community review must stay clean:

- `bun run lint` (`eslint-plugin-obsidianmd`) passes. It checks this repo and helix-cm6's `src`, because both ship in `main.js`. Only `prefer-create-el` is off for helix-cm6: `createEl` exists only in Obsidian, and helix-cm6 makes nodes with the editor's own `ownerDocument`.
- No `:has` in CSS. Use `window.setTimeout` and `window.clearTimeout`. Use `Vault#configDir`, not `.obsidian`. No console logging. No Electron `require`; use `navigator.clipboard`.
- The release `main.js` must rebuild byte for byte from the source. Releases have artifact attestations. Bun stays pinned in the workflows.

## Releases

Only the maintainer pushes, tags and releases.

1. Pin helix-cm6 to a commit whose CI passed. Bump `manifest.json` and add the version to `versions.json`. Commit with the version as the message, for example `0.1.7`.
2. `git push origin main`. `origin` pushes to GitHub and Tangled.
3. Write the release notes in a file: a short bullet list of user-visible changes since the previous version, then `**Full Changelog**: https://github.com/Kosyakssss/helix-motions/compare/<previous>...x.y.z`.
4. When CI passes, make an annotated tag with the notes as its message: `git tag -a x.y.z --cleanup=verbatim -F <file>` (no `v` prefix), then `git push origin x.y.z`. Git keeps the notes, so GitHub and Tangled both show them. The Release workflow fails on a tag without notes, and uses the tag message as the GitHub release notes.
5. When the Release workflow passes, check that the release has `main.js`, `manifest.json`, `styles.css` and the notes.

## Style

- No code comments. The Style Settings block in `styles.css` is the only exception.
- A commit message is one sentence that says what changed for the user. See `git log`.
- README, docs and the plugin description: write like the Obsidian docs and kepano's projects (pele, knap, obsidian-maps). Start with one plain sentence that says what the thing does. Keep the README short and link to focused pages in `docs/`. Use imperative, sentence-case headings, common words, American English and realistic examples. Write Obsidian's UI in bold, with `→` between steps. Do not sell Helix; readers know it. Show that this is a full, faithful port. No "it is not X, it is Y" contrasts and no defensive claims.

## Repository

- Treat everything committed as public. No personal data, machine-local state or home paths.
- `test-vault` holds only committed files. Its `helix.toml` is a real-world config. `.gitignore` keeps out workspace state and the built plugin.
- Screenshots in `docs/screenshots`: 1200×800, default theme, empty `helix.toml` except `color-modes = true`, no line numbers, no sidebars or ribbon, window buttons visible. Each in dark, light, and both split along the diagonal (dark top left).
