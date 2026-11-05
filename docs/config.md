# Configure Helix Motions

Helix Motions reads `helix.toml` in the root of your vault. It uses the format of Helix's `config.toml`, so you can copy yours in.

## Edit your config

Open **Settings → Helix Motions**. The editor there has Helix keys, and warnings show below it.

To save, use `:w`, or press `Ctrl+S` (Windows and Linux) or `Command+S` (macOS).

Two commands help:

- `:config-open` opens this page.
- `:config-reload` reads the file again.

## Set keys

`[keys.normal]`, `[keys.select]` and `[keys.insert]` work as they do in Helix:

```toml
[keys.normal]
"C-s" = ":write"
D = "@xd"
Q = ["save_selection", "keep_primary_selection"]

[keys.normal.space]
o = "switcher:open"
```

| Value | Runs |
| --- | --- |
| `"file_picker"` | A Helix command. |
| `":write"` | A typed command. |
| `"@xd"` | A macro: these keys, in order. |
| `["save_selection", "keep_primary_selection"]` | Several, in order. |
| `"switcher:open"` | An [Obsidian command](obsidian-commands.md), by its id. |

Real Helix refuses names it does not know, and then drops the whole config. If real Helix also reads this file, do not use Obsidian ids in it.

## Set options

These `[editor]` options work:

- `scrolloff`, `scroll-lines`
- `cursor-shape`, `cursorline`, `color-modes`
- `auto-pairs`, `auto-info`, `smart-tab`
- `search`, `jump-label-alphabet`
- `default-yank-register`, `mouse-yank-register`
- `statusline`
- `text-width`
- `trim-trailing-whitespace`, `trim-final-newlines`, `insert-final-newline`

These switch Obsidian's own settings when you set them:

| Option | Obsidian setting |
| --- | --- |
| `line-number`, `gutters` | **Show line number** |
| `indent-guides.render` | **Show indentation guides** |

Relative line numbers are not drawn. `line-number = "relative"` gives a warning and absolute numbers.

Options that Helix Motions cannot use give a warning, so a full Helix config still loads. [scope.md](scope.md#config-helixtoml-in-the-vault-root) lists all of them.

## Change plugin settings

**Settings → Helix Motions** also holds the choices Helix cannot make:

| Setting | Default | Description |
| --- | --- | --- |
| **Auto-pairs** | Obsidian | Use Obsidian's auto-pair options, or Helix's and the `[editor.auto-pairs]` table. |
| **Enter, tab and backspace in insert mode** | Obsidian | Use Obsidian's list continuation, list indent and table cells, or Helix's `insert_newline`, `smart_tab` and `delete_char_backward`. |
| **Read keys by position** | On | With a non-Latin keyboard layout, normal and select mode read each key by its position on a US keyboard. Keys that wait for a character, such as `f`, `t` and `r`, still get the typed character. |
