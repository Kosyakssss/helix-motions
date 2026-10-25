# Scope

Source: `helix-editor/helix` master `ba40e54742` (behaviour: plus PR #16370, auto-pair spaces only inside `()` and `{}`), files `book/src/generated/static-cmd.md`, `book/src/generated/typable-cmd.md`, `book/src/editor.md`, `helix-term/src/keymap/default.rs`.

Marks:

- **port**: same behaviour. Port the logic from Helix.
- **adapt**: same intent. Use an Obsidian or CM6 mechanism.
- **later**: adapt, but after the core works. Needs a design talk first.
- **skip**: not in this plugin.

Every `extend_*` command is the select-mode twin of a `move_*` or `goto_*` command. It gets the same mark and reason as its twin.

## Static commands

### Movement

| Command | Mark | Reason |
| --- | --- | --- |
| `no_op` | port | Needed to unbind keys in config. |
| `move_char_left`, `move_char_right`, `extend_char_left`, `extend_char_right` | port | Grapheme step with `findClusterBreak`. |
| `move_line_up`, `move_line_down`, `extend_line_up`, `extend_line_down` | port | Logical lines, Helix column rules. |
| `move_visual_line_up`, `move_visual_line_down`, `extend_visual_line_up`, `extend_visual_line_down` | adapt | Only CM6 knows the rendered lines (soft wrap, Live Preview widgets). Use `view.moveVertically`. |
| `copy_selection_on_next_line`, `copy_selection_on_prev_line` | port | Pure selection logic. |
| `move_next_word_start`, `move_prev_word_start`, `move_next_word_end`, `move_prev_word_end`, `move_next_long_word_start`, `move_prev_long_word_start`, `move_next_long_word_end`, `move_prev_long_word_end`, `move_next_sub_word_start`, `move_prev_sub_word_start`, `move_next_sub_word_end`, `move_prev_sub_word_end` and their `extend_*` twins | port | `movement.rs`, `chars.rs`. Core of the Helix feel. |
| `move_parent_node_end`, `move_parent_node_start`, `extend_parent_node_end`, `extend_parent_node_start` | port | `movement.rs` on the markdown syntax tree. See "Syntax tree" below. |
| `find_till_char`, `find_next_char`, `till_prev_char`, `find_prev_char`, `extend_till_char`, `extend_next_char`, `extend_till_prev_char`, `extend_prev_char` | port | Pure text search. Keep the real typed char (layout rule). |
| `repeat_last_motion` | port | Stores the last motion closure. |
| `page_up`, `page_down`, `half_page_up`, `half_page_down`, `page_cursor_up`, `page_cursor_down`, `page_cursor_half_up`, `page_cursor_half_down` | adapt | Scroll the CM6 scroller. Rows come from CM6 layout, not cells. |
| `goto_file_start`, `goto_file_end`, `goto_line`, `goto_last_line` and `extend_*` twins | port | Line math. |
| `goto_line_start`, `goto_line_end`, `goto_line_end_newline`, `goto_first_nonwhitespace`, `goto_column` and `extend_*` twins | port | Line math. |
| `goto_window_top`, `goto_window_center`, `goto_window_bottom` | adapt | Use the CM6 viewport and `scrolloff`. |
| `goto_last_modification` | port | Track the last change position per document. |
| `goto_word`, `extend_to_word` | port | Two-char labels replace the first two characters of each word while you pick, as in Helix, in the note's own font. `jump-label-alphabet` applies. |
| `goto_next_paragraph`, `goto_prev_paragraph` | port | `textobject.rs` paragraph logic. The example config binds `{` `}` to these. |

### Selection

| Command | Mark | Reason |
| --- | --- | --- |
| `select_all` | port | Trivial. |
| `select_regex`, `split_selection`, `keep_selections`, `remove_selections` | port | Logic ports. The regex prompt is our own UI (see "Prompt"). Patterns run on Helix's own regex engine (`regex-cursor` 0.1.5, `regex-automata` 0.4.14), compiled to WebAssembly. |
| `split_selection_on_newline`, `merge_selections`, `merge_consecutive_selections` | port | `selection.rs`. |
| `extend_line`, `extend_line_below`, `extend_line_above`, `select_line_above`, `select_line_below` | port | Line logic. |
| `extend_to_line_bounds`, `shrink_to_line_bounds`, `trim_selections` | port | Line logic. |
| `collapse_selection`, `flip_selections`, `ensure_selections_forward` | port | Range logic. |
| `keep_primary_selection`, `remove_primary_selection` | port | Range logic. |
| `rotate_selections_forward`, `rotate_selections_backward`, `rotate_selections_first`, `rotate_selections_last` | port | Changes the primary index. |
| `rotate_selection_contents_forward`, `rotate_selection_contents_backward`, `reverse_selection_contents` | port | Text swap between ranges. |
| `align_selections` | port | Pads with spaces. |
| `save_selection` | port | Jumplist. |
| `expand_selection`, `shrink_selection`, `select_next_sibling`, `select_prev_sibling`, `select_all_siblings`, `select_all_children` | port | `object.rs` on the markdown syntax tree. See "Syntax tree". |
| `match_brackets` | port | `match_brackets.rs`, with the syntax tree as in Helix. |
| `select_textobject_around`, `select_textobject_inner` | port | See "Text objects". |
| `surround_add`, `surround_replace`, `surround_delete` | port | `surround.rs`. Keep the real typed char. |

### Search

| Command | Mark | Reason |
| --- | --- | --- |
| `search`, `rsearch` | adapt | Logic ports. Prompt is ours. Highlights all matches like Helix does while typing. |
| `search_next`, `search_prev`, `extend_search_next`, `extend_search_prev` | port | `search.rs`, `wrap-around` option. |
| `search_selection`, `search_selection_detect_word_boundaries`, `make_search_word_bounded` | port | Writes register `/`. |
| `global_search` | adapt | Open Obsidian's search pane with the query. It already searches the whole vault. |

### Changes

| Command | Mark | Reason |
| --- | --- | --- |
| `replace` | port | Keep the real typed char. |
| `switch_case`, `switch_to_uppercase`, `switch_to_lowercase` | port | `case_conversion.rs`. |
| `delete_selection`, `delete_selection_noyank`, `change_selection`, `change_selection_noyank` | port | Core. |
| `insert_mode`, `append_mode`, `insert_at_line_start`, `insert_at_line_end` | port | Core. |
| `open_below`, `open_above` | adapt | Copy indent and continue list markers (`- `, `1.`, `- [ ]`, `> `), like Obsidian's Enter. |
| `add_newline_above`, `add_newline_below` | port | Trivial. |
| `join_selections`, `join_selections_space` | port | Pure text. |
| `indent`, `unindent` | port | Indent unit comes from Obsidian's tab settings. |
| `format_selections` | skip | No formatter in Obsidian. |
| `toggle_comments`, `toggle_line_comments`, `toggle_block_comments` | adapt | `comment.rs` logic. Markdown has only the block token `%% %%` (Obsidian comments). In code blocks use the fence language's tokens. |
| `increment`, `decrement` | port | `increment/`: numbers and dates. |
| `undo`, `redo` | port | `history.rs` revision tree; one insert session is one revision, as in Helix. |
| `earlier`, `later` | port | `history.rs` revision tree, steps and time spans. |
| `commit_undo_checkpoint` | port | Commits the pending revision. |

### Modes

| Command | Mark | Reason |
| --- | --- | --- |
| `normal_mode`, `select_mode`, `exit_select_mode` | port | Core. |
| `command_mode` | adapt | Our own `:` prompt with completion. |
| `record_macro`, `replay_macro` | port | Key replay through our keymap engine. Also powers `@keys` in config (the example config uses `w = "@miw"`). |
| `select_register` | port | Keep the real typed char. |
| `copy_between_registers` | port | Registers. |

### Insert mode

| Command | Mark | Reason |
| --- | --- | --- |
| `insert_newline` | port | Option. Default leaves Enter to Obsidian (continues lists and quotes). |
| `smart_tab` | port | Option. Default leaves Tab to Obsidian (list indent, table cells). |
| `insert_tab` | port | Trivial. |
| `delete_char_backward` | port | Option. Default leaves Backspace to Obsidian (list markers). |
| `delete_char_forward`, `delete_word_backward`, `delete_word_forward`, `kill_to_line_start`, `kill_to_line_end` | port | Pure text. |
| `insert_char_interactive`, `append_char_interactive` | port | Trivial. |
| `insert_register` | port | Registers. |
| `completion` | skip | No LSP. Obsidian has its own `[[` suggest. |
| `signature_help` | skip | LSP. |
| `goto_next_tabstop`, `goto_prev_tabstop` | skip | Snippets are out of scope. |

### Yank and paste

| Command | Mark | Reason |
| --- | --- | --- |
| `yank`, `yank_joined`, `replace_with_yanked`, `paste_after`, `paste_before` | port | Registers. |
| `yank_to_clipboard`, `yank_joined_to_clipboard`, `yank_main_selection_to_clipboard`, `replace_selections_with_clipboard`, `paste_clipboard_after`, `paste_clipboard_before` | adapt | Register `+` through `navigator.clipboard`. Reads are async, so the plugin keeps a copy, refreshed when Obsidian gets focus and after copy or cut. |
| `yank_to_primary_clipboard`, `yank_joined_to_primary_clipboard`, `yank_main_selection_to_primary_clipboard`, `replace_selections_with_primary_clipboard`, `paste_primary_clipboard_after`, `paste_primary_clipboard_before` | adapt | macOS has no primary selection. Copy what Helix's `pasteboard` provider does for `*`. |

### View

| Command | Mark | Reason |
| --- | --- | --- |
| `align_view_top`, `align_view_center`, `align_view_bottom` | adapt | `EditorView.scrollIntoView` with `y: start/center/end`. |
| `align_view_middle` | skip | Horizontal scroll. Obsidian always wraps lines. |
| `scroll_up`, `scroll_down` | adapt | Scroll by `scroll-lines` rows. |

### Files, buffers, pickers

"Buffer" maps to an open markdown tab. "Current directory" maps to the vault root.

| Command | Mark | Reason |
| --- | --- | --- |
| `file_picker`, `file_picker_in_current_directory` | adapt | Obsidian quick switcher. The vault root is the only working directory, so both are the same. |
| `file_picker_in_current_buffer_directory` | adapt | Our own `SuggestModal` over files in the note's folder. The quick switcher cannot filter by folder. |
| `file_explorer`, `file_explorer_in_current_directory` | adapt | Focus Obsidian's file explorer. |
| `file_explorer_in_current_buffer_directory` | adapt | `file-explorer:reveal-active-file`. |
| `buffer_picker` | adapt | Our own modal over open tabs. |
| `jumplist_picker` | adapt | Our own modal over the jumplist. |
| `last_picker` | adapt | Reopens the last of our modals. |
| `lsp_or_syntax_symbol_picker`, `symbol_picker`, `syntax_symbol_picker` | adapt | Headings of this note from `metadataCache`. |
| `lsp_or_syntax_workspace_symbol_picker`, `workspace_symbol_picker`, `syntax_workspace_symbol_picker` | adapt | Headings of all notes from `metadataCache`. |
| `changed_file_picker` | skip | VCS. |
| `diagnostics_picker`, `workspace_diagnostics_picker` | adapt | Unresolved links in the note, and in the vault. `]d` `[d` `[D` `]D` jump between them in the note. |
| `code_action` | adapt | Opens Obsidian's command palette. |
| `select_references_to_symbol_under_cursor` | skip | LSP. |
| `command_palette` | adapt | Obsidian command palette. The plugin registers its commands there. |
| `goto_file` | adapt | Open the `[[link]]`, markdown link, URL or vault path in the selection. |
| `goto_file_hsplit`, `goto_file_vsplit` | adapt | Same, in a new split. |
| `goto_definition` | adapt | Follow the link under the cursor (`editor:follow-link`). |
| `goto_reference` | adapt | Picker of backlinks to the note under the cursor, else to this note. |
| `hover` | adapt | Obsidian page preview for the link under the cursor. |
| `rename_symbol` | adapt | Rename the note under the cursor (or this note) with `fileManager.renameFile`, which updates links. |
| `goto_declaration`, `goto_type_definition`, `goto_implementation` | skip | LSP, no markdown meaning. |
| `goto_last_accessed_file` | adapt | Track the previous file per pane. |
| `goto_last_modified_file` | adapt | Track the last edited file. |
| `goto_next_buffer`, `goto_previous_buffer` | adapt | Next/previous tab in the pane. |

### Jumplist and windows

| Command | Mark | Reason |
| --- | --- | --- |
| `jump_forward`, `jump_backward` | port | Jumplist across files and panes. |
| `jump_view_left`, `jump_view_right`, `jump_view_up`, `jump_view_down` | adapt | Focus the neighbour leaf by screen position. |
| `swap_view_left`, `swap_view_right`, `swap_view_up`, `swap_view_down` | adapt | No API to move leaves. Swap the files of the two leaves. |
| `transpose_view` | skip | No public API to change split direction. |
| `rotate_view`, `rotate_view_reverse` | adapt | Cycle focus through markdown leaves. |
| `hsplit`, `vsplit`, `hsplit_new`, `vsplit_new` | adapt | `workspace.getLeaf("split", dir)`. "New" opens a new note. |
| `wclose`, `wonly` | adapt | Detach leaves. |

### Syntax-tree and tree-sitter navigation

| Command | Mark | Reason |
| --- | --- | --- |
| `goto_next_paragraph`, `goto_prev_paragraph` | port | Listed above. Plain text. |
| `goto_next_function`, `goto_prev_function`, `goto_next_class`, `goto_prev_class`, `goto_next_parameter`, `goto_prev_parameter`, `goto_next_comment`, `goto_prev_comment`, `goto_next_test`, `goto_prev_test`, `goto_next_xml_element`, `goto_prev_xml_element`, `goto_next_entry`, `goto_prev_entry` | port | Helix has no textobject queries for markdown, so these only push a jump and set the direction, as in Helix. |

### Diagnostics, VCS, debug, shell

| Command | Mark | Reason |
| --- | --- | --- |
| `goto_first_diag`, `goto_last_diag`, `goto_next_diag`, `goto_prev_diag` | skip | LSP. |
| `goto_next_change`, `goto_prev_change`, `goto_first_change`, `goto_last_change` | skip | VCS diff. |
| `dap_launch`, `dap_restart`, `dap_toggle_breakpoint`, `dap_continue`, `dap_pause`, `dap_step_in`, `dap_step_out`, `dap_next`, `dap_variables`, `dap_terminate`, `dap_edit_condition`, `dap_edit_log`, `dap_switch_thread`, `dap_switch_stack_frame`, `dap_enable_exceptions`, `dap_disable_exceptions` | skip | DAP. |
| `shell_pipe`, `shell_pipe_to`, `shell_insert_output`, `shell_append_output`, `shell_keep_pipe` | skip | Plan says no shell. Note: desktop Obsidian has Node `child_process`, so this is possible later. |
| `suspend` | skip | No terminal. |

## Non-command behaviour

| Item | Mark | Reason |
| --- | --- | --- |
| Count prefix (`3w`, `5G`) | port | Hardcoded in `ui/editor.rs`. |
| `.` repeat last insert | port | Hardcoded in `ui/editor.rs`, replays insert keys. |
| Registers `"`, `/`, `:`, `@`, `_`, `#`, `.`, `%`, `+`, `*`, named | port | `register.rs`. `%` gives the vault path of the note. |
| Mouse: click, drag, Alt-click adds a cursor | adapt | CM6 already sets selections. Map them to Helix ranges. Alt-click maps to CM6's own add-cursor click. |
| Multiple cursors drawing | adapt | Cursors are cells one row tall, drawn in a layer above the text, like a terminal cell; a corner is round only where no selection touches it. The primary selection is the native one; other selections are full-row rectangles under the text, plus a CSS highlight where the text has an opaque background (code). |
| Sticky `Z` mode, `auto-info` popup | adapt | Small which-key panel in the editor. |
| Status line | adapt | One Obsidian status bar item. See config. |

## Text objects (`mi`, `ma`)

| Key | Mark | Reason |
| --- | --- | --- |
| `w`, `W` | port | `textobject.rs`. |
| `p` | port | `textobject.rs`. |
| `(`, `[`, `{`, `<`, `'`, `"`, `` ` ``, other chars | port | `surround.rs`. |
| `m` | port | Closest pair, with the syntax tree as in Helix. |
| `f`, `t`, `a`, `c`, `T`, `x` | port | Helix has no textobject queries for markdown: the selection does not change, as in Helix. |
| `g` | skip | VCS. |

## Typed commands

| Command | Mark | Reason |
| --- | --- | --- |
| `:write`, `:w`, `:write!`, `:w!` | adapt | Save now. With a path: write a copy to that vault path. |
| `:update`, `:u` | adapt | Save if dirty. |
| `:write-all`, `:wa`, `:write-all!`, `:wa!` | adapt | Save all open notes. |
| `:quit`, `:q`, `:quit!`, `:q!` | adapt | Close the tab. Obsidian autosaves, so `!` changes nothing. |
| `:write-quit`, `:wq`, `:write-quit!`, `:wq!`, `:exit`, `:x`, `:xit`, `:exit!`, `:x!`, `:xit!` | adapt | Save, then close the tab. |
| `:quit-all`, `:qa`, `:quit-all!`, `:qa!`, `:write-quit-all`, `:wqa`, `:xa`, `:write-quit-all!`, `:wqa!`, `:xa!` | adapt | Close all markdown tabs. Do not quit Obsidian. |
| `:cquit`, `:cq`, `:cquit!`, `:cq!` | skip | No exit code to give. |
| `:open`, `:o`, `:edit`, `:e` | adapt | Open or create a vault note. Completion over vault paths. |
| `:new`, `:n` | adapt | New untitled note. |
| `:buffer-close`, `:bc`, `:bclose` and `!` forms | adapt | Close the tab. |
| `:buffer-close-others`, `:bco`, `:bcloseother` and `!` forms | adapt | Close other tabs. |
| `:buffer-close-all`, `:bca`, `:bcloseall` and `!` forms | adapt | Close all tabs. |
| `:buffer-next`, `:bn`, `:bnext`, `:buffer-previous`, `:bp`, `:bprev` | adapt | Next/previous tab. The example config binds Tab and S-Tab to these. |
| `:write-buffer-close`, `:wbc` and `!` forms | adapt | Save and close. |
| `:vsplit`, `:vs`, `:hsplit`, `:hs`, `:sp` | adapt | Split, optional path. |
| `:vsplit-new`, `:vnew`, `:hsplit-new`, `:hnew` | adapt | Split with a new note. |
| `:reload`, `:rl`, `:reload-all`, `:rla` | adapt | Re-read from disk. The example config binds `C-r` to `:reload`. |
| `:move`, `:mv` and `!` forms | adapt | `fileManager.renameFile`, updates links. |
| `:read`, `:r` | adapt | Insert a vault file's text. |
| `:goto`, `:g` | port | Line number. |
| `:earlier`, `:ear`, `:later`, `:lat` | port | Steps and time spans on the `history.rs` revision tree. |
| `:yank-join` | port | Registers. |
| `:clipboard-yank`, `:clipboard-yank-join`, `:clipboard-paste-after`, `:clipboard-paste-before`, `:clipboard-paste-replace` | adapt | System clipboard, as for `+`. |
| `:primary-clipboard-yank`, `:primary-clipboard-yank-join`, `:primary-clipboard-paste-after`, `:primary-clipboard-paste-before`, `:primary-clipboard-paste-replace` | adapt | Same as `*` register above. |
| `:show-clipboard-provider` | skip | Only one provider. |
| `:clear-register`, `:set-register` | port | Registers. |
| `:character-info`, `:char` | port | Pure text. |
| `:sort` | port | Pure text. |
| `:reflow` | port | Uses `text-width`. |
| `:indent-style` | adapt | Per-editor CM6 `indentUnit`. |
| `:set-option`, `:set`, `:toggle-option`, `:toggle`, `:get-option`, `:get` | adapt | Only the options this plugin supports. |
| `:config-reload` | adapt | Re-read `helix.toml`. |
| `:config-open` | adapt | Obsidian cannot open files in `.obsidian/` as notes. Open in the system default app. |
| `:config-open-workspace` | skip | The vault config is the only config. |
| `:echo`, `:noop` | port | Trivial. |
| `:redraw` | adapt | `view.requestMeasure()`. Rarely needed. |
| `:tutor` | later | Could open an adapted tutor note. |
| `:theme` | skip | Obsidian themes are separate. |
| `:format`, `:fmt` | skip | No formatter. |
| `:line-ending` | skip | Obsidian stores LF. |
| `:encoding` | skip | UTF-8 only. |
| `:set-language`, `:lang` | skip | Notes are markdown. Code blocks take their language from the fence. |
| `:change-current-directory`, `:cd`, `:show-directory-stack`, `:push-directory`, `:pushd`, `:pop-directory`, `:popd`, `:show-directory`, `:pwd` | skip | The vault root is fixed. |
| `:lsp-workspace-command`, `:lsp-restart`, `:lsp-stop`, `:yank-diagnostic` | skip | LSP. |
| `:tree-sitter-scopes`, `:tree-sitter-highlight-name`, `:tree-sitter-layers`, `:tree-sitter-subtree`, `:ts-subtree` | skip | Debug views for grammar authors. No highlight queries. |
| `:debug-start`, `:dbg`, `:debug-remote`, `:dbg-tcp`, `:debug-eval` | skip | DAP. |
| `:insert-output`, `:append-output`, `:pipe`, `:\|`, `:pipe-to`, `:run-shell-command`, `:sh`, `:!` | skip | No shell (plan). |
| `:reset-diff-change`, `:diffget`, `:diffg` | skip | VCS. |
| `:log-open` | skip | No log file. Use the dev console. |
| `:workspace-trust`, `:workspace-untrust`, `:workspace-exclude` | skip | No LSP to trust. |

## Config (`helix.toml` in the vault root)

Read with the same structure and defaults as Helix. Unknown or skipped keys log one warning and are ignored, so a full Helix config loads without errors.

| Key | Mark | Reason |
| --- | --- | --- |
| `[keys.normal]`, `[keys.select]`, `[keys.insert]` | port | Full syntax: command names, `":typed args"`, arrays, `@keys` macros, nested tables. |
| Insert-mode key chords (`j` then `k` to exit) | port | First key waits. On any other key, insert both. |
| `scrolloff` | adapt | CM6 scroll margins. |
| `scroll-lines` | adapt | `zj`/`zk` step only. Mouse wheel stays native. |
| `default-yank-register`, `mouse-yank-register` | port | The example config sets both to `+`. |
| `jump-label-alphabet` | port | `gw`. |
| `text-width` | port | `:reflow`. |
| `search.smart-case`, `search.wrap-around` | port | Search. |
| `cursor-shape.normal/insert/select` | adapt | Block, bar, underline or hidden cell, one row tall. |
| `color-modes` | adapt | Mode colour in the status item. |
| `statusline.*` | adapt | One block at the left end of Obsidian's status bar: `left`, then `center`, then `right`, with Helix's text for each element. Elements with Obsidian data: `mode`, `file-name`, `file-base-name`, `file-absolute-path`, `file-modification-indicator` (unsaved changes), `file-line-ending` (LF), `file-indent-style` (Obsidian's indent setting), `file-type` (markdown), `diagnostics` and `workspace-diagnostics` (unresolved links as warnings, filtered by `statusline.diagnostics` and `statusline.workspace-diagnostics`), `selections`, `primary-selection-length`, `position`, `position-percentage`, `total-line-numbers`, `register`, `current-working-directory` (vault name), `separator`, `spacer`, and the `mode.*` texts. Empty, as in Helix without them: `spinner` (LSP), `version-control`, `read-only-indicator`, `file-encoding` (UTF-8), `code-action-hint`. Each element's text is trimmed and elements are one cell apart; non-empty groups are split by a line. Mode colors come from the theme's `--color-blue`, `--color-orange` and `--color-pink`, with the text color of higher contrast. Pending keys and the macro register show in a strip to the left of the block. Messages show in the editor's bottom row, as in Helix's command line row. |
| `auto-info` | adapt | Which-key panel. |
| `auto-pairs` | port | `auto_pairs.rs`, full. Plugin option picks Helix's (default) or Obsidian's. With Helix's on, Obsidian's auto-pair settings are bypassed. |
| `smart-tab.*` | port | Applies when the Helix insert-keys option is on. |
| `line-number`, `gutters` | adapt | Switch Obsidian's own "Show line number" setting, only when `helix.toml` sets one of these keys. `relative` gives a warning and absolute numbers. We draw no numbers. |
| `cursorline` | adapt | Highlights every line with a cursor, viewport only. Obsidian's own active line follows CodeMirror's caret, which sits on the next line after `x`, so it can't be used. |
| `whitespace.*` | skip | Not drawn. Obsidian draws its own indentation guides. Gives a warning. |
| `trim-trailing-whitespace`, `trim-final-newlines`, `insert-final-newline` | adapt | Apply on `:write` only. Obsidian's autosave does not go through us. |
| `auto-save.*` | skip | Obsidian always autosaves. |
| `soft-wrap.*` | skip | Obsidian's own "Readable line length" and wrap rules. |
| `indent-guides.render` | adapt | Switches Obsidian's "Show indentation guides" setting when set. Other keys ignored. |
| `mouse`, `middle-click-paste` | skip | Obsidian is mouse-first; macOS has no middle-click paste. |
| `shell`, `clipboard-provider`, `true-color`, `undercurl`, `kitty-keyboard-protocol` | skip | Terminal or shell only. |
| `bufferline`, `rulers`, `cursorcolumn`, `popup-border`, `rainbow-brackets` | skip | Obsidian draws its own UI. |
| `lsp.*`, `inline-diagnostics.*`, `end-of-line-diagnostics`, `auto-completion`, `path-completion`, `word-completion.*`, `completion-*`, `preview-completion-insert`, `idle-timeout`, `auto-format`, `workspace-lsp-roots`, `workspace-trust.*` | skip | LSP or completion. |
| `continue-comments`, `indent-heuristic`, `default-line-ending`, `atomic-save`, `editor-config` | skip | Obsidian controls these. |
| `file-picker.*`, `file-explorer.*`, `buffer-picker.*` | skip | Obsidian's switcher and explorer. |
| `[theme]` | skip | Obsidian themes. |

The example config in `test-vault/helix.toml` comes from a real Helix config. Only its shell commands were dropped: one switched the keyboard input source so a Russian layout did not break normal mode, and one opened a terminal file manager. The layout rule (physical keys in normal and select mode) does the first job here.

## Syntax tree

Obsidian's editor parser is a flat token stream, so the plugin parses notes itself with the grammars Helix uses: `tree-sitter-markdown` and `tree-sitter-markdown-inline` at the commit in Helix's `languages.toml`, compiled to WebAssembly together with the tree-sitter C library at Helix's version (0.26.9) by `tree-sitter/build.sh`. The text goes in as UTF-8, as in Helix, so error recovery picks the same trees. Helix updates its trees after every edit; the plugin parses fresh when a command needs a tree, so after an edit a broken spot can still parse differently (1 case in about 6,000 fuzz cases). `src/syntax/syntax.ts` ports Helix's injection layers (`tree-house`): `inline` nodes and table cells get a `markdown.inline` layer, and fenced code marked `md` or `markdown` gets a nested markdown layer.

Uses of the tree, as in Helix: `Alt-o`, `Alt-i`, `Alt-n`, `Alt-p`, `Alt-a`, `Alt-I`, `Alt-e`, `Alt-b`, `mm`, `mim`/`mam` and `mi(` style pairs, `md`/`mr` with pairs, and the auto-pairs of the layer under the cursor (markdown adds `‘’`, `«»` and `“”`).

Helix also has grammars for the code inside fences, HTML, YAML front matter and LaTeX. Those layers do not exist here, so inside them the tree is the markdown one. The `helix.toml` editor in the settings has no tree (Helix would use TOML).

The tree is parsed on demand, when a command needs it, and kept until the note changes. On a 20,000-line note that costs about 100 ms for the first tree command after an edit; on a 2,000-line note about 15 ms. Auto-pairs only ask for the tree when the two pair sets give different results.

## Plugin options

Options that Helix does not have. They live in the plugin's settings tab, not in `helix.toml`. The same tab has an editor for `helix.toml` with Helix keys; `:w` or Mod+S saves it, and config warnings show under it.

| Option | Default | Effect |
| --- | --- | --- |
| Auto-pairs | Helix | Helix: `auto_pairs.rs` and `[editor.auto-pairs]`. Obsidian: Obsidian's own auto-pair settings. |
| Insert keys (Enter, Tab, Backspace) | Obsidian | Obsidian: list continuation, list indent, table cells. Helix: `insert_newline`, `smart_tab`, `delete_char_backward` ports. |
| Read keys by position | On | Normal and select mode read keys by their US-layout position with non-Latin layouts. |

## Decisions

1. Live Preview shows the markup inside every Helix selection in normal and select mode.
2. Auto-pairs: both, as an option (above).
3. `o` and `O` continue list markers.
4. Insert keys: both, as an option (above).
5. No text objects beyond Helix's. If Helix does not have it, we do not have it.
6. We draw only what Obsidian can't: cursor cells, selections other than the primary one (and all of them in insert mode), `gw` labels, cursorline, the prompt and the which-key box. The primary selection in normal and select mode is Obsidian's native one. Line numbers and indent guides are Obsidian's settings.
7. Helix options live in `helix.toml` only. The settings tab holds only choices Helix can't make.
8. Desktop only.

## Status

Steps 2 to 6 are implemented.

Known gaps:

- `:tutor` shows "not available".
- In insert mode, Live Preview shows markup only around the caret. Typing replaces a non-empty native selection, so the native selection must be a caret there.
- `Cmd-Z` is Obsidian's own undo. `u`, `U`, `Alt-u`, `Alt-U`, `:earlier` and `:later` use the ported Helix history.
- On a 20,000-line note one key costs about one Obsidian transaction (~25 ms on an M1 Air).
