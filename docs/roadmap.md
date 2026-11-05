# Roadmap

The engine plan is in helix-cm6's `docs/roadmap.md`. This file has the Obsidian part. It lands on `on-helix-cm6`. Each item gets a scenario in `test/e2e/scenarios.ts`. Obsidian's own behaviour is the spec in Obsidian, as Helix is in the editor: check how plain Obsidian does a thing before porting it.

## Known bugs

All fixed: `{` and `}`, multiple cursors in the `helix.toml` editor, Globe+Ctrl+arrow tiling, vertical motions that skipped `![[…]]` embeds, the cursor that drew in the wrong place when a list line revealed its markup, and `x` `y` `P` on a last line with no newline.

## Frontmatter and properties (Live Preview)

Done, in `src/obsidian/hooks.ts`.

- Motions skip the hidden frontmatter. In source mode they do not.
- `gg` goes to the first visible line.
- `k` on the first text line focuses the properties: the Add property button, else the last property, else the Properties heading if the list is folded.
- The inline title is skipped. `k` on the Properties heading does nothing.

## Tables (Live Preview)

Done, in `src/obsidian/hooks.ts`, on the table widget's own API. Source mode stays plain Helix.

- The levels and keys are in `docs/tables.md`.
- `j` from above enters the header cell under the cursor. `k` from below enters the last row. At the start or end of the note, leaving adds a blank line, as Obsidian does.
- Counts: move inside the cell first, then across cells, then out of the table.
- `Esc` in normal mode in a cell does nothing.
- Insert mode in a cell is Obsidian's.
- `o` and `O` add a row. Columns are Obsidian's `editor:table-*` commands, which `helix.toml` can bind.
- Messages, prompts and key help show in the note's panel, not in the cell.
- Undo is one history for the note, not one per cell editor.
- Document-wide commands in a cell (`/`, `n`, `*`, `gg`, `G`, `%`, `C-o`, `]`) act on the note and reopen a cell when needed. Macros and `.` follow focus across cells.
- `J` does nothing in a cell. A multi-line paste into a cell joins the lines with `<br>`.
- Rare tables: ragged rows clamp to the last cell; malformed tables follow Obsidian's grid; tables in callouts, quotes and lists use text motions, as Obsidian opens no cell editor there; `k` from the header of a table right under the frontmatter goes to the properties; wide tables scroll the cell into view; an escaped `\|` shows as raw text; with several selections in one table, the primary opens its cell and the others stay text selections.
