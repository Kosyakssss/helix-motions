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

## app

| Command | What it does | Obsidian's default key |
|---|---|---|
| `app:decrease-font-size` | Decrease font size |  |
| `app:delete-file` | Delete current file |  |
| `app:go-back` | Navigate back | `Mod+Alt+ArrowLeft` |
| `app:go-forward` | Navigate forward | `Mod+Alt+ArrowRight` |
| `app:increase-font-size` | Increase font size |  |
| `app:migrate-frontmatter` | Format converter: Frontmatter migration |  |
| `app:open-another-vault` | Open vault... |  |
| `app:open-file` | Open file from outside the vault... |  |
| `app:open-help` | Open help | `F1` |
| `app:open-sandbox-vault` | Open sandbox vault |  |
| `app:open-settings` | Open settings | `Mod+,` |
| `app:open-vault` | Manage vaults |  |
| `app:reload` | Reload app without saving |  |
| `app:show-debug-info` | Show debug info |  |
| `app:show-release-notes` | Show release notes |  |
| `app:switch-vault` | Change vault... |  |
| `app:toggle-default-new-pane-mode` | Toggle default mode for new tabs |  |
| `app:toggle-left-sidebar` | Toggle left sidebar |  |
| `app:toggle-ribbon` | Toggle ribbon |  |
| `app:toggle-right-sidebar` | Toggle right sidebar |  |

## audio-recorder

| Command | What it does | Obsidian's default key |
|---|---|---|
| `audio-recorder:start` | Audio recorder: Start recording audio |  |
| `audio-recorder:stop` | Audio recorder: Stop recording audio |  |

## backlink

| Command | What it does | Obsidian's default key |
|---|---|---|
| `backlink:open` | Backlinks: Show backlinks |  |
| `backlink:open-backlinks` | Backlinks: Open backlinks for the current note |  |
| `backlink:toggle-backlinks-in-document` | Backlinks: Toggle backlinks in document |  |

## bases

| Command | What it does | Obsidian's default key |
|---|---|---|
| `bases:add-item` | Bases: Add item |  |
| `bases:add-view` | Bases: Add view |  |
| `bases:change-view` | Bases: Switch view... |  |
| `bases:copy-table` | Bases: Copy table to clipboard |  |
| `bases:insert` | Bases: Insert new base |  |
| `bases:new-file` | Bases: Create new base |  |

## bookmarks

| Command | What it does | Obsidian's default key |
|---|---|---|
| `bookmarks:bookmark-all-tabs` | Bookmarks: Bookmark all tabs... |  |
| `bookmarks:bookmark-current-heading` | Bookmarks: Bookmark heading under cursor... |  |
| `bookmarks:bookmark-current-search` | Bookmarks: Bookmark current search... |  |
| `bookmarks:bookmark-current-section` | Bookmarks: Bookmark block under cursor... |  |
| `bookmarks:bookmark-current-view` | Bookmarks: Bookmark... |  |
| `bookmarks:open` | Bookmarks: Show bookmarks |  |
| `bookmarks:unbookmark-current-view` | Bookmarks: Remove bookmark for the current file |  |

## canvas

| Command | What it does | Obsidian's default key |
|---|---|---|
| `canvas:convert-to-file` | Canvas: Convert to file... |  |
| `canvas:export-as-image` | Canvas: Export as image |  |
| `canvas:jump-to-group` | Canvas: Jump to group |  |
| `canvas:new-file` | Canvas: Create new canvas |  |

## command-palette

| Command | What it does | Obsidian's default key |
|---|---|---|
| `command-palette:open` | Command palette: Open command palette | `Mod+P` |

## daily-note

| Command | What it does | Obsidian's default key |
|---|---|---|
| `daily-notes` | Daily notes: Open today's daily note |  |

## daily-notes

| Command | What it does | Obsidian's default key |
|---|---|---|
| `daily-notes:goto-next` | Daily notes: Open next daily note |  |
| `daily-notes:goto-prev` | Daily notes: Open previous daily note |  |

## editor

| Command | What it does | Obsidian's default key |
|---|---|---|
| `editor:add-cursor-above` | Add cursor above |  |
| `editor:add-cursor-below` | Add cursor below |  |
| `editor:attach-file` | Insert attachment |  |
| `editor:clear-formatting` | Clear formatting |  |
| `editor:context-menu` | Show context menu under cursor |  |
| `editor:cycle-list-checklist` | Cycle bullet/checkbox |  |
| `editor:delete-paragraph` | Delete paragraph | `Mod+D` |
| `editor:download-attachments` | Download attachments for current file |  |
| `editor:focus` | Focus on last note |  |
| `editor:focus-bottom` | Focus on tab group below |  |
| `editor:focus-left` | Focus on tab group to the left |  |
| `editor:focus-right` | Focus on tab group to the right |  |
| `editor:focus-top` | Focus on tab group above |  |
| `editor:fold-all` | Fold all headings and lists |  |
| `editor:fold-less` | Fold less |  |
| `editor:fold-more` | Fold more |  |
| `editor:follow-link` | Follow link under cursor | `Alt+Enter` |
| `editor:indent-list` | Indent list item |  |
| `editor:insert-callout` | Insert callout |  |
| `editor:insert-codeblock` | Insert code block |  |
| `editor:insert-embed` | Add embed |  |
| `editor:insert-footnote` | Insert footnote |  |
| `editor:insert-horizontal-rule` | Insert horizontal rule |  |
| `editor:insert-link` | Insert Markdown link | `Mod+K` |
| `editor:insert-mathblock` | Insert math block |  |
| `editor:insert-table` | Insert table |  |
| `editor:insert-tag` | Add tag |  |
| `editor:insert-wikilink` | Add internal link |  |
| `editor:open-link-in-new-leaf` | Open link under cursor in new tab | `Mod+Enter` |
| `editor:open-link-in-new-split` | Open link under cursor to the right | `Mod+Alt+Enter` |
| `editor:open-link-in-new-window` | Open link under cursor in new window | `Mod+Alt+Shift+Enter` |
| `editor:open-search` | Search current file | `Mod+F` |
| `editor:open-search-replace` | Search & replace in current file | `Mod+Alt+F` |
| `editor:rename-heading` | Rename this heading... |  |
| `editor:save-file` | Save current file | `Mod+S` |
| `editor:set-heading` | Toggle heading |  |
| `editor:set-heading-0` | Remove heading |  |
| `editor:set-heading-1` | Set as heading 1 |  |
| `editor:set-heading-2` | Set as heading 2 |  |
| `editor:set-heading-3` | Set as heading 3 |  |
| `editor:set-heading-4` | Set as heading 4 |  |
| `editor:set-heading-5` | Set as heading 5 |  |
| `editor:set-heading-6` | Set as heading 6 |  |
| `editor:swap-line-down` | Move line down |  |
| `editor:swap-line-up` | Move line up |  |
| `editor:table-col-after` | Table: Add column to the right |  |
| `editor:table-col-align-center` | Table: Align center |  |
| `editor:table-col-align-left` | Table: Align left |  |
| `editor:table-col-align-right` | Table: Align right |  |
| `editor:table-col-before` | Table: Add column to the left |  |
| `editor:table-col-copy` | Table: Duplicate column |  |
| `editor:table-col-delete` | Table: Delete column |  |
| `editor:table-col-left` | Table: Move column left |  |
| `editor:table-col-right` | Table: Move column right |  |
| `editor:table-row-after` | Table: Add row below |  |
| `editor:table-row-before` | Table: Add row above |  |
| `editor:table-row-copy` | Table: Duplicate row |  |
| `editor:table-row-delete` | Table: Delete row |  |
| `editor:table-row-down` | Table: Move row down |  |
| `editor:table-row-up` | Table: Move row up |  |
| `editor:toggle-blockquote` | Toggle blockquote |  |
| `editor:toggle-bold` | Toggle bold | `Mod+B` |
| `editor:toggle-bullet-list` | Toggle bullet list |  |
| `editor:toggle-checklist-status` | Toggle checkbox status | `Mod+l` |
| `editor:toggle-code` | Toggle code |  |
| `editor:toggle-comments` | Toggle comment | `Mod+/` |
| `editor:toggle-fold` | Toggle fold on the current line |  |
| `editor:toggle-fold-properties` | Toggle fold properties in current file |  |
| `editor:toggle-highlight` | Toggle highlight |  |
| `editor:toggle-highlight-blue` | Toggle blue highlight |  |
| `editor:toggle-highlight-green` | Toggle green highlight |  |
| `editor:toggle-highlight-orange` | Toggle orange highlight |  |
| `editor:toggle-highlight-purple` | Toggle purple highlight |  |
| `editor:toggle-highlight-red` | Toggle red highlight |  |
| `editor:toggle-highlight-yellow` | Toggle yellow highlight |  |
| `editor:toggle-inline-math` | Toggle inline math |  |
| `editor:toggle-italics` | Toggle italic | `Mod+I` |
| `editor:toggle-line-numbers` | Toggle line numbers |  |
| `editor:toggle-numbered-list` | Toggle numbered list |  |
| `editor:toggle-readable-line-length` | Toggle readable line length |  |
| `editor:toggle-source` | Toggle Live Preview/Source mode |  |
| `editor:toggle-spellcheck` | Toggle spellcheck |  |
| `editor:toggle-strikethrough` | Toggle strikethrough |  |
| `editor:unfold-all` | Unfold all headings and lists |  |
| `editor:unindent-list` | Unindent list item |  |

## file-explorer

| Command | What it does | Obsidian's default key |
|---|---|---|
| `file-explorer:duplicate-file` | Duplicate current file |  |
| `file-explorer:move-file` | Move current file to another folder |  |
| `file-explorer:new-file` | Create new note | `Mod+N` |
| `file-explorer:new-file-in-current-tab` | Create new note in current tab |  |
| `file-explorer:new-file-in-new-pane` | Create note to the right | `Mod+Shift+N` |
| `file-explorer:new-folder` | Files: Create new folder |  |
| `file-explorer:open` | Files: Show file explorer |  |
| `file-explorer:reveal-active-file` | Files: Reveal current file in navigation |  |

## file-recovery

| Command | What it does | Obsidian's default key |
|---|---|---|
| `file-recovery:open` | File recovery: Open local history |  |

## footnotes

| Command | What it does | Obsidian's default key |
|---|---|---|
| `footnotes:open` | Footnotes view: Show footnotes |  |

## global-search

| Command | What it does | Obsidian's default key |
|---|---|---|
| `global-search:open` | Search: Search in all files | `Mod+Shift+F` |

## graph

| Command | What it does | Obsidian's default key |
|---|---|---|
| `graph:animate` | Graph view: Start graph timelapse animation |  |
| `graph:open` | Graph view: Open graph view | `Mod+G` |
| `graph:open-local` | Graph view: Open local graph |  |

## insert-current-dat

| Command | What it does | Obsidian's default key |
|---|---|---|
| `insert-current-date` | Templates: Insert current date |  |

## insert-current-tim

| Command | What it does | Obsidian's default key |
|---|---|---|
| `insert-current-time` | Templates: Insert current time |  |

## insert-templat

| Command | What it does | Obsidian's default key |
|---|---|---|
| `insert-template` | Templates: Insert template |  |

## insert-unique-lin

| Command | What it does | Obsidian's default key |
|---|---|---|
| `insert-unique-link` | Unique note creator: Add unique internal link |  |

## markdown

| Command | What it does | Obsidian's default key |
|---|---|---|
| `markdown:add-alias` | Add alias |  |
| `markdown:add-metadata-property` | Add file property | `Mod+;` |
| `markdown:clear-metadata-properties` | Clear file properties |  |
| `markdown:toggle-preview` | Toggle reading view | `Mod+E` |

## mobile

| Command | What it does | Obsidian's default key |
|---|---|---|
| `mobile:quick-action` | Configure mobile Quick Action |  |

## note-composer

| Command | What it does | Obsidian's default key |
|---|---|---|
| `note-composer:extract-heading` | Note composer: Extract this heading... |  |
| `note-composer:merge-file` | Note composer: Merge current file with another file... |  |
| `note-composer:split-file` | Note composer: Extract current selection... |  |

## open-with-default-app

| Command | What it does | Obsidian's default key |
|---|---|---|
| `open-with-default-app:open` | Open in default app |  |
| `open-with-default-app:show` | Reveal in Finder |  |

## outgoing-links

| Command | What it does | Obsidian's default key |
|---|---|---|
| `outgoing-links:open` | Outgoing links: Show outgoing links |  |
| `outgoing-links:open-for-current` | Outgoing links: Open outgoing links for the current file |  |

## outline

| Command | What it does | Obsidian's default key |
|---|---|---|
| `outline:open` | Outline: Show outline |  |
| `outline:open-for-current` | Outline: Open outline of the current file |  |

## properties

| Command | What it does | Obsidian's default key |
|---|---|---|
| `properties:open` | Properties view: Show all properties |  |
| `properties:open-local` | Properties view: Show file properties |  |

## publish

| Command | What it does | Obsidian's default key |
|---|---|---|
| `publish:open-in-live-site` | Publish: Open in live site |  |
| `publish:publish-file` | Publish: Publish current file |  |
| `publish:view-changes` | Publish: Publish changes... |  |

## random-not

| Command | What it does | Obsidian's default key |
|---|---|---|
| `random-note` | Random note: Open random note |  |

## slides

| Command | What it does | Obsidian's default key |
|---|---|---|
| `slides:start` | Slides: Start presentation |  |

## switcher

| Command | What it does | Obsidian's default key |
|---|---|---|
| `switcher:open` | Quick switcher: Open quick switcher | `Mod+O` |

## sync

| Command | What it does | Obsidian's default key |
|---|---|---|
| `sync:open-sync-log` | Sync: Open activity log |  |
| `sync:open-sync-view` | Sync: Show Sync history |  |
| `sync:setup` | Sync: Set up Sync |  |
| `sync:view-version-history` | Sync: Open version history for the current file |  |

## tag-pane

| Command | What it does | Obsidian's default key |
|---|---|---|
| `tag-pane:open` | Tags view: Show tags |  |

## theme

| Command | What it does | Obsidian's default key |
|---|---|---|
| `theme:switch` | Change theme... |  |
| `theme:toggle-light-dark` | Toggle light/dark mode |  |

## webviewer

| Command | What it does | Obsidian's default key |
|---|---|---|
| `webviewer:focus-address-bar` | Web viewer: Focus address bar |  |
| `webviewer:open` | Web viewer: Open web viewer |  |
| `webviewer:open-history` | Web viewer: Show history |  |
| `webviewer:save-to-vault` | Web viewer: Save to vault |  |
| `webviewer:search` | Web viewer: Search the web |  |
| `webviewer:toggle-reader-mode` | Web viewer: Toggle reader mode |  |
| `webviewer:zoom-in` | Web viewer: Zoom in |  |
| `webviewer:zoom-out` | Web viewer: Zoom out |  |
| `webviewer:zoom-reset` | Web viewer: Reset zoom |  |

## window

| Command | What it does | Obsidian's default key |
|---|---|---|
| `window:reset-zoom` | Reset zoom |  |
| `window:toggle-always-on-top` | Toggle window always on top |  |
| `window:zoom-in` | Zoom in |  |
| `window:zoom-out` | Zoom out |  |

## workspace

| Command | What it does | Obsidian's default key |
|---|---|---|
| `workspace:close` | Close current tab | `Mod+W` |
| `workspace:close-others` | Close all other tabs |  |
| `workspace:close-others-tab-group` | Close others in tab group |  |
| `workspace:close-tab-group` | Close this tab group |  |
| `workspace:close-window` | Close window | `Mod+Shift+W` |
| `workspace:copy-full-path` | Copy current file path from system root |  |
| `workspace:copy-path` | Copy current file path from vault folder |  |
| `workspace:copy-url` | Copy Obsidian URL for current file |  |
| `workspace:edit-file-title` | Rename file | `F2` |
| `workspace:export-pdf` | Export to PDF... |  |
| `workspace:goto-last-tab` | Go to last tab | `Mod+9` |
| `workspace:goto-tab-1` | Go to tab #1 | `Mod+1` |
| `workspace:goto-tab-2` | Go to tab #2 | `Mod+2` |
| `workspace:goto-tab-3` | Go to tab #3 | `Mod+3` |
| `workspace:goto-tab-4` | Go to tab #4 | `Mod+4` |
| `workspace:goto-tab-5` | Go to tab #5 | `Mod+5` |
| `workspace:goto-tab-6` | Go to tab #6 | `Mod+6` |
| `workspace:goto-tab-7` | Go to tab #7 | `Mod+7` |
| `workspace:goto-tab-8` | Go to tab #8 | `Mod+8` |
| `workspace:move-to-new-window` | Move current tab to new window |  |
| `workspace:new-tab` | New tab | `Mod+T` |
| `workspace:new-window` | New window |  |
| `workspace:next-tab` | Go to next tab | `Ctrl+Tab, Meta+Shift+]` |
| `workspace:open-in-new-window` | Open current tab in new window |  |
| `workspace:previous-tab` | Go to previous tab | `Ctrl+Shift+Tab, Meta+Shift+[` |
| `workspace:show-trash` | Show trash |  |
| `workspace:split-horizontal` | Split down |  |
| `workspace:split-vertical` | Split right |  |
| `workspace:toggle-pin` | Toggle pin |  |
| `workspace:toggle-stacked-tabs` | Toggle stacked tabs |  |
| `workspace:undo-close-pane` | Undo close tab | `Mod+Shift+T` |

## workspaces

| Command | What it does | Obsidian's default key |
|---|---|---|
| `workspaces:load` | Workspaces: Load workspace layout |  |
| `workspaces:open-modal` | Workspaces: Manage workspace layouts |  |
| `workspaces:save` | Workspaces: Save layout |  |
| `workspaces:save-and-load` | Workspaces: Save and load another layout |  |

## zk-prefixe

| Command | What it does | Obsidian's default key |
|---|---|---|
| `zk-prefixer` | Unique note creator: Create new unique note |  |
