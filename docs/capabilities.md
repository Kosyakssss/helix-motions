# Privacy and capabilities

Helix Motions makes no network requests, has no telemetry, and stays inside your vault.

| Capability | What it does |
| --- | --- |
| Clipboard | Only the `+` and `*` registers read and write the system clipboard, as in Helix. To keep Helix's commands synchronous, the plugin reads the clipboard when Obsidian gets focus and after a copy or cut. |
| Files | Reads and writes `helix.toml` in the vault. `:w`, `:o`, `:move` and similar commands work on notes, as in Helix. |
| File list | Lists the vault's file paths, only when you open a picker or complete a path. Unresolved links come from Obsidian's link index. |
| Obsidian settings | Changes **Show line number** and **Show indentation guides** only when `helix.toml` sets `line-number`, `gutters` or `indent-guides`. |
| Network | None. |

## WebAssembly

`main.js` contains two compressed WebAssembly files from [helix-cm6](https://github.com/Kosyakssss/helix-cm6). Both are built from pinned sources and checked byte for byte in its CI.

| File | Contents |
| --- | --- |
| `tree-sitter.wasm` | The tree-sitter C library, the two markdown grammars and a small binding. |
| `regex.wasm` | Helix's regex engine (`regex-cursor` and `regex-automata`, the same versions as Helix) with a small binding. |

The end of `main.js` has their licenses.

## Source

`main.js` is this repo plus helix-cm6 at the commit pinned in `package.json`. `bun install` and `bun run build` rebuild it byte for byte. `bun run lint` checks both with `eslint-plugin-obsidianmd`.
