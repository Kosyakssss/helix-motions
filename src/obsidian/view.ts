import { Prec, RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  showPanel,
  type DecorationSet,
  type Panel,
  type ViewUpdate,
} from "@codemirror/view";
import type { HelixEditor } from "../core/editor";
import type { Host } from "../core/host";
import { keyFromDom } from "../keys";
import { search, type TrieNode } from "../keymap/trie";
import { nextGraphemeBoundary } from "../graphemes";
import { cursorLayers } from "./cursor";
import { syncBar } from "./status";
import { helixField, helixOwned, historyField, setHelix, syncNativeSelection, toNative } from "../state";
import { hookInsert } from "../auto-pairs";
import { autoPairsFor, insertDiffers, mayAutoPair } from "../commands/insert";
import { changeByAndWithSelection } from "../commands/util";
import { pasteImpl } from "../commands/edit";
import { exitSelectMode } from "../commands/util";
import { Context } from "../core/editor";

export interface ViewEnv {
  editor: HelixEditor;
  hostFor(view: EditorView): Host;
  insertKeysHelix(): boolean;
  physicalKeys(): boolean;
  suggestTakes(event: KeyboardEvent): boolean;
  onFocusChange(view: EditorView): void;
  onRender(view: EditorView): void;
  onChanges(view: EditorView, changes: import("@codemirror/state").ChangeSet): void;
  onDocTransaction(view: EditorView, tr: import("@codemirror/state").Transaction): void;
  onViewOpen(view: EditorView): void;
  onViewClose(view: EditorView): void;
}

class LabelWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  override eq(other: LabelWidget): boolean {
    return other.text === this.text;
  }
  toDOM(): HTMLElement {
    return createSpan({ cls: "hx-jump-label", text: this.text });
  }
}

function endComposition(view: EditorView): void {
  const scroller = view.scrollDOM;
  const parent = scroller.parentElement;
  if (!parent) return;
  const sibling = scroller.nextSibling;
  const selection = view.dom.ownerDocument.getSelection();
  const saved = selection && {
    anchorNode: selection.anchorNode,
    anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode,
    focusOffset: selection.focusOffset,
  };
  scroller.remove();
  parent.insertBefore(scroller, sibling);
  try {
    if (saved && selection && saved.anchorNode) {
      selection.setPosition(saved.anchorNode, saved.anchorOffset);
      if (saved.focusNode) selection.extend(saved.focusNode, saved.focusOffset);
    }
  } catch {
    selection?.removeAllRanges();
  }
  view.focus();
  view.contentDOM.dispatchEvent(new CustomEvent("compositionend"));
}

function buildDecorations(view: EditorView, env: ViewEnv): DecorationSet {
  const state = view.state;
  const value = state.field(helixField, false);
  if (!value) return Decoration.none;
  const doc = state.doc;
  const builder: { from: number; to: number; deco: Decoration }[] = [];
  const labels = [...(env.editor.jumpLabels.get(env.hostFor(view).id) ?? [])].sort((x, y) => x.pos - y.pos);
  const groups: { pos: number; end: number; text: string }[] = [];
  for (const label of labels) {
    if (label.pos >= doc.length || doc.lineAt(label.pos).to === label.pos) continue;
    const end = nextGraphemeBoundary(doc, label.pos);
    const last = groups[groups.length - 1];
    if (last && last.end === label.pos) {
      last.end = end;
      last.text += label.text;
    } else {
      groups.push({ pos: label.pos, end, text: label.text });
    }
  }
  for (const group of groups) {
    builder.push({ from: group.pos, to: group.end, deco: Decoration.replace({ widget: new LabelWidget(group.text) }) });
  }
  builder.sort((a, b) => a.from - b.from || a.deco.startSide - b.deco.startSide || a.to - b.to);
  const set = new RangeSetBuilder<Decoration>();
  let lastReplaceEnd = -1;
  for (const d of builder) {
    if (d.from < lastReplaceEnd) continue;
    set.add(d.from, d.to, d.deco);
    if ((d.deco.spec as { widget?: unknown }).widget && d.to > d.from) lastReplaceEnd = d.to;
  }
  return set.finish();
}

function cursorLineDecorations(view: EditorView, env: ViewEnv): DecorationSet {
  if (!env.editor.config.cursorline) return Decoration.none;
  const value = view.state.field(helixField, false);
  if (!value) return Decoration.none;
  const doc = view.state.doc;
  const lines = new Set<number>();
  const { from: vFrom, to: vTo } = view.viewport;
  for (const r of value.selection.ranges) {
    const cursor = r.cursor(doc);
    if (cursor >= vFrom && cursor <= vTo) lines.add(doc.lineAt(cursor).from);
  }
  const builder = new RangeSetBuilder<Decoration>();
  for (const from of [...lines].sort((a, b) => a - b)) builder.add(from, from, Decoration.line({ class: "hx-cursorline" }));
  return builder.finish();
}

function literalWanted(editor: HelixEditor, mode: string): boolean {
  return editor.activePrompt !== null || editor.onNextKeyState !== null || mode === "insert";
}

function pendingNode(editor: HelixEditor, mode: "normal" | "select" | "insert"): TrieNode {
  const root = editor.keymaps.sticky ?? editor.keymaps.map[mode];
  const node = search(root, editor.keymaps.pending());
  return node && node.kind === "node" ? node : editor.keymaps.map[mode];
}

const OBSIDIAN_INSERT_KEYS = new Set(["ret", "tab", "S-tab", "backspace", "S-backspace"]);

export function helixExtension(env: ViewEnv): Extension {
  const { editor } = env;

  const onKey = (event: KeyboardEvent, view: EditorView): boolean => {
    if (event.metaKey) return false;
    const host = env.hostFor(view);
    const value = view.state.field(helixField, false);
    if (!value) return false;
    const mode = value.mode;
    if (mode === "insert" && env.suggestTakes(event) && !editor.activePrompt) return false;
    const dead = event.key === "Dead";
    if (dead && mode === "insert" && !editor.activePrompt) return false;
    const literal = literalWanted(editor, mode);
    let key = keyFromDom(event, literal, env.physicalKeys());
    if (key === null) {
      if (!dead) return false;
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    if (mode === "insert" && !editor.activePrompt && editor.onNextKeyState === null && (event.altKey || event.ctrlKey)) {
      const physical = keyFromDom(event, false);
      if (physical && physical !== key && pendingNode(editor, "insert").map.has(physical)) key = physical;
    }
    const consumed = editor.handleKey(host, key, {
      nativeInsert: true,
      passThrough: (k) => !env.insertKeysHelix() && OBSIDIAN_INSERT_KEYS.has(k),
    });
    if (!consumed && !dead) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  const keyHandler = Prec.highest(
    EditorView.domEventHandlers({
      compositionstart(_event, view) {
        const value = view.state.field(helixField, false);
        if (!value || (value.mode === "insert" && !editor.activePrompt)) return false;
        window.setTimeout(() => {
          if (view.compositionStarted) endComposition(view);
        }, 0);
        return false;
      },
      keydown(event, view) {
        if (event.isComposing || event.key === "Process") {
          const value = view.state.field(helixField, false);
          if (!value || (value.mode === "insert" && !editor.activePrompt)) return false;
          endComposition(view);
        }
        return onKey(event, view);
      },
    }),
  );

  const stuckComposition = ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        view.contentDOM.addEventListener("keydown", this.listener, true);
      }
      listener = (event: KeyboardEvent) => {
        const view = this.view;
        if (!view.composing) return;
        const value = view.state.field(helixField, false);
        if (!value || (value.mode === "insert" && !editor.activePrompt)) return;
        endComposition(view);
        onKey(event, view);
      };
      destroy() {
        this.view.contentDOM.removeEventListener("keydown", this.listener, true);
      }
    },
  );

  const swallowInput = Prec.highest(
    EditorView.inputHandler.of((view) => {
      const value = view.state.field(helixField, false);
      if (!value || (value.mode === "insert" && !editor.activePrompt)) return false;
      if (view.compositionStarted) window.setTimeout(() => endComposition(view), 0);
      return true;
    }),
  );

  const autoPairsInput = Prec.highest(
    EditorView.inputHandler.of((view, _from, _to, text) => {
      const value = view.state.field(helixField, false);
      if (!value || value.mode !== "insert" || !editor.helixAutoPairs) return false;
      if ([...text].length !== 1 || !mayAutoPair(editor, text)) return false;
      const host = env.hostFor(view);
      const map = autoPairsFor(editor, host, insertDiffers(view.state.doc, value.selection.ranges, text));
      if (!map || (!map.has(text) && !/^\p{White_Space}$/u.test(text))) return false;
      const doc = view.state.doc;
      const touched = value.selection.ranges.some((r) => hookInsert(doc, r, text, map) !== null);
      if (!touched) return false;
      const cx = new Context(editor, host, null, null);
      changeByAndWithSelection(cx, (range) => {
        const hooked = hookInsert(doc, range, text, map);
        if (hooked) return hooked;
        const cursor = range.cursor(doc);
        return [[cursor, cursor, text], null];
      });
      return true;
    }),
  );

  const decorations = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(readonly view: EditorView) {
        env.onViewOpen(view);
        this.decorations = buildDecorations(view, env);
        queueMicrotask(() => {
          const value = view.state.field(helixField, false);
          if (!value) return;
          const native = toNative(value, view.state.doc);
          if (!native.eq(view.state.selection)) {
            view.dispatch({ selection: native, effects: setHelix.of({}), annotations: helixOwned.of(true) });
          }
        });
      }
      update(update: ViewUpdate) {
        for (const tr of update.transactions) if (tr.docChanged) env.onDocTransaction(update.view, tr);
        if (update.docChanged) env.onChanges(update.view, update.changes);
        if (update.docChanged || update.selectionSet || update.viewportChanged || update.transactions.length > 0) {
          this.decorations = buildDecorations(update.view, env);
        }
        if (update.focusChanged && update.view.hasFocus) env.onFocusChange(update.view);
        if (update.transactions.length > 0 || update.focusChanged) env.onRender(update.view);
      }
      destroy() {
        env.onViewClose(this.view);
      }
    },
    { decorations: (v) => v.decorations },
  );

  const cursorLine = ViewPlugin.fromClass(
    class {
      lines: DecorationSet;
      constructor(view: EditorView) {
        this.lines = cursorLineDecorations(view, env);
      }
      update(update: ViewUpdate) {
        this.lines = cursorLineDecorations(update.view, env);
      }
    },
    { decorations: (v) => v.lines },
  );

  const pasteHandler = Prec.highest(
    EditorView.domEventHandlers({
      paste(event, view) {
        const value = view.state.field(helixField, false);
        if (!value || value.mode === "insert") return false;
        const text = event.clipboardData?.getData("text/plain");
        if (!text) return false;
        event.preventDefault();
        const cx = new Context(editor, env.hostFor(view), editor.count, null);
        editor.count = null;
        pasteImpl(cx, [text], value.mode === "normal" ? "before" : "cursor", cx.count());
        exitSelectMode(cx);
        return true;
      },
    }),
  );

  const attributes = EditorView.editorAttributes.compute([helixField], (state) => {
    const value = state.field(helixField, false);
    const mode = value?.mode ?? "normal";
    return { class: `hx hx-${mode} hx-shape-${editor.config.cursorShape[mode]}` };
  });

  const scrollMargins = EditorView.scrollMargins.of((view) => {
    const m = editor.config.scrolloff * view.defaultLineHeight;
    return { top: m, bottom: m };
  });

  const panel = showPanel.of((view): Panel => {
    const dom = createDiv({ cls: "hx-panel" });
    const info = dom.createDiv({ cls: "hx-autoinfo hx-hidden" });
    const prompt = dom.createDiv({ cls: "hx-prompt hx-hidden" });
    const message = dom.createDiv({ cls: "hx-message hx-hidden" });
    const render = () => renderPanel(view, env, dom, info, prompt, message);
    render();
    return {
      dom,
      top: false,
      update: render,
    };
  });

  return [
    helixField,
    historyField,
    syncNativeSelection,
    keyHandler,
    stuckComposition,
    swallowInput,
    pasteHandler,
    autoPairsInput,
    decorations,
    cursorLayers(editor),
    cursorLine,
    attributes,
    scrollMargins,
    panel,
  ];
}

function renderPanel(view: EditorView, env: ViewEnv, dom: HTMLElement, info: HTMLElement, prompt: HTMLElement, message: HTMLElement): void {
  const { editor } = env;
  const host = env.hostFor(view);
  const active = editor.activePrompt && editor.activePrompt.host.id === host.id && view.hasFocus ? editor.activePrompt : null;
  prompt.empty();
  prompt.toggleClass("hx-hidden", !active);
  if (active) {
    if (active.completions.length > 0) {
      const list = prompt.createDiv({ cls: "hx-completions" });
      active.completions.slice(0, 40).forEach((c, i) => {
        list.createSpan({ cls: i === active.selection ? "hx-completion hx-completion-selected" : "hx-completion", text: c.label });
      });
    }
    prompt.createSpan({ cls: "hx-prompt-label", text: active.label });
    prompt.createSpan({ text: active.line.slice(0, active.cursor) });
    prompt.createSpan({ cls: "hx-prompt-cursor", text: active.line.slice(active.cursor, active.cursor + 1) || " " });
    prompt.createSpan({ text: active.line.slice(active.cursor + 1) });
  }
  const status = !active && view.hasFocus ? editor.status : null;
  message.setText(status?.message ?? "");
  message.toggleClass("hx-hidden", !status);
  message.toggleClass("hx-message-error", status?.severity === "error");
  const statusBar = view.dom.ownerDocument.querySelector(".status-bar");
  const editorRect = view.dom.getBoundingClientRect();
  const statusRect = statusBar?.getBoundingClientRect();
  const strip = statusBar?.querySelector(".hx-status-strip:not(.hx-hidden)")?.getBoundingClientRect();
  const covered = statusRect && statusRect.height > 0 && statusRect.top < editorRect.bottom && statusRect.left < editorRect.right;
  const coverLeft = covered ? Math.min(statusRect.left, strip?.left ?? Infinity) : editorRect.right;
  dom.setCssProps({ "--hx-bar-overlap": `${Math.max(0, editorRect.right - coverLeft)}px` });
  const opened = dom.hasClass("hx-panel-empty") && (!!active || !!status);
  dom.toggleClass("hx-panel-empty", !active && !status);
  if (opened) {
    window.requestAnimationFrame(() => {
      if (view.dom.isConnected) view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "nearest" }) });
    });
  }
  const statusEl = view.hasFocus ? statusBar?.querySelector<HTMLElement>(".hx-status") : null;
  if (statusEl) {
    statusEl.toggleClass("hx-status-joined", !!covered && (!!active || !!status));
    syncBar(statusEl);
  }
  info.empty();
  const auto = editor.config.autoInfo && view.hasFocus ? editor.autoinfo : null;
  info.toggleClass("hx-hidden", !auto);
  if (!auto) return;
  const title = info.createDiv({ cls: "hx-autoinfo-title" });
  const rows: [string, string][] = [];
  let unavailable = new Set<string>();
  if ("kind" in auto) {
    title.setText(auto.name);
    const grouped = new Map<string, string[]>();
    for (const [key, trie] of auto.map) {
      const desc = trie.kind === "node" ? trie.name : trie.kind === "sequence" ? "[Multiple commands]" : describe(trie.command);
      if (desc === "no_op") continue;
      const list = grouped.get(desc) ?? [];
      list.push(key);
      grouped.set(desc, list);
    }
    for (const [desc, keys] of grouped) rows.push([keys.join(", "), desc]);
    unavailable = new Set(
      [...auto.map]
        .filter(([, t]) => t.kind === "command" && t.command.kind === "static" && !editor.hasCommand(t.command.name))
        .map(([, t]) => describe((t as { command: import("../keymap/trie").MappableCommand }).command)),
    );
  } else {
    title.setText(auto.title);
    rows.push(...auto.body);
  }
  for (const [k, d] of rows) {
    const row = info.createDiv({ cls: unavailable.has(d) ? "hx-autoinfo-row hx-autoinfo-unavailable" : "hx-autoinfo-row" });
    row.createSpan({ cls: "hx-autoinfo-key", text: k });
    row.createSpan({ text: d });
  }
  const panelRect = dom.getBoundingClientRect();
  const lift = statusRect && statusRect.height > 0 && statusRect.left < panelRect.right ? Math.max(0, panelRect.bottom - statusRect.top) : 0;
  dom.setCssProps({ "--hx-autoinfo-lift": `${lift}px`, "--hx-autoinfo-room": `${Math.max(0, panelRect.top - lift - editorRect.top - 16)}px` });
}

function describe(command: import("../keymap/trie").MappableCommand): string {
  if (command.kind === "static") return command.name.replace(/_/g, " ");
  if (command.kind === "typable") return `:${command.raw}`;
  return `@${command.keys}`;
}
