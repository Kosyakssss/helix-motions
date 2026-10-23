import {
  FuzzySuggestModal,
  MarkdownView,
  Notice,
  TFile,
  getLinkpath,
  normalizePath,
  type App,
  type WorkspaceLeaf,
} from "obsidian";
import type { EditorView } from "@codemirror/view";
import type { Context, Workspace } from "../core/editor";
import type { Jump } from "../commands/jumps";
import { setSel, docOf, selOf } from "../commands/util";
import { pushJump } from "../commands/jumps";
import { gotoLineWithoutJumplist } from "../commands/motion";
import { charAt, charBefore } from "../core/text";
import { Range, Selection } from "../selection";

interface PluginLike {
  app: App;
  viewFor(host: { view: EditorView | null }): MarkdownView | null;
  reloadConfig(): Promise<void>;
  configPath(): string;
  lastFileByLeaf: Map<string, string[]>;
  lastModified: string[];
  writeView(view: MarkdownView): Promise<void>;
}

type Item = { label: string; run: () => void };

class ListModal extends FuzzySuggestModal<Item> {
  constructor(
    app: App,
    readonly items: Item[],
    placeholder: string,
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }
  getItems(): Item[] {
    return this.items;
  }
  getItemText(item: Item): string {
    return item.label;
  }
  onChooseItem(item: Item): void {
    item.run();
  }
}

function markdownLeaves(app: App): WorkspaceLeaf[] {
  return app.workspace.getLeavesOfType("markdown");
}

function linkUnderCursor(cx: Context): { kind: "wiki" | "md" | "url"; target: string } | null {
  const doc = docOf(cx);
  const range = selOf(cx).primary();
  const pos = range.cursor(doc);
  const line = doc.lineAt(pos);
  const rel = pos - line.from;
  const text = line.text;
  const patterns: [RegExp, "wiki" | "md" | "url"][] = [
    [/!?\[\[([^\]|#^]*)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g, "wiki"],
    [/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, "md"],
    [/https?:\/\/[^\s<>()\]]+/g, "url"],
  ];
  for (const [re, kind] of patterns) {
    for (const m of text.matchAll(re)) {
      const start = m.index!;
      const end = start + m[0].length;
      if (rel >= start && rel < end) return { kind, target: kind === "url" ? m[0] : decodeURI(m[1]!) };
    }
  }
  if (range.to() - range.from() > 1) return { kind: "wiki", target: doc.sliceString(range.from(), range.to()).trim() };
  let s = pos;
  let e = pos;
  while (s > line.from && !/\s/.test(charBefore(doc, s) ?? " ")) s--;
  while (e < line.to && !/\s/.test(charAt(doc, e) ?? " ")) e++;
  const word = doc.sliceString(s, e);
  if (/^https?:\/\//.test(word)) return { kind: "url", target: word };
  return word ? { kind: "wiki", target: word } : null;
}

interface Unresolved {
  from: number;
  to: number;
  line: number;
  target: string;
}

function unresolvedIn(app: App, file: TFile): Unresolved[] {
  const cache = app.metadataCache.getFileCache(file);
  const refs = [...(cache?.links ?? []), ...(cache?.embeds ?? [])];
  return refs
    .filter((ref) => app.metadataCache.getFirstLinkpathDest(getLinkpath(ref.link), file.path) === null)
    .map((ref) => ({ from: ref.position.start.offset, to: ref.position.end.offset, line: ref.position.start.line + 1, target: ref.link }))
    .sort((a, b) => a.from - b.from);
}

async function openAt(app: App, file: TFile, from: number, to: number): Promise<void> {
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);
  if (!(leaf.view instanceof MarkdownView)) return;
  const editor = leaf.view.editor;
  editor.setSelection(editor.offsetToPos(from), editor.offsetToPos(to));
  editor.scrollIntoView({ from: editor.offsetToPos(from), to: editor.offsetToPos(to) }, true);
  editor.focus();
}

export function makeWorkspace(plugin: PluginLike): Workspace {
  const app = plugin.app;
  let lastPicker: (() => void) | null = null;
  const cmd = (id: string) => (app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands.executeCommandById(id);
  const fileOf = (cx: Context) => plugin.viewFor(cx.host)?.file ?? null;
  const leafOf = (cx: Context) => plugin.viewFor(cx.host)?.leaf ?? null;
  const picker = (fn: () => void) => {
    lastPicker = fn;
    fn();
  };

  const openTarget = async (cx: Context, target: string, mode: false | "split" | "tab", direction?: "vertical" | "horizontal") => {
    const source = fileOf(cx)?.path ?? "";
    if (/^[a-z]+:\/\//i.test(target)) {
      window.open(target);
      return;
    }
    if (mode === "split") {
      const leaf = app.workspace.getLeaf("split", direction ?? "vertical");
      const file = app.metadataCache.getFirstLinkpathDest(target, source);
      if (file) await leaf.openFile(file);
      else await app.workspace.openLinkText(target, source, false);
      return;
    }
    await app.workspace.openLinkText(target, source, mode === "tab");
  };

  const neighbour = (cx: Context, dir: "left" | "right" | "up" | "down"): WorkspaceLeaf | null => {
    const current = leafOf(cx);
    if (!current) return null;
    const rect = (current as unknown as { containerEl: HTMLElement }).containerEl.getBoundingClientRect();
    const cx0 = rect.left + rect.width / 2;
    const cy0 = rect.top + rect.height / 2;
    let best: WorkspaceLeaf | null = null;
    let bestDist = Infinity;
    for (const leaf of markdownLeaves(app)) {
      if (leaf === current) continue;
      const el = (leaf as unknown as { containerEl: HTMLElement }).containerEl;
      if (!el.isShown()) continue;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const ok = dir === "left" ? r.right <= rect.left + 1 : dir === "right" ? r.left >= rect.right - 1 : dir === "up" ? r.bottom <= rect.top + 1 : r.top >= rect.bottom - 1;
      if (!ok) continue;
      const d = Math.hypot(x - cx0, y - cy0);
      if (d < bestDist) {
        bestDist = d;
        best = leaf;
      }
    }
    return best;
  };

  const focusLeaf = (leaf: WorkspaceLeaf | null) => {
    if (!leaf) return;
    app.workspace.setActiveLeaf(leaf, { focus: true });
  };

  const tabStep = (cx: Context, delta: number) => {
    const current = leafOf(cx);
    if (!current) return;
    const parent = (current as unknown as { parent?: { children?: WorkspaceLeaf[] } }).parent;
    const siblings = parent?.children?.filter((l) => l.view instanceof MarkdownView) ?? markdownLeaves(app);
    const idx = siblings.indexOf(current);
    if (idx < 0 || siblings.length < 2) return;
    const count = cx.count();
    const next = siblings[(((idx + delta * count) % siblings.length) + siblings.length) % siblings.length]!;
    focusLeaf(next);
  };

  const run = (cx: Context, name: string, args: string[]) => {
    const view = plugin.viewFor(cx.host);
    switch (name) {
      case "file_picker":
        picker(() => cmd("switcher:open"));
        return;
      case "file_picker_in_current_buffer_directory": {
        const folder = fileOf(cx)?.parent?.path ?? "/";
        picker(() =>
          new ListModal(
            app,
            app.vault
              .getFiles()
              .filter((f) => (f.parent?.path ?? "/") === folder || f.path.startsWith(folder === "/" ? "" : folder + "/"))
              .map((f) => ({ label: f.path, run: () => void app.workspace.getLeaf(false).openFile(f) })),
            `Files in ${folder}`,
          ).open(),
        );
        return;
      }
      case "file_explorer":
        cmd("file-explorer:open");
        return;
      case "file_explorer_in_current_buffer_directory":
        cmd("file-explorer:reveal-active-file");
        return;
      case "buffer_picker":
        picker(() =>
          new ListModal(
            app,
            markdownLeaves(app).map((leaf) => ({
              label: (leaf.view as MarkdownView).file?.path ?? leaf.getDisplayText(),
              run: () => focusLeaf(leaf),
            })),
            "Open buffers",
          ).open(),
        );
        return;
      case "jumplist_picker": {
        const list = cx.editor.jumplist(cx.host);
        picker(() =>
          new ListModal(
            app,
            list.jumps.map((j) => ({
              label: `${j.docId}: ${j.selection.primary().cursor(cx.host.state.doc)}`,
              run: () => cx.editor.jumpTo(cx, j),
            })),
            "Jumplist",
          ).open(),
        );
        return;
      }
      case "last_picker":
        if (lastPicker) lastPicker();
        else cx.editor.setError("no last picker");
        return;
      case "symbol_picker": {
        const file = fileOf(cx);
        const headings = file ? (app.metadataCache.getFileCache(file)?.headings ?? []) : [];
        picker(() =>
          new ListModal(
            app,
            headings.map((h) => ({
              label: `${"#".repeat(h.level)} ${h.heading}`,
              run: () => {
                const pos = cx.host.state.doc.line(h.position.start.line + 1).from;
                const doc = cx.host.state.doc;
                setSel(cx, selOf(cx).transform((r) => r.putCursor(doc, pos, false)).ensureInvariants(doc));
                (cx.host.view as EditorView | null)?.focus();
              },
            })),
            "Headings",
          ).open(),
        );
        return;
      }
      case "workspace_symbol_picker": {
        const items: Item[] = [];
        for (const file of app.vault.getMarkdownFiles()) {
          for (const h of app.metadataCache.getFileCache(file)?.headings ?? []) {
            items.push({
              label: `${file.basename} › ${h.heading}`,
              run: () => void app.workspace.openLinkText(`${file.path}#${h.heading}`, "", false),
            });
          }
        }
        picker(() => new ListModal(app, items, "Headings in vault").open());
        return;
      }
      case "command_palette":
      case "code_action":
        cmd("command-palette:open");
        return;
      case "diagnostics_picker": {
        const file = fileOf(cx);
        if (!file) return;
        const items = unresolvedIn(app, file).map((u) => ({
          label: `${u.line}: ${u.target}`,
          run: () => {
            const doc = cx.host.state.doc;
            const from = Math.min(u.from, doc.length);
            pushJump(cx);
            setSel(cx, new Selection([new Range(from, Math.min(u.to, doc.length))], 0).ensureInvariants(doc));
            (cx.host.view as EditorView | null)?.focus();
          },
        }));
        picker(() => new ListModal(app, items, "Unresolved links").open());
        return;
      }
      case "workspace_diagnostics_picker": {
        const items: Item[] = [];
        for (const path of Object.keys(app.metadataCache.unresolvedLinks)) {
          const file = app.vault.getFileByPath(path);
          if (!file) continue;
          for (const u of unresolvedIn(app, file)) {
            items.push({ label: `${file.path}:${u.line}  ${u.target}`, run: () => void openAt(app, file, u.from, u.to) });
          }
        }
        picker(() => new ListModal(app, items, "Unresolved links in vault").open());
        return;
      }
      case "goto_first_diag":
      case "goto_last_diag":
      case "goto_next_diag":
      case "goto_prev_diag": {
        const file = fileOf(cx);
        if (!file) return;
        const list = unresolvedIn(app, file);
        const doc = cx.host.state.doc;
        const cursor = selOf(cx).primary().cursor(doc);
        const found =
          name === "goto_first_diag"
            ? list[0]
            : name === "goto_last_diag"
              ? list[list.length - 1]
              : name === "goto_next_diag"
                ? list.find((u) => u.from > cursor)
                : [...list].reverse().find((u) => u.to < cursor);
        if (!found) return;
        pushJump(cx);
        setSel(cx, new Selection([new Range(Math.min(found.from, doc.length), Math.min(found.to, doc.length))], 0).ensureInvariants(doc));
        return;
      }
      case "global_search": {
        const query = cx.editor.registers.first("/", cx.editor.registerEnv(cx.host)) ?? "";
        const search = (app as unknown as { internalPlugins: { getPluginById(id: string): { instance?: { openGlobalSearch(q: string): void } } | null } }).internalPlugins.getPluginById("global-search");
        if (search?.instance) search.instance.openGlobalSearch(query);
        else cmd("global-search:open");
        return;
      }
      case "goto_file":
      case "goto_definition":
      case "goto_file_hsplit":
      case "goto_file_vsplit": {
        const link = linkUnderCursor(cx);
        if (!link) {
          cx.editor.setError("no link under cursor");
          return;
        }
        if (name === "goto_file" || name === "goto_definition") pushJump(cx);
        if (name === "goto_file_hsplit") void openTarget(cx, link.target, "split", "horizontal");
        else if (name === "goto_file_vsplit") void openTarget(cx, link.target, "split", "vertical");
        else void openTarget(cx, link.target, false);
        return;
      }
      case "goto_reference": {
        const link = linkUnderCursor(cx);
        const source = fileOf(cx);
        const target =
          (link && link.kind === "wiki" && source ? app.metadataCache.getFirstLinkpathDest(link.target, source.path) : null) ?? source;
        if (!target) return;
        const items: Item[] = [];
        const resolved = app.metadataCache.resolvedLinks;
        for (const [from, targets] of Object.entries(resolved)) {
          if (targets[target.path]) {
            items.push({ label: from, run: () => void app.workspace.openLinkText(from, "", false) });
          }
        }
        picker(() => new ListModal(app, items, `Backlinks to ${target.basename}`).open());
        return;
      }
      case "hover": {
        const link = linkUnderCursor(cx);
        const ev = cx.host.view;
        if (!link || !ev) return;
        const coords = ev.coordsAtPos(selOf(cx).primary().cursor(cx.host.state.doc));
        const target = document.body.createSpan({ cls: "hx-hover-anchor" });
        target.style.position = "fixed";
        target.style.left = `${coords?.left ?? 0}px`;
        target.style.top = `${coords?.top ?? 0}px`;
        target.style.width = "1px";
        target.style.height = `${(coords?.bottom ?? 0) - (coords?.top ?? 0)}px`;
        app.workspace.trigger("hover-link", {
          event: new MouseEvent("mouseover", { clientX: coords?.left ?? 0, clientY: coords?.bottom ?? 0, metaKey: true, ctrlKey: true }),
          source: "editor",
          hoverParent: view ?? { hoverPopover: null },
          targetEl: target,
          linktext: link.target,
          sourcePath: fileOf(cx)?.path ?? "",
        });
        cx.editor.onNextKeyCleanup.push(() => {
          const parent = (view ?? null) as unknown as { hoverPopover?: { hide(): void } | null } | null;
          parent?.hoverPopover?.hide();
          target.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
          target.remove();
        });
        return;
      }
      case "rename_symbol": {
        const link = linkUnderCursor(cx);
        const source = fileOf(cx);
        const target = (link && source ? app.metadataCache.getFirstLinkpathDest(link.target, source.path) : null) ?? source;
        if (!target) return;
        cx.editor.prompt(cx, {
          label: "rename-to:",
          initial: target.basename,
          onAccept: (input) => {
            if (!input) return;
            const path = normalizePath((target.parent && target.parent.path !== "/" ? target.parent.path + "/" : "") + input + "." + target.extension);
            void app.fileManager.renameFile(target, path);
          },
        });
        return;
      }
      case "goto_last_accessed_file": {
        const leaf = leafOf(cx);
        const id = leaf ? leafId(leaf) : "";
        const history = plugin.lastFileByLeaf.get(id) ?? [];
        const current = fileOf(cx)?.path;
        const alt = [...history].reverse().find((p) => p !== current);
        const file = alt ? app.vault.getAbstractFileByPath(alt) : null;
        if (file instanceof TFile && leaf) void leaf.openFile(file);
        else cx.editor.setError("no last accessed buffer");
        return;
      }
      case "goto_last_modified_file": {
        const current = fileOf(cx)?.path;
        const alt = [...plugin.lastModified].reverse().find((p) => p !== current);
        const file = alt ? app.vault.getAbstractFileByPath(alt) : null;
        if (file instanceof TFile) void app.workspace.getLeaf(false).openFile(file);
        else cx.editor.setError("no last modified buffer");
        return;
      }
      case "goto_next_buffer":
        tabStep(cx, 1);
        return;
      case "goto_previous_buffer":
        tabStep(cx, -1);
        return;
      case "jump_view_left":
      case "jump_view_right":
      case "jump_view_up":
      case "jump_view_down":
        focusLeaf(neighbour(cx, name.slice(10) as "left"));
        return;
      case "swap_view_left":
      case "swap_view_right":
      case "swap_view_up":
      case "swap_view_down": {
        const other = neighbour(cx, name.slice(10) as "left");
        const current = leafOf(cx);
        if (!other || !current) return;
        const a = (current.view as MarkdownView).file;
        const b = (other.view as MarkdownView).file;
        if (a && b) {
          void current.openFile(b);
          void other.openFile(a).then(() => focusLeaf(other));
        }
        return;
      }
      case "rotate_view":
      case "rotate_view_reverse": {
        const leaves = markdownLeaves(app);
        const current = leafOf(cx);
        const idx = current ? leaves.indexOf(current) : -1;
        if (leaves.length < 2) return;
        const step = name === "rotate_view" ? 1 : -1;
        focusLeaf(leaves[(idx + step + leaves.length) % leaves.length]!);
        return;
      }
      case "hsplit":
      case "vsplit": {
        const file = fileOf(cx);
        const target = args[0];
        const leaf = app.workspace.getLeaf("split", name === "vsplit" ? "vertical" : "horizontal");
        if (target) void openTarget(cx, target, false).catch(() => {});
        else if (file) void leaf.openFile(file);
        return;
      }
      case "hsplit_new":
      case "vsplit_new": {
        const leaf = app.workspace.getLeaf("split", name === "vsplit_new" ? "vertical" : "horizontal");
        void newNote(app).then((f) => leaf.openFile(f));
        return;
      }
      case "wclose":
      case "quit":
        leafOf(cx)?.detach();
        return;
      case "wonly": {
        const current = leafOf(cx);
        for (const leaf of markdownLeaves(app)) if (leaf !== current) leaf.detach();
        return;
      }
      case "write":
        if (view) {
          if (args[0]) void app.vault.create(normalizePath(args[0]), view.editor.getValue()).catch((e: Error) => cx.editor.setError(e.message));
          else void plugin.writeView(view);
        }
        return;
      case "write-all":
        for (const leaf of markdownLeaves(app)) void plugin.writeView(leaf.view as MarkdownView);
        return;
      case "write-quit":
      case "write-buffer-close":
        if (view) void plugin.writeView(view).then(() => view.leaf.detach());
        return;
      case "write-quit-all":
        for (const leaf of markdownLeaves(app)) void plugin.writeView(leaf.view as MarkdownView).then(() => leaf.detach());
        return;
      case "quit-all":
      case "buffer-close-all":
        for (const leaf of markdownLeaves(app)) leaf.detach();
        return;
      case "buffer-close":
        leafOf(cx)?.detach();
        return;
      case "buffer-close-others": {
        const current = leafOf(cx);
        for (const leaf of markdownLeaves(app)) if (leaf !== current) leaf.detach();
        return;
      }
      case "open": {
        if (!args[0]) {
          cx.editor.setError("'open': missing path");
          return;
        }
        for (const target of args) {
          const path = normalizePath(target.endsWith(".md") ? target : target + ".md");
          const file = app.vault.getAbstractFileByPath(path) ?? app.metadataCache.getFirstLinkpathDest(target, fileOf(cx)?.path ?? "");
          if (file instanceof TFile) void app.workspace.getLeaf(false).openFile(file);
          else void app.vault.create(path, "").then((f) => app.workspace.getLeaf(false).openFile(f));
        }
        return;
      }
      case "new":
        void newNote(app).then((f) => app.workspace.getLeaf(false).openFile(f));
        return;
      case "reload":
      case "reload-all": {
        const views = name === "reload" ? (view ? [view] : []) : markdownLeaves(app).map((l) => l.view as MarkdownView);
        for (const v of views) {
          if (!v.file) continue;
          void app.vault.read(v.file).then((text) => {
            if (text !== v.editor.getValue()) v.editor.setValue(text);
          });
        }
        return;
      }
      case "move": {
        const file = fileOf(cx);
        if (!file || !args[0]) {
          cx.editor.setError("'move': missing path");
          return;
        }
        const dest = normalizePath(args[0].includes(".") ? args[0] : args[0] + "." + file.extension);
        void app.fileManager.renameFile(file, dest).catch((e: Error) => cx.editor.setError(e.message));
        return;
      }
      case "read": {
        if (!args[0]) return;
        const file = app.vault.getAbstractFileByPath(normalizePath(args[0])) ?? app.metadataCache.getFirstLinkpathDest(args[0], fileOf(cx)?.path ?? "");
        if (!(file instanceof TFile)) {
          cx.editor.setError(`'read': file not found: ${args[0]}`);
          return;
        }
        void app.vault.read(file).then((text) => {
          const host = cx.host;
          const doc = host.state.doc;
          const pos = selOf(cx).primary().cursor(doc);
          host.dispatch({ changes: { from: pos, insert: text } });
        });
        return;
      }
      case "config-reload":
        void plugin.reloadConfig().then(() => cx.editor.setStatus("Config reloaded"));
        return;
      case "config-open": {
        const shell = (window as unknown as { require?: (m: string) => { shell?: { openPath(p: string): Promise<string> } } }).require?.("electron")?.shell;
        const base = (app.vault.adapter as unknown as { getBasePath?: () => string }).getBasePath?.();
        if (shell && base) void shell.openPath(`${base}/${plugin.configPath()}`);
        else new Notice(`Config: ${plugin.configPath()}`);
        return;
      }
      case "tutor":
        new Notice("The Helix tutor is not bundled yet.");
        return;
      default:
        cx.editor.setStatus(`${name} is not available`);
    }
  };

  return {
    run,
    openJump: (cx: Context, jump: Jump) => {
      const file = app.vault.getAbstractFileByPath(jump.docId);
      const leaf = leafOf(cx);
      if (!(file instanceof TFile) || !leaf) return;
      void leaf.openFile(file).then(() => {
        const v = leaf.view;
        if (!(v instanceof MarkdownView)) return;
        const host = (plugin as unknown as { hostForView(view: EditorView): Context["host"] }).hostForView(
          (v.editor as unknown as { cm: EditorView }).cm,
        );
        const ncx = new (cx.constructor as new (...a: unknown[]) => Context)(cx.editor, host, null, null);
        setSel(ncx, jump.selection);
      });
    },
  };
}

export function leafId(leaf: WorkspaceLeaf): string {
  return (leaf as unknown as { id?: string }).id ?? "leaf";
}

async function newNote(app: App): Promise<TFile> {
  let i = 0;
  for (;;) {
    const path = i === 0 ? "Untitled.md" : `Untitled ${i}.md`;
    if (!app.vault.getAbstractFileByPath(path)) return app.vault.create(path, "");
    i++;
  }
}

export { gotoLineWithoutJumplist };
