import { EditorState, Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { commitHistoryNow, Context, HeadlessHost, type HelixEditor, helixField, hostHooks, helixOwned, historyField, type Host, type Mode, Range, rangeParts, Selection, setHelix, setMode, setSel, syncNativeSelection, toNative } from "helix-cm6/engine";
import { CellLayers, type PaintCell } from "./cell-paint";

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

export const VERTICAL: Record<string, number> = {
  move_visual_line_down: 1,
  extend_visual_line_down: 1,
  move_line_down: 1,
  extend_line_down: 1,
  move_visual_line_up: -1,
  extend_visual_line_up: -1,
  move_line_up: -1,
  extend_line_up: -1,
};

export const CROSS_RIGHT = /^move_(char_right|next_(long_|sub_)?word_(start|end))$/;
export const CROSS_LEFT = /^move_(char_left|prev_(long_|sub_)?word_(start|end))$/;

function escapePipes(text: string): string {
  return text.replace(/(?<!\\)\|/g, "\\|");
}

function samePlace(a: Place, b: Place): boolean {
  return a.row === b.row && a.col === b.col;
}

function comparePlaces(a: Place, b: Place): number {
  return a.row - b.row || a.col - b.col;
}

export const LINE_MOTIONS = new Set(["goto_line_start", "goto_line_end", "goto_line_end_newline", "goto_first_nonwhitespace", "extend_to_line_start", "extend_to_line_end", "extend_to_line_end_newline", "extend_to_first_nonwhitespace"]);
export const NEXT_KEY_COMMANDS = new Set(["find_till_char", "find_next_char", "till_prev_char", "find_prev_char", "extend_till_char", "extend_next_char", "extend_till_prev_char", "extend_prev_char", "select_textobject_inner", "select_textobject_around"]);
export const SELECTION_COMMANDS = new Set(["match_brackets", "expand_selection", "shrink_selection", "select_next_sibling", "select_prev_sibling", "select_all_children", "select_all_siblings", "move_parent_node_start", "move_parent_node_end", "extend_parent_node_start", "extend_parent_node_end"]);
export const CELL_MOTION = /^(move|extend)_(char_left|char_right|line_up|line_down|visual_line_up|visual_line_down|(prev|next)_(long_|sub_)?word_(start|end))$/;

export function runsOnCellText(name: string): boolean {
  return CELL_MOTION.test(name) || LINE_MOTIONS.has(name) || SELECTION_COMMANDS.has(name);
}

let releaseShadow: ((host: Host) => void) | null = null;

export function setShadowRelease(release: (host: Host) => void): void {
  releaseShadow = release;
}

export const CELL_SHADOW = "cell-shadow";

export function runOnText(helix: HelixEditor, text: string, mode: Mode, range: Range, name: string, count: number | null, register: string | null, key: string | null): Range[] {
  const doc = Text.of(text.split("\n"));
  if (key === "|" && name.startsWith("select_textobject")) return [new Range(0, Math.max(text.length, 1))];
  const local = new Range(Math.max(Math.min(range.anchor, text.length), 0), Math.max(Math.min(range.head, text.length), 0));
  const shadow = new HeadlessHost(text, [helixField, historyField, syncNativeSelection, EditorState.allowMultipleSelections.of(true)], CELL_SHADOW);
  setMode(shadow, mode, new Selection([local], 0).ensureInvariants(doc));
  const inner = new Context(helix, shadow, count, register);
  helix.runStatic(inner, name);
  if (key !== null) inner.onNextKeyCallback?.cb(inner, key);
  releaseShadow?.(shadow);
  return shadow.state.field(helixField).selection.ranges.map((r) => (r.anchor === r.head ? new Range(r.anchor, r.anchor + 1) : r));
}

export function isStuck(text: string, before: Range, after: Range, forward: boolean): boolean {
  const doc = Text.of(text.split("\n"));
  const now = after.cursor(doc);
  return now === before.cursor(doc) || (forward && now >= text.length);
}

export function cellNeighbor(rows: readonly (readonly unknown[])[], place: Place, forward: boolean, words: boolean): Place | null {
  const columns = rows[place.row]?.length ?? 0;
  if (forward) {
    if (place.col < columns - 1) return { row: place.row, col: place.col + 1 };
    return words && place.row < rows.length - 1 ? { row: place.row + 1, col: 0 } : null;
  }
  if (place.col > 0) return { row: place.row, col: place.col - 1 };
  if (!words || place.row === 0) return null;
  return { row: place.row - 1, col: (rows[place.row - 1]?.length ?? 1) - 1 };
}

export class CellCursors {
  private host: HeadlessHost;
  private places: Place[];
  private deferred: (() => void) | null = null;
  private ended = false;
  private readonly layers = new CellLayers(() => this.draw());

  constructor(
    private readonly env: CursorEnv,
    places: readonly Place[],
    ranges: (text: string, place: Place) => readonly Range[],
    enter: string | null,
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

  private build(perLine: readonly (readonly Range[])[], primary: Place, mode: Mode, primaryRange?: Range): HeadlessHost {
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
      const own = [...(perLine[i] ?? [new Range(0, 1)])].sort((a, b) => a.from() - b.from());
      for (const range of own) {
        const anchor = Math.min(range.anchor, text.length);
        const head = Math.min(range.head, text.length);
        if (samePlace(place, primary) && primaryRange && range.eq(primaryRange)) primaryIndex = out.length;
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
    const mode = this.host.state.field(helixField).mode;
    if ((CROSS_RIGHT.test(name) || CROSS_LEFT.test(name)) && mode === "normal") {
      const steps = cx.count();
      const register = cx.register;
      this.deferred = () => {
        for (let i = 0; i < steps; i++) this.step(name, register);
      };
      return true;
    }
    if (NEXT_KEY_COMMANDS.has(name)) {
      cx.onNextKey((inner, key) => this.onOwnText(inner, name, this.env.helix.keyChar(key) ?? key));
      return true;
    }
    if (runsOnCellText(name) || /^(move|extend)_/.test(name)) {
      this.onOwnText(cx, name, null);
      return true;
    }
    return false;
  }

  private onOwnText(cx: Context, name: string, key: string | null): void {
    const doc = this.host.state.doc;
    const value = this.host.state.field(helixField);
    const out: Range[] = [];
    let primary = 0;
    value.selection.ranges.forEach((range, i) => {
      const line = doc.lineAt(Math.min(range.from(), doc.length));
      const local = new Range(range.anchor - line.from, range.head - line.from);
      if (i === value.selection.primaryIndex) primary = out.length;
      for (const next of runOnText(this.env.helix, line.text, value.mode, local, name, cx.countRaw, cx.register, key)) out.push(new Range(next.anchor + line.from, next.head + line.from));
    });
    setSel(cx, new Selection(out, primary));
  }

  private step(name: string, register: string | null): void {
    const doc = this.host.state.doc;
    const before = this.host.state.field(helixField).selection;
    const cx = new Context(this.env.helix, this.host, null, register);
    const forward = CROSS_RIGHT.test(name);
    const words = name.includes("word");
    const perPlace = new Map<string, Range[]>();
    const places: Place[] = [];
    const add = (place: Place, range: Range) => {
      const key = `${place.row}:${place.col}`;
      const own = perPlace.get(key);
      if (own) own.push(range);
      else {
        perPlace.set(key, [range]);
        places.push(place);
      }
    };
    let crossed = false;
    let primary: { place: Place; range: Range } | null = null;
    const stayed: Range[] = [];
    const rows = this.table()?.rows ?? [];
    before.ranges.forEach((range, i) => {
      const line = doc.lineAt(Math.min(range.from(), doc.length));
      const place = this.places[Math.min(line.number - 1, this.places.length - 1)]!;
      const local = new Range(range.anchor - line.from, range.head - line.from);
      const next = runOnText(this.env.helix, line.text, "normal", local, name, null, register, null)[0] ?? local;
      const target = isStuck(line.text, local, next, forward) ? cellNeighbor(rows, place, forward, words) : null;
      let at = place;
      let result = isStuck(line.text, local, next, forward) ? local : next;
      if (target) {
        crossed = true;
        at = target;
        const length = this.cell(target)?.text.length ?? 0;
        result = forward || length === 0 ? new Range(0, 1) : new Range(length - 1, length);
      }
      stayed.push(new Range(result.anchor + line.from, result.head + line.from));
      add(at, result);
      if (i === before.primaryIndex) primary = { place: at, range: result };
    });
    const main = primary as { place: Place; range: Range } | null;
    if (crossed && main) this.rebuild(places, perPlace, main.place, main.range);
    else setSel(cx, new Selection(stayed, before.primaryIndex));
  }

  private rebuild(places: Place[], perPlace: Map<string, Range[]>, primary: Place, primaryRange?: Range): void {
    const key = (place: Place) => `${place.row}:${place.col}`;
    const mode = this.host.state.field(helixField).mode;
    const unique = new Map(places.map((place) => [key(place), place]));
    this.places = [...unique.values()].sort(comparePlaces);
    this.host = this.build(this.places.map((place) => perPlace.get(key(place)) ?? [new Range(0, 1)]), primary, mode, primaryRange);
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
    if (count === 1 && before && !this.env.helix.activePrompt) {
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
    const doc = this.host.state.doc;
    const line = doc.line(index + 1);
    const main = this.host.state.field(helixField).selection.primary();
    const own = this.perLine()[index]!;
    const primary = Math.max(own.findIndex((r) => r.anchor === main.anchor - line.from && r.head === main.head - line.from), 0);
    const ranges = own.map((r) => new Range(Math.min(r.anchor, length), Math.min(r.head, length)));
    if (ranges.length === 0) ranges.push(new Range(0, Math.min(1, length)));
    setMode(host, mode, new Selection(ranges, primary));
  }

  private draw(): void {
    if (this.ended) return;
    const table = this.table();
    const active = this.env.active();
    if (!table || !active) return;
    const doc = this.host.state.doc;
    const value = this.host.state.field(helixField);
    const insert = value.mode === "insert";
    const shape = this.env.helix.config.cursorShape[value.mode];
    const cells: PaintCell[] = [];
    this.places.forEach((place, i) => {
      if (samePlace(place, active.cell)) return;
      const cell = this.cell(place);
      if (!cell) return;
      const line = doc.line(i + 1);
      const ranges: PaintCell["ranges"] = [];
      value.selection.ranges.forEach((range, r) => {
        if (doc.lineAt(Math.min(range.from(), doc.length)).number !== line.number) return;
        const primary = r === value.selection.primaryIndex;
        const part = rangeParts(doc, range, primary, insert, shape);
        ranges.push({ from: part.from - line.from, to: part.to - line.from, pos: part.pos - line.from, end: part.end - line.from, eol: part.eol, primary: false });
      });
      cells.push({ content: cell.contentEl ?? cell.el, source: line.text, ranges });
    });
    this.layers.draw(table.containerEl, cells, shape, insert);
  }

  checkFocus(): void {
    const active = this.env.active();
    const focus = active?.table.containerEl.ownerDocument.activeElement;
    if (!active || !focus || !active.table.containerEl.contains(focus)) this.end();
  }

  count(): number {
    return this.host.state.field(helixField).selection.ranges.length;
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.layers.clear();
    this.env.onEnd();
  }
}
