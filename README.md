# Helix Motions

The editing model of the [Helix](https://helix-editor.com) editor in Obsidian: select first, then act. Multiple selections, Helix's keymap, registers, macros, undo tree and typed commands, ported from Helix and tested against it.

## Install

1. Turn off **Settings → Editor → Vim key bindings**. Turn off other Vim plugins.
2. Install Helix Motions from **Settings → Community plugins**, and turn it on.

Manual install: download `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/helix-motions/`.

Needs Obsidian 1.13 or later, on desktop.

## Config

The plugin reads `helix.toml` in the root of the vault. It uses the format of Helix's `config.toml`, so you can copy your Helix config into it. Edit it in **Settings → Helix Motions**: the editor there has Helix keys, `:w` or Mod+S saves it, and warnings show under it. `:config-open` opens that page, and `:config-reload` reads the file again.

What works:

- `[keys.normal]`, `[keys.select]`, `[keys.insert]`: every Helix command, typed commands (`":write"`), sequences and macros (`"@miw"`).
- `[editor]`: `scrolloff`, `scroll-lines`, `cursor-shape`, `cursorline`, `auto-pairs`, `auto-info`, `search`, `smart-tab`, `statusline`, `color-modes`, `jump-label-alphabet`, `default-yank-register`, `text-width`, the `trim-*` keys, and more.
- `line-number`, `gutters` and `indent-guides.render` switch Obsidian's own settings. Relative line numbers are not drawn.

Not available: shell commands (`:sh`, `|`, `!`), LSP, debugging, and commands that need a syntax tree (`Alt-o`, `Alt-i`, `]f` and similar). They show a message instead.

## Helix in Obsidian

Some Helix commands work on Obsidian's own things:

| Helix | Here |
| --- | --- |
| `Space f`, `Space b`, `Space j` | Quick switcher, open tabs, jumplist |
| `Space s`, `Space S` | Headings in the note, in the vault |
| `Space d`, `Space D`, `]d`, `[d` | Unresolved links |
| `Space a` | Command palette |
| `gd`, `gf`, `Space k` | Follow a link, page preview |
| `gr` | Backlinks |
| `:w`, `:q`, `:o`, `:bn`, `Ctrl-w` | Save, close, open, tabs, splits |

Settings that Helix can't decide live in the settings tab: auto-pairs from Helix or from Obsidian, Enter, Tab and Backspace in insert mode from Helix or from Obsidian, and reading keys by position for non-Latin keyboard layouts.

## Capabilities

- **Clipboard:** the `+` register reads and writes the system clipboard. To keep Helix's commands synchronous, the plugin reads the clipboard when Obsidian gets focus and after a copy or cut.
- **Files:** reads and writes `helix.toml` in the vault. `:w`, `:o`, `:move` and similar commands work on notes, as in Helix.
- **Obsidian settings:** changes "Show line number" and "Show indentation guides" only when `helix.toml` sets `line-number`, `gutters` or `indent-guides`.
- **Network:** none.

## Credits

Ported from [Helix](https://github.com/helix-editor/helix) at commit `ba40e54742`, under the Mozilla Public License 2.0. The way to end IME composition in normal mode comes from [codemirror-vim](https://github.com/replit/codemirror-vim).

## License

[MPL-2.0](LICENSE)
