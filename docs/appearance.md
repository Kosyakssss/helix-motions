# Appearance

The look follows your Obsidian theme, in light and dark mode. Fonts follow your text font.

## Set options in Helix's config

`helix.toml` controls these:

```toml
[editor]
color-modes = true
cursorline = true

[editor.cursor-shape]
normal = "block"
insert = "bar"
select = "underline"

[editor.statusline]
left = ["mode", "file-base-name", "file-modification-indicator"]
```

## Use Style Settings

With the [Style Settings](https://github.com/mgmeyers/obsidian-style-settings) plugin, you can also set:

- The cursor's corner radius.
- A full-width status bar.
- How the Helix block and the mode look in the status bar.
- The side and the font of the key help box.
