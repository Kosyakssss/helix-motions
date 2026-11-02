# Roadmap

The engine plan is in helix-cm6's `docs/roadmap.md`. This file has the Obsidian part. It lands on `on-helix-cm6`. Each item gets a scenario in `test/e2e/scenarios.ts`. Obsidian's own behaviour is the spec in Obsidian, as Helix is in the editor: check how plain Obsidian does a thing before porting it.

## Known bugs

- `{` and `}` bound in `helix.toml` do nothing.
- Multiple cursors do not show in the `helix.toml` editor.
- Globe+Ctrl+arrow window tiling and other macOS shortcuts do nothing while the editor is in normal or select mode.
- Vertical motions skip `![[…]]` embeds in Live Preview.

## Frontmatter and properties (Live Preview)

- Motions skip the hidden frontmatter. In source mode they do not.
- `gg` goes to the first visible line.
- `k` on the first text line focuses the properties: the Add property button, else the last property, else the Properties heading if the list is folded.
- The inline title is skipped. `k` on the Properties heading does nothing.

## Tables (Live Preview)

Source mode stays plain Helix.

- `h` and `l` at a cell edge move to the next cell, but not past the first or last cell of a row. `j` and `k` move to the cell above or below, in the same column, clamped. In a wrapped cell they move by visual rows first.
- `gh`, `gl` and word motions stay in the cell.
- `j` from above enters the header cell under the cursor. `k` from below enters the last row. At the start or end of the note, leaving adds a blank line, as Obsidian does.
- Counts: move inside the cell first, then across cells, then out of the table.
- `Esc` in normal mode in a cell does nothing.
- Insert mode in a cell is Obsidian's.
- Selections follow Obsidian. When all text of a cell is selected, the cell is selected; extending further selects cells. `x` selects the whole row, also in an empty cell, and a second `x` adds the next row. hjkl and counts extend a cell selection. A selection that starts outside the table selects whole cells in it and continues as text after it.
- On selected cells: `d` clears them; `c` clears them and inserts in the first; `y` copies them as table text; `p` pastes table text over them and other text into the anchor cell; `r`, `~` and `` ` `` act per cell; `i` and `a` insert at the start of the first or the end of the last cell; `;` and `Esc` return to one cell; `gg` and `ge` extend to the first or last row, `gh` and `gl` to the first or last column. `%` stays the whole note.
- `o` and `O` add a row.
- Undo is one history for the note, not one per cell editor.
- Document-wide commands in a cell (`/`, `n`, `*`, `gg`, `G`, `%`, `C-o`, `]`) act on the note and reopen a cell when needed. Macros and `.` follow focus across cells.
- `J` does nothing in a cell. A multi-line paste into a cell joins the lines with `<br>`.
- Rare tables: ragged rows clamp to the last cell; malformed tables follow Obsidian's grid; tables in callouts, quotes and lists use text motions, as Obsidian opens no cell editor there; `k` from the header of a table right under the frontmatter goes to the properties; wide tables scroll the cell into view; an escaped `\|` shows as raw text; with several selections in one table, the primary opens its cell and the others stay text selections.
