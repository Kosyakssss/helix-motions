# Obsidian internals

Obsidian behaviour that is not documented and that this plugin works around. Found by reading `app.js` and probing a running Obsidian. Check again when Obsidian changes.

## Probing

- `obsidian vault=test-vault eval 'code=...'` runs code in the open vault and prints the result after `=> `. Just after start it can fail with "eval not found"; retry.
- `test/e2e/obsidian.ts` wraps this: `evalJs`, `api` (the plugin's test API, for example `api("a.state()")`), real key events, and helpers to set up `scratch.md`.
- Window captures: `screencapture -l<window id> -o -x <file>`. The window id changes when Obsidian restarts.

## Live Preview selection snap

On a selection-only update, Live Preview moves selection ends that fall inside hidden markup (replace decorations from before the update). It does this in a later `setTimeout` dispatch with only `selection`: no `userEvent`, no `scrollIntoView`, no effects. This changes a Helix selection that was correct. `isMarkupSnap` in `src/state.ts` drops such a transaction outside insert mode when every range stays on its lines.

## List hanging indent

After each update, Obsidian sets `text-indent` and `padding-inline-start` on list `.cm-line` elements in a `queueMicrotask`, and does not tell CodeMirror. A layout read that forces a CodeMirror measure before that microtask leaves a stale height map: `moveVertically` can then return the end of the document. Read layout after a dispatch in a microtask queued after it (`restoreVisualRows` in `src/movement.ts`).

## Revealed markup

When the cursor enters a line, Live Preview shows its markup, and the line can wrap differently. Checkboxes, bullets, math and embeds are `contenteditable=false` widgets. `aimAt` in `src/movement.ts` hit-tests the goal column to find what was under it, and `restoreVisualRow` corrects the row after the rewrap.

## Editor suggest

- `app.workspace.editorSuggest.currentSuggest` stays set after the popup closes. Use its `isOpen`.
- Each suggest has `scope.keys`: `{ modifiers, key }`, where `null` means any. Only keys in that list go to the popup (`suggestTakes` in `src/main.ts`). The link suggest also takes `#` and `^`.

## Word count

The core word-count plugin listens to `editor-selection-change` and counts `editor.getSelection()`. Handlers run in registration order, and its debounce uses the last arguments. To count the whole file outside select mode, `countWholeFile` in `src/main.ts` calls `internalPlugins.getEnabledPluginById("word-count").onFileOpen()`.

## Files

The vault API does not see files in the config folder, and the config folder is not always `.obsidian` (`Vault#configDir`). `helix.toml` lives in the vault root.
