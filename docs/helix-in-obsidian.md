# Helix in Obsidian

Some Helix commands work on Obsidian's own things.

| Helix | In Obsidian |
| --- | --- |
| `Space f`, `Space b`, `Space j` | Quick switcher, open tabs, jumplist |
| `Space s`, `Space S` | Headings in the note, in the vault |
| `Space d`, `Space D`, `]d`, `[d` | Unresolved links |
| `Space a` | Command palette |
| `gd`, `gf`, `Space k` | Follow a link, page preview |
| `gr` | Backlinks |
| `:w`, `:q`, `:o`, `:bn`, `Ctrl-w` | Save, close, open, tabs, splits |

[scope.md](scope.md) lists every command.

## Clipboard

Only the `+` and `*` registers read and write the system clipboard, as in Helix. To make plain `y` and `p` use it, set this in `helix.toml`:

```toml
[editor]
default-yank-register = "+"
```

## Syntax tree

`Alt-o`, `Alt-i`, `Alt-n`, `Alt-p`, `Alt-a`, `Alt-I`, `Alt-e`, `Alt-b`, `mm`, `mim` and auto-pairs use a syntax tree of the note, as in Helix.

Helix Motions parses notes with Helix's markdown grammars. Code inside fences, HTML, YAML front matter and math have no tree of their own.

## Live Preview

In Live Preview, `j` and `k` move one visual row. Selections show the markup inside them. Tables have [their own keys](tables.md).

## Keys that go to Obsidian

A key bound in `helix.toml` wins over Obsidian's hotkeys. A key bound in neither goes to Obsidian.
