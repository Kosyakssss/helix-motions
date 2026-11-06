# Obsidian commands

Any Obsidian command can be bound in `helix.toml`. Use its id as the command name:

```toml
[keys.normal.space]
o = "switcher:open"

[keys.normal]
A-t = "editor:table-col-after"
```

A name with a colon in the middle is an Obsidian command. A list works too: `t = ["collapse_selection", "editor:toggle-bold"]`. In the command line, `:switcher:open` runs one, and it completes the ids as you type.

Commands of community plugins work the same way. Their ids are `plugin-id:command-id`. To list every command in your vault, type `:` and the start of a plugin's id.

## How this fits with Helix commands

- Helix commands keep their names. `file_picker` opens the quick switcher, so a Helix config works as it is. The plugin translates each one; [scope.md](scope.md) says to what.
- `file_picker` and `switcher:open` then do the same thing. Bind whichever you like, or both.
- A key in `helix.toml` wins over the plugin's defaults, as in Helix.
- A key bound in `helix.toml` wins over Obsidian's Hotkeys setting. A key not bound in either place goes to Obsidian. Hotkeys has no modes and no key sequences, and `helix.toml` has both.
- Real Helix refuses a command name it does not know, and then drops the whole config. Do not use these names in a file that real Helix also reads.

A command that does not apply at that moment says so in the command line. The `editor:table-*` commands need the cursor in a table cell.

The lists below come from Obsidian with all core plugins on: `bun scripts/obsidian-commands.ts`, with `test-vault` open.
