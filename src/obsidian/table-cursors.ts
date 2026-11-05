import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { commitHistoryNow, Context, HeadlessHost, type HelixEditor, helixField, hostHooks, helixOwned, historyField, type Host, type Mode, Range, selOf, Selection, setHelix, setMode, setSel, syncNativeSelection, toNative } from "helix-cm6/engine";

export interface CursorCell {
  row: number;
  col: number;
  text: string;
  el: HTMLElement;
  contentEl?: HTMLElement;
}

export interface CursorTable {
  rows: CursorCell[][];
  containerEl: HTMLElement;
  editor: { cm: EditorView };
  getCellAt(row: number, col: number): CursorCell | null;
  setCellFocus(row: number, col: number): void;
  updateCell(cell: CursorCell, text: string): unknown;
  dispatchTable(row?: number, col?: number): void;
}

export interface CursorActive {
  table: CursorTable;
  cell: CursorCell;
  editor: { cm: EditorView };
}

export interface CursorEnv {
  helix: HelixEditor;
  active(): CursorActive | null;
  hostFor(view: EditorView): Host;
  onEnd(): void;
  leave(name: string, view: EditorView): void;
}

interface Place {
  row: number;
  col: number;
}

const BLOCKED = new Set(["open_below", "open_above", "join_selections", "join_selections_space", "insert_newline", "insert_tab", "smart_tab", "add_newline_above", "add_newline_below"]);

const LEAVING = new Set([
  "undo", "redo", "earlier", "later", "goto_file_start", "extend_to_file_start", "goto_last_line", "extend_to_last_line", "goto_file_end", "extend_to_file_end", "select_all", "search", "rsearch", "search_next", "search_prev", "extend_search_next", "extend_search_prev", "search_selection", "search_selection_detect_word_boundaries", "jump_backward", "jump_forward", "goto_next_paragraph", "goto_prev_paragraph", "global_search", "extend_line", "extend_line_below", "extend_line_above", "select_line_below", "select_line_above", "page_up", "page_down", "half_page_up", "half_page_down", "page_cursor_up", "page_cursor_down", "page_cursor_half_up", "page_cursor_half_down", "scroll_up", "scroll_down", "align_view_top", "align_view_center", "align_view_bottom", "goto_window_top", "goto_window_center", "goto_window_bottom", "goto_word", "extend_to_word", "command_mode",
]);

const VERTICAL: Record<string, number> = {
  move_visual_line_down: 1,
  extend_visual_line_down: 1,
  move_line_down: 1,
  extend_line_down: 1,
  move_visual_line_up: -1,
  extend_visual_line_up: -1,
  move_line_up: -1,
  extend_line_up: -1,
};

function escapePipes(text: string): string {
  return text.replace(/(?<!\\)\|/g, "\\|");
}

function samePlace(a: Place, b: Place): boolean {
  return a.row === b.row && a.col === b.col;
}

function comparePlaces(a: Place, b: Place): number {
  return a.row - b.row || a.col - b.col;
}

function keepInLine(range: Range, line: { from: number; to: number }, original: Range): Range {
  if ((range.from() >= line.to && range.to() > line.to) || range.to() <= line.from - 1) return original;
  const clamp = (pos: number) => Math.max(line.from, Math.min(pos, line.to));
  const anchor = clamp(range.anchor);
  const head = clamp(range.head);
  if (anchor !== head) return new Range(anchor, head);
  const from = line.to > line.from ? Math.min(anchor, line.to - 1) : line.from;
  return new Range(from, from + 1);
}

export class CellCursors {
  private host: HeadlessHost;
  private places: Place[];
  private deferred: (() => void) | null = null;
  private ended = false;
  private movingOne = false;

  constructor(
    private readonly env: CursorEnv,
    places: readonly Place[],
    ranges: (text: string, place: Place) => readonly Range[],
    enter: "insert_mode" | "append_mode" | null,
  ) {
    const active = env.active();
    const focus: Place = active ? { row: active.cell.row, col: active.cell.col } : places[0]!;
    this.places = [...places].sort(comparePlaces);
    const mode = active ? env.hostFor(active.editor.cm).state.field(helixField).mode : "normal";
    this.host = this.build(this.places.map((place) => ranges(this.cell(place)?.text ?? "", place)), focus, mode);
    if (enter) this.run(enter);
    this.afterKey(null);
  }

  private table(): CursorTable | null {
    return this.env.active()?.table ?? null;
  }

  private cell(place: Place): CursorCell | null {
    return this.table()?.getCellAt(place.row, place.col) ?? null;
  }

  private build(perLine: readonly (readonly Range[])[], primary: Place, mode: Mode): HeadlessHost {
    const texts = this.places.map((place) => this.cell(place)?.text ?? "");
    const doc = texts.join("\n");
    const active = this.env.active();
    const id = active ? this.env.hostFor(active.editor.cm).id : "cells";
    const host = new HeadlessHost(
      "\n",
      [
        helixField,
        historyField,
        syncNativeSelection,
        EditorState.allowMultipleSelections.of(true),
        hostHooks.of({
          command: (name, cx) => this.command(name, cx),
          textObject: (kind, ch, cx) => this.textObject(kind, ch, cx),
        }),
      ],
      id,
    );
    let start = 0;
    const out: Range[] = [];
    let primaryIndex = 0;
    this.places.forEach((place, i) => {
      const text = texts[i]!;
      if (samePlace(place, primary)) primaryIndex = out.length;
      for (const range of perLine[i] ?? [new Range(0, 1)]) {
        const anchor = Math.min(range.anchor, text.length);
        const head = Math.min(range.head, text.length);
        out.push(anchor === head ? new Range(start + anchor, start + anchor + 1) : new Range(start + anchor, start + head));
      }
      start += text.length + 1;
    });
    const selection = new Selection(out, primaryIndex);
    const value = host.state.field(helixField);
    const next = { ...value, selection, mode };
    host.dispatch({
      changes: { from: 0, to: 1, insert: `${doc}\n` },
      effects: setHelix.of(next),
      annotations: helixOwned.of(true),
    });
    host.dispatch({ selection: toNative(next, host.state.doc), effects: setHelix.of(next), annotations: helixOwned.of(true) });
    commitHistoryNow(host);
    return host;
  }

  private run(name: string): void {
    this.env.helix.runStatic(new Context(this.env.helix, this.host, null, null), name);
  }

  private lineCount(): number {
    return this.host.state.doc.lines - 1;
  }

  private perLine(): Range[][] {
    const doc = this.host.state.doc;
    const out: Range[][] = this.places.map(() => []);
    for (const range of this.host.state.field(helixField).selection.ranges) {
      const line = doc.lineAt(Math.min(range.from(), doc.length));
      out[Math.min(line.number - 1, out.length - 1)]!.push(new Range(range.anchor - line.from, range.head - line.from));
    }
    return out;
  }

  private primaryPlace(): Place {
    const doc = this.host.state.doc;
    const primary = this.host.state.field(helixField).selection.primary();
    return this.places[Math.min(doc.lineAt(Math.min(primary.from(), doc.length)).number - 1, this.places.length - 1)]!;
  }

  private command(name: string, cx: Context): boolean {
    if (BLOCKED.has(name)) return true;
    if (name in VERTICAL) {
      const delta = VERTICAL[name]! * cx.count();
      this.deferred = () => this.moveRows(delta);
      return true;
    }
    if (name === "copy_selection_on_next_line" || name === "copy_selection_on_prev_line") {
      const delta = (name === "copy_selection_on_next_line" ? 1 : -1) * cx.count();
      this.deferred = () => this.copyRows(delta);
      return true;
    }
    if (LEAVING.has(name)) {
      this.deferred = () => {
        this.end();
        const active = this.env.active();
        if (active) this.env.leave(name, active.editor.cm);
      };
      return true;
    }
    if (/^(move|extend)_/.test(name) && !this.movingOne) {
      this.moveEach(name, cx);
      return true;
    }
    return false;
  }

  private moveEach(name: string, cx: Context): void {
    const doc = cx.host.state.doc;
    const before = this.host.state.field(helixField).selection;
    this.movingOne = true;
    const moved = before.ranges.map((range) => {
      const line = doc.lineAt(Math.min(range.from(), doc.length));
      setSel(cx, new Selection([range], 0));
      this.env.helix.runStatic(new Context(this.env.helix, this.host, cx.countRaw, cx.register), name);
      return keepInLine(this.host.state.field(helixField).selection.primary(), line, range);
    });
    this.movingOne = false;
    setSel(cx, new Selection(moved, before.primaryIndex));
  }

  private textObject(_kind: "inside" | "around", ch: string, cx: Context): boolean {
    if (ch !== "|") return false;
    const doc = cx.host.state.doc;
    const ranges: Range[] = [];
    for (let n = 1; n <= this.places.length; n++) {
      const line = doc.line(n);
      ranges.push(new Range(line.from, Math.max(line.to, line.from + 1)));
    }
    setSel(cx, new Selection(ranges, Math.min(doc.lineAt(selOf(cx).primary().from()).number - 1, ranges.length - 1)));
    return true;
  }

  private rebuild(places: Place[], perPlace: Map<string, Range[]>, primary: Place): void {
    const key = (place: Place) => `${place.row}:${place.col}`;
    const mode = this.host.state.field(helixField).mode;
    const unique = new Map(places.map((place) => [key(place), place]));
    this.places = [...unique.values()].sort(comparePlaces);
    this.host = this.build(this.places.map((place) => perPlace.get(key(place)) ?? [new Range(0, 1)]), primary, mode);
  }

  private moveRows(delta: number): void {
    const table = this.table();
    if (!table) return;
    const lines = this.perLine();
    const clamp = (place: Place) => ({ row: Math.max(0, Math.min(table.rows.length - 1, place.row + delta)), col: place.col });
    const perPlace = new Map<string, Range[]>();
    this.places.forEach((place, i) => {
      const next = clamp(place);
      perPlace.set(`${next.row}:${next.col}`, lines[i]!);
    });
    const primary = clamp(this.primaryPlace());
    this.rebuild(this.places.map(clamp), perPlace, primary);
  }

  private copyRows(delta: number): void {
    const table = this.table();
    if (!table) return;
    const lines = this.perLine();
    const places = [...this.places];
    const perPlace = new Map<string, Range[]>();
    this.places.forEach((place, i) => perPlace.set(`${place.row}:${place.col}`, lines[i]!));
    this.places.forEach((place, i) => {
      const row = place.row + delta;
      if (row < 0 || row >= table.rows.length) return;
      const next = { row, col: place.col };
      if (!perPlace.has(`${row}:${place.col}`)) {
        places.push(next);
        perPlace.set(`${row}:${place.col}`, lines[i]!);
      }
    });
    this.rebuild(places, perPlace, this.primaryPlace());
  }

  handleKey(key: string, from: Host): boolean {
    if (from === this.host) return false;
    const active = this.env.active();
    if (!active || active.editor.cm !== from.view) {
      this.end();
      return false;
    }
    const editor = this.env.helix;
    const recording = editor.macroRecording;
    editor.macroRecording = null;
    const before = this.host.state;
    editor.handleKey(this.host, key);
    editor.macroRecording = recording;
    this.afterKey(before);
    return true;
  }

  private clampRanges(): void {
    const doc = this.host.state.doc;
    const cx = new Context(this.env.helix, this.host, null, null);
    const mode = this.host.state.field(helixField).mode;
    if (mode === "insert") return;
    const sel = this.host.state.field(helixField).selection;
    const ranges = sel.ranges.map((range) => {
      const line = doc.lineAt(Math.min(range.from(), doc.length));
      const from = Math.min(range.from(), Math.max(line.to - 1, line.from));
      const to = Math.max(Math.min(range.to(), line.to), from + 1);
      return range.anchor <= range.head ? new Range(from, to) : new Range(to, from);
    });
    if (ranges.some((range, i) => !range.eq(sel.ranges[i]!))) setSel(cx, new Selection(ranges, sel.primaryIndex));
  }

  private afterKey(before: EditorState | null): void {
    if (this.deferred) {
      const work = this.deferred;
      this.deferred = null;
      work();
      if (this.ended) return;
    }
    if (before && this.lineCount() !== this.places.length) {
      this.host.state = before;
      this.env.helix.setStatus("that would change the table's rows");
    }
    this.clampRanges();
    const mode = this.host.state.field(helixField).mode;
    let dirty = false;
    const doc = this.host.state.doc;
    this.places.forEach((place, i) => {
      const cell = this.cell(place);
      const text = escapePipes(doc.line(i + 1).text);
      if (cell && cell.text !== text) {
        this.table()!.updateCell(cell, text);
        dirty = true;
      }
    });
    const primary = this.primaryPlace();
    const table = this.table();
    if (dirty && table) table.dispatchTable(primary.row, primary.col);
    else if (table) {
      const active = this.env.active();
      if (active && !samePlace(active.cell, primary)) table.setCellFocus(primary.row, primary.col);
    }
    const count = this.host.state.field(helixField).selection.ranges.length;
    if (mode !== "insert") {
      const main = this.table()?.editor.cm;
      if (main) commitHistoryNow(this.env.hostFor(main));
    }
    this.syncPrimary(mode);
    if (count === 1 && before) {
      this.end();
      return;
    }
    this.draw();
    this.env.helix.ui.render?.(this.env.active() ? this.env.hostFor(this.env.active()!.editor.cm) : this.host);
  }

  private syncPrimary(mode: Mode): void {
    const active = this.env.active();
    if (!active) return;
    const host = this.env.hostFor(active.editor.cm);
    const index = this.places.findIndex((place) => samePlace(place, active.cell));
    if (index < 0) return;
    const length = host.state.doc.length;
    const ranges = this.perLine()[index]!.map((r) => {
      const anchor = Math.min(r.anchor, length);
      const head = Math.min(r.head, length);
      return new Range(anchor, head);
    });
    if (ranges.length === 0) ranges.push(new Range(0, Math.min(1, length)));
    setMode(host, mode, new Selection(ranges, 0));
  }

  private draw(): void {
    const table = this.table();
    const active = this.env.active();
    if (!table || !active) return;
    const root = table.containerEl;
    root.querySelector(":scope > .hx-cell-cursors")?.remove();
    const box = root.createDiv("hx-cell-cursors");
    const rootRect = root.getBoundingClientRect();
    const mode = this.host.state.field(helixField).mode;
    const lines = this.perLine();
    this.places.forEach((place, i) => {
      if (samePlace(place, active.cell)) return;
      const cell = this.cell(place);
      if (!cell) return;
      for (const range of lines[i]!) this.drawRange(box, rootRect, root, cell, range, mode);
    });
  }

  private drawRange(box: HTMLElement, rootRect: DOMRect, root: HTMLElement, cell: CursorCell, range: Range, mode: Mode): void {
    const content = cell.contentEl ?? cell.el;
    const rendered = content.textContent ?? "";
    const scale = rendered === cell.text ? 1 : 0;
    const place = (rect: DOMRect | { left: number; top: number; width: number; height: number }, cls: string) => {
      const part = box.createDiv(cls);
      part.setCssProps({
        "--hx-part-left": `${rect.left - rootRect.left + root.scrollLeft}px`,
        "--hx-part-top": `${rect.top - rootRect.top + root.scrollTop}px`,
        "--hx-part-width": `${rect.width}px`,
        "--hx-part-height": `${rect.height}px`,
      });
    };
    const domRange = content.ownerDocument.createRange();
    const point = (offset: number): [Node, number] | null => {
      const walker = content.ownerDocument.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      let left = offset;
      let last: Text | null = null;
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        last = node;
        if (left <= node.length) return [node, left];
        left -= node.length;
      }
      return last ? [last, last.length] : null;
    };
    const from = Math.min(range.from(), rendered.length);
    const to = Math.min(range.to(), rendered.length);
    const start = point(from);
    const end = point(to);
    const fallback = content.getBoundingClientRect();
    if (start && end && to > from && (scale === 1 || to - from > 0)) {
      domRange.setStart(start[0], start[1]);
      domRange.setEnd(end[0], end[1]);
      for (const rect of Array.from(domRange.getClientRects())) place(rect, "hx-cell-part hx-cell-part-range");
    }
    const headAt = Math.max(Math.min(range.head === range.to() ? to - 1 : from, rendered.length - 1), 0);
    const headStart = point(headAt);
    const headEnd = point(Math.min(headAt + 1, rendered.length));
    let headRect: DOMRect | { left: number; top: number; width: number; height: number } | null = null;
    if (headStart && headEnd && rendered.length > 0) {
      domRange.setStart(headStart[0], headStart[1]);
      domRange.setEnd(headEnd[0], headEnd[1]);
      headRect = domRange.getBoundingClientRect();
    }
    const rect = headRect && headRect.width > 0 ? headRect : { left: fallback.left, top: fallback.top, width: 8, height: fallback.height };
    place(mode === "insert" ? { left: rect.left, top: rect.top, width: 2, height: rect.height } : rect, "hx-cell-part hx-cell-part-head");
  }

  count(): number {
    return this.host.state.field(helixField).selection.ranges.length;
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const el of Array.from(this.table()?.containerEl.querySelectorAll(":scope > .hx-cell-cursors") ?? [])) el.remove();
    this.env.onEnd();
  }
}
