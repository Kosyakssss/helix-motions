import { Compartment, Prec, RangeSet, RangeSetBuilder, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  highlightWhitespace,
  lineNumberMarkers,
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
import { helixField, helixOwned, historyField, setHelix, syncNativeSelection, toNative } from "../state";
import { hookInsert, makeAutoPairs } from "../auto-pairs";
import { changeByAndWithSelection } from "../commands/util";
import { pasteImpl } from "../commands/edit";
import { exitSelectMode } from "../commands/util";
import { Context } from "../core/editor";

export interface ViewEnv {
  editor: HelixEditor;
  hostFor(view: EditorView): Host;
  insertKeysHelix(): boolean;
  suggestOpen(): boolean;
  onFocusChange(view: EditorView): void;
  onRender(view: EditorView): void;
  onChanges(view: EditorView, changes: import("@codemirror/state").ChangeSet): void;
}

class EolCursor extends WidgetType {
  constructor(readonly cls: string) {
    super();
  }
  override eq(other: EolCursor): boolean {
    return other.cls === this.cls;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = this.cls;
    span.textContent = " ";
    return span;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

class LabelWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  override eq(other: LabelWidget): boolean {
    return other.text === this.text;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "hx-jump-label";
    span.textContent = this.text;
    return span;
  }
}

function endComposition(view: EditorView): void {
  const input = (view as unknown as { inputState?: { composing: number; compositionFirstChange: boolean | null } }).inputState;
  if (input && input.composing >= 0) {
    input.composing = -1;
    input.compositionFirstChange = null;
  }
  const dom = view.contentDOM;
  dom.blur();
  dom.focus({ preventScroll: true });
}

function buildDecorations(view: EditorView, env: ViewEnv): DecorationSet {
  const state = view.state;
  const value = state.field(helixField, false);
  if (!value) return Decoration.none;
  const doc = state.doc;
  const builder: { from: number; to: number; deco: Decoration }[] = [];
  const shape = env.editor.config.cursorShape[value.mode];
  const visible = view.visibleRanges;
  const vFrom = visible.length > 0 ? visible[0]!.from : 0;
  const vTo = visible.length > 0 ? visible[visible.length - 1]!.to : doc.length;
  value.selection.ranges.forEach((range, i) => {
    if (range.to() < vFrom || range.from() > vTo) return;
    const primary = i === value.selection.primaryIndex;
    if (range.to() > range.from()) {
      builder.push({
        from: Math.max(range.from(), vFrom),
        to: Math.min(range.to(), vTo),
        deco: Decoration.mark({ class: primary ? "hx-sel hx-sel-primary" : "hx-sel" }),
      });
    }
    if (value.mode === "insert" && shape === "bar" && primary) return;
    const cursor = range.cursor(doc);
    const cls = `hx-cursor hx-cursor-${shape}${primary ? " hx-cursor-primary" : ""}`;
    const line = doc.lineAt(cursor);
    if (cursor >= doc.length || cursor === line.to) {
      builder.push({ from: cursor, to: cursor, deco: Decoration.widget({ widget: new EolCursor(`${cls} hx-eol`), side: 1 }) });
    } else {
      builder.push({ from: cursor, to: nextGraphemeBoundary(doc, cursor), deco: Decoration.mark({ class: cls }) });
    }
  });
  const labels = env.editor.jumpLabels.get(env.hostFor(view).id) ?? [];
  for (const label of labels) {
    if (label.pos >= doc.length) continue;
    const end = nextGraphemeBoundary(doc, label.pos);
    if (doc.lineAt(label.pos).to === label.pos) continue;
    builder.push({ from: label.pos, to: end, deco: Decoration.replace({ widget: new LabelWidget(label.text) }) });
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

class NumberMarker extends GutterMarker {
  constructor(readonly text: string) {
    super();
  }
  override eq(other: GutterMarker): boolean {
    return other instanceof NumberMarker && other.text === this.text;
  }
  override toDOM(): Node {
    return document.createTextNode(this.text);
  }
}

export const whitespaceCompartment = new Compartment();

function relativeMarkers(state: import("@codemirror/state").EditorState): RangeSet<GutterMarker> {
  const value = state.field(helixField, false);
  if (!value) return RangeSet.empty;
  const doc = state.doc;
  const current = doc.lineAt(value.selection.primary().cursor(doc)).number;
  const builder = new RangeSetBuilder<GutterMarker>();
  for (let n = 1; n <= doc.lines; n++) {
    builder.add(doc.line(n).from, doc.line(n).from, new NumberMarker(n === current ? String(n) : String(Math.abs(n - current))));
  }
  return builder.finish();
}

function relativeField(env: ViewEnv) {
  const compute = (state: import("@codemirror/state").EditorState) =>
    env.editor.config.lineNumber === "relative" ? relativeMarkers(state) : RangeSet.empty;
  const lineOf = (state: import("@codemirror/state").EditorState) => {
    const value = state.field(helixField, false);
    return value ? state.doc.lineAt(value.selection.primary().cursor(state.doc)).number : 0;
  };
  return StateField.define<{ line: number; mode: string; markers: RangeSet<GutterMarker> }>({
    create: (state) => ({ line: lineOf(state), mode: env.editor.config.lineNumber, markers: compute(state) }),
    update(value, tr) {
      const line = lineOf(tr.state);
      const mode = env.editor.config.lineNumber;
      if (!tr.docChanged && line === value.line && mode === value.mode) return value;
      return { line, mode, markers: compute(tr.state) };
    },
    provide: (f) => lineNumberMarkers.from(f, (v) => v.markers),
  });
}

function cursorLineDecorations(view: EditorView, env: ViewEnv): DecorationSet {
  if (!env.editor.config.cursorline) return Decoration.none;
  const value = view.state.field(helixField, false);
  if (!value) return Decoration.none;
  const doc = view.state.doc;
  const lines = new Set<number>();
  for (const r of value.selection.ranges) lines.add(doc.lineAt(r.cursor(doc)).from);
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
    if (mode === "insert" && env.suggestOpen() && !editor.activePrompt) return false;
    const dead = event.key === "Dead";
    if (dead && mode === "insert" && !editor.activePrompt) return false;
    const literal = literalWanted(editor, mode);
    let key = keyFromDom(event, literal);
    if (key === null) return false;
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
        if (!value || value.mode === "insert" || editor.activePrompt) return false;
        endComposition(view);
        return true;
      },
      keydown(event, view) {
        if (event.isComposing || event.keyCode === 229) {
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

  const autoPairsInput = Prec.highest(
    EditorView.inputHandler.of((view, _from, _to, text) => {
      const value = view.state.field(helixField, false);
      if (!value || value.mode !== "insert" || !editor.helixAutoPairs) return false;
      const pairs = editor.config.autoPairs;
      if (!pairs || [...text].length !== 1) return false;
      const map = makeAutoPairs(pairs);
      if (!map.has(text) && !/^\p{White_Space}$/u.test(text)) return false;
      const doc = view.state.doc;
      const touched = value.selection.ranges.some((r) => hookInsert(doc, r, text, map) !== null);
      if (!touched) return false;
      const host = env.hostFor(view);
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
        if (update.docChanged) env.onChanges(update.view, update.changes);
        if (update.docChanged || update.selectionSet || update.viewportChanged || update.transactions.length > 0) {
          this.decorations = buildDecorations(update.view, env);
        }
        if (update.focusChanged && update.view.hasFocus) env.onFocusChange(update.view);
        if (update.transactions.length > 0 || update.focusChanged) env.onRender(update.view);
      }
    },
    { decorations: (v) => v.decorations },
  );

  const gutterNumbers = ViewPlugin.fromClass(
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
    const dom = document.createElement("div");
    dom.className = "hx-panel";
    const info = document.createElement("div");
    info.className = "hx-autoinfo";
    const prompt = document.createElement("div");
    prompt.className = "hx-prompt";
    dom.append(info, prompt);
    const render = () => renderPanel(view, env, info, prompt);
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
    pasteHandler,
    autoPairsInput,
    decorations,
    gutterNumbers,
    relativeField(env),
    attributes,
    scrollMargins,
    panel,
    whitespaceCompartment.of(editor.config.whitespaceRender ? highlightWhitespace() : []),
  ];
}

function renderPanel(view: EditorView, env: ViewEnv, info: HTMLElement, prompt: HTMLElement): void {
  const { editor } = env;
  const host = env.hostFor(view);
  const active = editor.activePrompt && editor.activePrompt.host.id === host.id && view.hasFocus ? editor.activePrompt : null;
  prompt.replaceChildren();
  if (active) {
    prompt.style.display = "";
    const label = document.createElement("span");
    label.className = "hx-prompt-label";
    label.textContent = active.label;
    const before = document.createElement("span");
    before.textContent = active.line.slice(0, active.cursor);
    const cursor = document.createElement("span");
    cursor.className = "hx-prompt-cursor";
    cursor.textContent = active.line.slice(active.cursor, active.cursor + 1) || " ";
    const after = document.createElement("span");
    after.textContent = active.line.slice(active.cursor + 1);
    prompt.append(label, before, cursor, after);
    if (active.completions.length > 0) {
      const list = document.createElement("div");
      list.className = "hx-completions";
      active.completions.slice(0, 40).forEach((c, i) => {
        const item = document.createElement("span");
        item.className = i === active.selection ? "hx-completion hx-completion-selected" : "hx-completion";
        item.textContent = c.label;
        list.append(item);
      });
      prompt.prepend(list);
    }
  } else {
    prompt.style.display = "none";
  }
  info.replaceChildren();
  const auto = editor.config.autoInfo && view.hasFocus ? editor.autoinfo : null;
  if (auto) {
    info.style.display = "";
    const title = document.createElement("div");
    title.className = "hx-autoinfo-title";
    const rows: [string, string][] = [];
    let unavailable = new Set<string>();
    if ("kind" in auto) {
      title.textContent = auto.name;
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
      title.textContent = auto.title;
      rows.push(...auto.body);
    }
    info.append(title);
    for (const [k, d] of rows) {
      const row = document.createElement("div");
      row.className = unavailable.has(d) ? "hx-autoinfo-row hx-autoinfo-unavailable" : "hx-autoinfo-row";
      const ks = document.createElement("span");
      ks.className = "hx-autoinfo-key";
      ks.textContent = k;
      const ds = document.createElement("span");
      ds.textContent = d;
      row.append(ks, ds);
      info.append(row);
    }
  } else {
    info.style.display = "none";
  }
}

function describe(command: import("../keymap/trie").MappableCommand): string {
  if (command.kind === "static") return command.name.replace(/_/g, " ");
  if (command.kind === "typable") return `:${command.raw}`;
  return `@${command.keys}`;
}
