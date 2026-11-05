import { editorLivePreviewField, MarkdownView, type App } from "obsidian";
import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { commitHistoryNow, Context, type HelixEdge, type HelixEditor, helixField, helixHooks, type Host, type MotionRange, pasteImpl, pushJump, Range, Selection, selOf, setSel } from "helix-cm6/engine";
import { whileMovingToCell } from "./selection-snap";
import { CellCursors, type CursorEnv } from "./table-cursors";

let tableCursors: CellCursors | null = null;
let walking = false;

interface TableCell {
  row: number;
  col: number;
  text: string;
  el: HTMLElement;
  contentEl?: HTMLElement;
  getAbsoluteOffsets(): { textStart: number; textEnd: number };
}

interface TableWidget {
  start: number;
  end: number;
  rows: TableCell[][];
  alignments: unknown[];
  selectedCells: TableCell[];
  selectionAnchor: TableCell | null;
  selectionHead: TableCell | null;
  editor: { cm: EditorView };
  containerEl: HTMLElement;
  getCellAt(row: number, col: number): TableCell | null;
  setCellFocus(row: number, col: number, selection?: (cm: EditorView) => EditorSelection): unknown;
  placeCursorAround(where: "before" | "after"): void;
  placeCursorInCell(cell: TableCell, where: "start" | "end" | "last-line"): void;
  selectCells(anchor: TableCell, head: TableCell): void;
  deselectCells(): void;
  rerenderCell?(cell: TableCell): void;
  deleteSelection(direction: number): void;
  insertRow(row: number, col: number, copy: boolean): void;
  insertColumn(row: number, col: number, alignment: unknown, copy: boolean): void;
  updateCell(cell: TableCell, text: string): unknown;
  dispatchTable(row?: number, col?: number): void;
  getTableString(bounds: { minRow: number; maxRow: number; minCol: number; maxCol: number }): string;
  getSelectionBounds(): { minRow: number; maxRow: number; minCol: number; maxCol: number } | null;
  pasteSelection(event: { clipboardData: { getData(type: string): string } }): boolean;
}

interface ActiveCell {
  table: TableWidget;
  cell: TableCell;
  editor: { cm: EditorView };
}

interface EditorComponent {
  tableCell?: ActiveCell | null;
  activeCM?: EditorView;
}

interface MetadataEditor {
  properties: unknown[];
  focus(options: { bottom: boolean }): boolean;
}

export interface HookPlugin {
  app: App;
  helix: HelixEditor;
  hostForView(view: EditorView): Host;
  isConfigView(view: EditorView | null): boolean;
}

const DOCUMENT_COMMANDS = new Set([
  "goto_last_line",
  "goto_file_end",
  "search",
  "rsearch",
  "search_next",
  "search_prev",
  "extend_search_next",
  "extend_search_prev",
  "search_selection",
  "search_selection_detect_word_boundaries",
  "select_all",
  "jump_backward",
  "jump_forward",
  "goto_next_paragraph",
  "goto_prev_paragraph",
  "global_search",
]);

const HISTORY_COMMANDS = new Set(["undo", "redo", "earlier", "later"]);

const PROMPT_COMMANDS = new Set(["search", "rsearch", "global_search"]);

function activeView(app: App): MarkdownView | null {
  return app.workspace.getActiveViewOfType(MarkdownView);
}

function componentOf(md: MarkdownView): EditorComponent {
  return (md.editor as unknown as { editorComponent: EditorComponent }).editorComponent;
}

function metadataOf(md: MarkdownView): MetadataEditor | null {
  return (md as unknown as { metadataEditor?: MetadataEditor }).metadataEditor ?? null;
}

function isLivePreview(view: EditorView): boolean {
  return view.state.field(editorLivePreviewField, false) === true;
}

function frontmatterEnd(view: EditorView): number | null {
  const doc = view.state.doc;
  if (doc.lines < 2 || doc.line(1).text !== "---") return null;
  for (let n = 2; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (line.text === "---" || line.text === "...") return Math.min(line.to + 1, doc.length);
  }
  return null;
}

function propertiesHidden(plugin: HookPlugin, view: EditorView): boolean {
  if (!isLivePreview(view)) return false;
  const mode = (plugin.app.vault as unknown as { getConfig(key: string): unknown }).getConfig("propertiesInDocument");
  return mode !== "source";
}

function tableWidgets(view: EditorView): TableWidget[] {
  const out: TableWidget[] = [];
  for (const el of Array.from(view.contentDOM.querySelectorAll(".cm-table-widget"))) {
    const tile = (el as unknown as { cmTile?: { widget?: TableWidget }; cmView?: { widget?: TableWidget } }).cmTile ?? (el as unknown as { cmView?: { widget?: TableWidget } }).cmView;
    if (tile?.widget?.rows) out.push(tile.widget);
  }
  return out;
}

function embedRanges(view: EditorView): MotionRange[] {
  const out: MotionRange[] = [];
  for (const el of Array.from(view.contentDOM.children)) {
    if (el.classList.contains("cm-table-widget") || !(el.classList.contains("cm-embed-block") || el.classList.contains("internal-embed"))) continue;
    const length = (el as unknown as { cmTile?: { length?: number } }).cmTile?.length;
    if (length === undefined) continue;
    const from = view.posAtDOM(el);
    if (length > 0) out.push({ from, to: Math.min(from + length, view.state.doc.length), kind: "row" });
  }
  return out;
}

function activeCell(plugin: HookPlugin, host: Host): ActiveCell | null {
  const view = host.view;
  const md = activeView(plugin.app);
  if (!view || !md) return null;
  const cell = componentOf(md).tableCell;
  return cell && cell.editor.cm === view ? cell : null;
}

function clampedOffset(cm: EditorView, column: number): EditorSelection {
  const doc = cm.state.doc;
  const at = Math.min(column, Math.max(doc.length - 1, 0));
  return EditorSelection.single(at);
}

function moveToCell(table: TableWidget, row: number, col: number, offset: number | "start" | "last"): void {
  whileMovingToCell(() =>
    table.setCellFocus(row, col, (cm) => {
      if (offset === "start") return EditorSelection.single(0);
      if (offset === "last") return clampedOffset(cm, cm.state.doc.length);
      return clampedOffset(cm, offset);
    }),
  );
}

function selectionCursor(table: TableWidget): { row: number; col: number } | null {
  const head = table.selectionHead;
  return head ? { row: head.row, col: head.col } : null;
}

function selectRect(table: TableWidget, anchor: TableCell, head: TableCell): void {
  table.selectCells(anchor.row === head.row && anchor.col === head.col ? (Object.create(head) as TableCell) : anchor, head);
}

function moveSelectionHead(table: TableWidget, rowDelta: number, colDelta: number, extend: boolean): void {
  const anchor = table.selectionAnchor;
  const head = table.selectionHead;
  if (!anchor || !head) return;
  const row = Math.max(0, Math.min(table.rows.length - 1, head.row + rowDelta));
  const col = Math.max(0, Math.min(table.alignments.length - 1, head.col + colDelta));
  const next = table.getCellAt(row, Math.min(col, table.rows[row]!.length - 1));
  if (next) selectRect(table, extend ? anchor : next, next);
}

function selectRows(table: TableWidget, fromRow: number, toRow: number): void {
  const first = table.rows[fromRow]!;
  const last = table.rows[toRow]!;
  selectRect(table, first[0]!, last[last.length - 1]!);
}

function selectWholeTable(table: TableWidget): void {
  selectRows(table, 0, table.rows.length - 1);
}

function cellsIn(table: TableWidget): TableCell[] {
  const bounds = table.getSelectionBounds();
  if (!bounds) return [];
  const out: TableCell[] = [];
  for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      const cell = table.getCellAt(row, col);
      if (cell) out.push(cell);
    }
  }
  return out;
}

function parseTable(text: string): { rows: string[][]; alignment: string[] } | null {
  const lines = text.replace(/\n+$/, "").split("\n");
  if (!lines.every((line) => /^\s*\|.*\|\s*$/.test(line))) return null;
  const cells = (line: string) => line.trim().slice(1, -1).split(/(?<!\\)\|/).map((cell) => cell.trim());
  const rows = lines.filter((line) => !/^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(line)).map(cells);
  if (rows.length === 0) return null;
  return { rows, alignment: rows[0]!.map(() => "left") };
}

const LEFT_MOTIONS = new Set(["char_left", "prev_word_start", "prev_word_end", "prev_long_word_start", "prev_long_word_end", "prev_sub_word_start", "prev_sub_word_end"]);
const RIGHT_MOTIONS = new Set(["char_right", "next_word_start", "next_word_end", "next_long_word_start", "next_long_word_end", "next_sub_word_start", "next_sub_word_end"]);
const UP_MOTIONS = new Set(["visual_line_up", "line_up"]);
const DOWN_MOTIONS = new Set(["visual_line_down", "line_down"]);
const WORD_MOTIONS = new Set([...LEFT_MOTIONS, ...RIGHT_MOTIONS].filter((m) => m.includes("word")));

function cellSelectionCommand(plugin: HookPlugin, name: string, cx: Context, active: ActiveCell): boolean {
  const { table } = active;
  const count = cx.count();
  const motion = /^(move|extend)_(.+)$/.exec(name);
  if (motion) {
    const extend = motion[1] === "extend";
    if (LEFT_MOTIONS.has(motion[2]!)) return moveSelectionHead(table, 0, -count, extend), true;
    if (RIGHT_MOTIONS.has(motion[2]!)) return moveSelectionHead(table, 0, count, extend), true;
    if (UP_MOTIONS.has(motion[2]!)) return moveSelectionHead(table, -count, 0, extend), true;
    if (DOWN_MOTIONS.has(motion[2]!)) return moveSelectionHead(table, count, 0, extend), true;
  }
  const bounds = table.getSelectionBounds();
  switch (name) {
    case "extend_to_file_start":
      moveSelectionHead(table, -table.rows.length, 0, true);
      return true;
    case "extend_to_last_line":
    case "extend_to_file_end":
      moveSelectionHead(table, table.rows.length, 0, true);
      return true;
    case "goto_line_start":
    case "goto_first_nonwhitespace":
      moveSelectionHead(table, 0, -table.alignments.length, false);
      return true;
    case "extend_to_line_start":
    case "extend_to_first_nonwhitespace":
      moveSelectionHead(table, 0, -table.alignments.length, true);
      return true;
    case "goto_line_end":
      moveSelectionHead(table, 0, table.alignments.length, false);
      return true;
    case "extend_to_line_end":
      moveSelectionHead(table, 0, table.alignments.length, true);
      return true;
    case "extend_line":
    case "extend_line_below":
    case "select_line_below":
      if (!bounds) return true;
      if (bounds.minCol === 0 && bounds.maxCol === table.alignments.length - 1) selectRows(table, bounds.minRow, Math.min(bounds.maxRow + count, table.rows.length - 1));
      else selectRows(table, bounds.minRow, bounds.maxRow);
      return true;
    case "extend_line_above":
    case "select_line_above":
      if (!bounds) return true;
      if (bounds.minCol === 0 && bounds.maxCol === table.alignments.length - 1) selectRows(table, Math.max(bounds.minRow - count, 0), bounds.maxRow);
      else selectRows(table, bounds.minRow, bounds.maxRow);
      return true;
    case "copy_selection_on_next_line":
      moveSelectionHead(table, count, 0, true);
      return true;
    case "copy_selection_on_prev_line":
      moveSelectionHead(table, -count, 0, true);
      return true;
    case "exit_select_mode":
      return false;
    case "collapse_selection":
    case "keep_primary_selection":
    case "normal_mode": {
      const at = selectionCursor(table);
      table.deselectCells();
      if (at) moveToCell(table, at.row, at.col, "last");
      return true;
    }
    case "delete_selection":
    case "delete_selection_noyank":
      if (name === "delete_selection") yankCells(plugin, cx, table);
      table.deleteSelection(1);
      return true;
    case "change_selection":
    case "change_selection_noyank": {
      if (name === "change_selection") yankCells(plugin, cx, table);
      const cells = cellsIn(table);
      for (const cell of cells) table.updateCell(cell, "");
      const first = cells[0];
      table.deselectCells();
      if (!first) return true;
      table.dispatchTable(first.row, first.col);
      startCursorsLater(plugin, table, cells, "insert_mode");
      return true;
    }
    case "yank":
      yankCells(plugin, cx, table);
      return true;
    case "paste_before":
    case "paste_after":
    case "replace_selections_with_clipboard":
    case "replace_with_yanked":
    case "paste_clipboard_before":
    case "paste_clipboard_after":
      pasteCells(plugin, cx, active);
      return true;
    case "replace":
      cx.onNextKey((inner, key) => {
        const ch = inner.editor.keyChar(key);
        if (ch !== null) perCell(table, (text) => [...text].map(() => ch).join(""));
      });
      return true;
    case "switch_case":
      perCell(table, (text) => [...text].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join(""));
      return true;
    case "switch_to_lowercase":
      perCell(table, (text) => text.toLowerCase());
      return true;
    case "switch_to_uppercase":
      perCell(table, (text) => text.toUpperCase());
      return true;
    case "insert_mode":
    case "append_mode": {
      const cells = cellsIn(table);
      const first = cells[0];
      table.deselectCells();
      if (first) moveToCell(table, first.row, first.col, name === "insert_mode" ? "start" : "last");
      startCursorsLater(plugin, table, cells, name);
      return true;
    }
    default:
      return false;
  }
}

function yankCells(plugin: HookPlugin, cx: Context, table: TableWidget): void {
  const bounds = table.getSelectionBounds();
  if (!bounds) return;
  const register = cx.register ?? plugin.helix.config.defaultYankRegister;
  plugin.helix.registers.write(register, [table.getTableString(bounds)]);
  plugin.helix.setStatus(`yanked cells to register ${register}`);
}

function pasteCells(plugin: HookPlugin, cx: Context, active: ActiveCell): void {
  const { table } = active;
  const register = cx.register ?? plugin.helix.config.defaultYankRegister;
  const values = plugin.helix.registers.read(register, plugin.helix.registerEnv(cx.host));
  const text = values?.join("\n") ?? "";
  if (!text) return;
  const parsed = parseTable(text);
  if (parsed) {
    table.pasteSelection({ clipboardData: { getData: (type) => (type === "obsidian/table" ? JSON.stringify(parsed) : "") } });
    table.deselectCells();
    return;
  }
  const anchor = table.selectionAnchor ?? active.cell;
  table.deselectCells();
  table.updateCell(anchor, text.replace(/\n+$/, "").replace(/\n/g, "<br>"));
  table.dispatchTable(anchor.row, anchor.col);
}

function perCell(table: TableWidget, transform: (text: string) => string): void {
  const head = table.selectionHead;
  for (const cell of table.selectedCells) table.updateCell(cell, transform(cell.text));
  table.dispatchTable(head?.row, head?.col);
}

function enterInsertLater(plugin: HookPlugin, table: TableWidget, command = "insert_mode"): void {
  window.setTimeout(() => {
    const md = activeView(plugin.app);
    const cm = md ? componentOf(md).tableCell?.editor.cm : table.editor.cm;
    if (cm) plugin.helix.runStatic(new Context(plugin.helix, plugin.hostForView(cm), null, null), command);
  }, 0);
}

function startCursorsLater(plugin: HookPlugin, table: TableWidget, cells: readonly TableCell[], command: "insert_mode" | "append_mode"): void {
  const places = cells.map((cell) => ({ row: cell.row, col: cell.col }));
  window.setTimeout(() => {
    const md = activeView(plugin.app);
    const active = md ? componentOf(md).tableCell : null;
    if (!active) return;
    if (places.length < 2) {
      plugin.helix.runStatic(new Context(plugin.helix, plugin.hostForView(active.editor.cm), null, null), command);
      return;
    }
    tableCursors = new CellCursors(cursorEnv(plugin), places, (text) => [command === "insert_mode" ? new Range(0, Math.min(1, text.length)) : new Range(Math.max(text.length - 1, 0), text.length)], command);
  }, 0);
}

function cursorEnv(plugin: HookPlugin): CursorEnv {
  return {
    helix: plugin.helix,
    active: () => {
      const md = activeView(plugin.app);
      return md ? (componentOf(md).tableCell ?? null) : null;
    },
    hostFor: (view) => plugin.hostForView(view),
    onEnd: () => {
      tableCursors = null;
    },
    leave: (name, cx) => plugin.helix.runStatic(new Context(plugin.helix, plugin.hostForView(cx), null, null), name),
  };
}

function runInMain(plugin: HookPlugin, name: string, cx: Context, active: ActiveCell): void {
  const { table } = active;
  const main = table.editor.cm;
  const host = plugin.hostForView(main);
  const inner = new Context(plugin.helix, host, cx.countRaw, cx.register);
  if (PROMPT_COMMANDS.has(name)) main.focus();
  plugin.helix.runStatic(inner, name);
  for (const callback of inner.callbacks) callback();
  const head = main.state.selection.main.head;
  if (head < table.start || head > table.end) main.focus();
  plugin.helix.ui.render?.(host);
}

function walkWords(plugin: HookPlugin, name: string, cx: Context, active: ActiveCell): boolean {
  const motion = /^(move|extend)_(.+)$/.exec(name);
  if (!motion || !WORD_MOTIONS.has(motion[2]!) || walking) return false;
  const { table, cell } = active;
  const doc = cx.host.state.doc;
  const before = selOf(cx);
  const forward = RIGHT_MOTIONS.has(motion[2]!);
  const atEdge = forward ? before.primary().to() >= doc.length : before.primary().cursor(doc) === 0;
  if (!atEdge) {
    walking = true;
    plugin.helix.runStatic(cx, name);
    walking = false;
    if (selOf(cx).primary().cursor(doc) !== before.primary().cursor(doc)) return true;
    setSel(cx, before);
  }
  if (motion[1] === "extend") {
    selectRect(table, cell, cell);
    return true;
  }
  const row = table.rows[cell.row]!;
  if (forward) {
    if (cell.col < row.length - 1) moveToCell(table, cell.row, cell.col + 1, "start");
    else if (cell.row < table.rows.length - 1) moveToCell(table, cell.row + 1, 0, "start");
    else leaveTable(plugin, table, "down", 1);
  } else if (cell.col > 0) moveToCell(table, cell.row, cell.col - 1, "last");
  else if (cell.row > 0) moveToCell(table, cell.row - 1, table.rows[cell.row - 1]!.length - 1, "last");
  else leaveTable(plugin, table, "up", 1);
  return true;
}

function copyToRow(plugin: HookPlugin, cx: Context, active: ActiveCell, direction: 1 | -1): boolean {
  const { table, cell } = active;
  const target = cell.row + direction * cx.count();
  if (target < 0 || target >= table.rows.length) return true;
  const ranges = selOf(cx).ranges;
  tableCursors = new CellCursors(
    cursorEnv(plugin),
    [{ row: cell.row, col: cell.col }, { row: target, col: cell.col }],
    (text) => ranges.map((r) => new Range(Math.min(r.anchor, text.length), Math.min(r.head, text.length))),
    null,
  );
  return true;
}

function cellCommand(plugin: HookPlugin, name: string, cx: Context, active: ActiveCell): boolean {
  const { table, cell } = active;
  if (table.selectedCells.length > 0) {
    if (cellSelectionCommand(plugin, name, cx, active)) return true;
    if (DOCUMENT_COMMANDS.has(name) || name === "goto_file_start" || name === "open_below" || name === "open_above") table.deselectCells();
  } else if (walkWords(plugin, name, cx, active)) return true;
  if (HISTORY_COMMANDS.has(name)) {
    commitHistoryNow(cx.host);
    const main = plugin.hostForView(table.editor.cm);
    commitHistoryNow(main);
    plugin.helix.runStatic(new Context(plugin.helix, main, cx.countRaw, cx.register), name);
    return true;
  }
  if (DOCUMENT_COMMANDS.has(name)) {
    runInMain(plugin, name, cx, active);
    return true;
  }
  switch (name) {
    case "goto_file_start":
      runInMain(plugin, name, cx, active);
      return true;
    case "extend_line":
    case "extend_line_below":
    case "select_line_below":
    case "extend_line_above":
    case "select_line_above":
      selectRows(table, cell.row, cell.row);
      return true;
    case "copy_selection_on_next_line":
      return copyToRow(plugin, cx, active, 1);
    case "copy_selection_on_prev_line":
      return copyToRow(plugin, cx, active, -1);
    case "open_below":
      table.insertRow(cell.row + 1, cell.col, false);
      enterInsertLater(plugin, table);
      return true;
    case "open_above":
      table.insertRow(cell.row, cell.col, false);
      enterInsertLater(plugin, table);
      return true;
    case "join_selections":
    case "join_selections_space":
      return true;
    case "normal_mode":
      return cx.host.state.field(helixField).mode === "normal";
    case "paste_before":
    case "paste_after":
    case "paste_clipboard_before":
    case "paste_clipboard_after": {
      const clipboard = name.startsWith("paste_clipboard");
      const register = clipboard ? "+" : (cx.register ?? plugin.helix.config.defaultYankRegister);
      const values = plugin.helix.registers.read(register, plugin.helix.registerEnv(cx.host));
      if (!values?.some((v) => v.includes("\n"))) return false;
      const flat = values.map((v) => v.replace(/\n+$/, "").replace(/\n/g, "<br>"));
      pasteImpl(cx, flat, name.endsWith("before") ? "before" : "after", cx.count());
      return true;
    }
    default:
      return false;
  }
}

function leaveTable(plugin: HookPlugin, table: TableWidget, direction: "up" | "down", count: number): void {
  const md = activeView(plugin.app);
  const main = table.editor.cm;
  const fm = frontmatterEnd(main);
  if (direction === "up" && md && fm !== null && propertiesHidden(plugin, main) && table.start <= fm + 1 && metadataOf(md)?.properties.length) {
    metadataOf(md)!.focus({ bottom: true });
    return;
  }
  table.placeCursorAround(direction === "up" ? "before" : "after");
  if (count > 1) {
    const host = plugin.hostForView(main);
    plugin.helix.runStatic(new Context(plugin.helix, host, count - 1, null), direction === "up" ? "move_visual_line_up" : "move_visual_line_down");
  }
}

function cellEdge(plugin: HookPlugin, edge: HelixEdge, active: ActiveCell): boolean {
  const { table, cell } = active;
  if (edge.extend) {
    const rowDelta = edge.direction === "up" ? -1 : edge.direction === "down" ? 1 : 0;
    const colDelta = edge.direction === "left" ? -1 : edge.direction === "right" ? 1 : 0;
    selectRect(table, cell, cell);
    if (rowDelta !== 0) moveSelectionHead(table, rowDelta * edge.count, 0, true);
    else if (edge.count > 1) moveSelectionHead(table, 0, colDelta * (edge.count - 1), true);
    return true;
  }
  const doc = active.editor.cm.state.doc;
  const offset = active.editor.cm.state.field(helixField).selection.primary().cursor(doc);
  switch (edge.direction) {
    case "left": {
      const target = Math.max(0, cell.col - edge.count);
      if (target !== cell.col) moveToCell(table, cell.row, target, edge.count > 1 && target > 0 ? "start" : "last");
      return true;
    }
    case "right": {
      const last = table.rows[cell.row]!.length - 1;
      const target = Math.min(last, cell.col + edge.count);
      if (target !== cell.col) moveToCell(table, cell.row, target, "start");
      return true;
    }
    case "up": {
      if (cell.row - edge.count >= 0) moveToCell(table, cell.row - edge.count, Math.min(cell.col, table.rows[cell.row - edge.count]!.length - 1), offset);
      else leaveTable(plugin, table, "up", edge.count - cell.row);
      return true;
    }
    case "down": {
      const rows = table.rows.length;
      if (cell.row + edge.count < rows) moveToCell(table, cell.row + edge.count, Math.min(cell.col, table.rows[cell.row + edge.count]!.length - 1), offset);
      else leaveTable(plugin, table, "down", cell.row + edge.count - rows + 1);
      return true;
    }
  }
}

function enterTable(view: EditorView, table: TableWidget, edge: HelixEdge): boolean {
  const down = edge.direction === "down";
  const rowIndex = down ? Math.min(edge.count - 1, table.rows.length - 1) : Math.max(table.rows.length - edge.count, 0);
  const row = table.rows[rowIndex]!;
  const left = view.contentDOM.getBoundingClientRect().left + (edge.goalColumn ?? 0);
  let col = 0;
  row.forEach((cell, i) => {
    if (cell.el.getBoundingClientRect().left <= left) col = i;
  });
  moveToCell(table, rowIndex, col, "start");
  return true;
}

export function obsidianHooks(plugin: HookPlugin): Extension {
  return [tableSelectionMarks, helixHooks.of({
    intercept(key, host) {
      if (!tableCursors) return false;
      return tableCursors.handleKey(key, host);
    },
    textObject(kind, ch, cx) {
      const active = activeCell(plugin, cx.host);
      if (!active) return false;
      const { table, cell } = active;
      if (ch === "p") {
        selectWholeTable(table);
        return true;
      }
      if (ch !== "|") return false;
      if (table.selectedCells.length > 1 && kind === "inside") {
        const places = cellsIn(table).map((c) => ({ row: c.row, col: c.col }));
        table.deselectCells();
        tableCursors = new CellCursors(cursorEnv(plugin), places, (text) => [new Range(0, Math.max(text.length, 1))], null);
        return true;
      }
      if (kind === "around") {
        selectRect(table, cell, cell);
        return true;
      }
      table.deselectCells();
      const length = cx.host.state.doc.length;
      setSel(cx, new Selection([new Range(0, Math.max(length, 1))], 0).ensureInvariants(cx.host.state.doc));
      return true;
    },
    stopBeforeEnd: (host) => activeCell(plugin, host) !== null,
    edge(edge, host) {
      const active = activeCell(plugin, host);
      if (active) return cellEdge(plugin, edge, active);
      const view = host.view;
      if (!view || plugin.isConfigView(view) || edge.direction !== "up") return false;
      const md = activeView(plugin.app);
      const metadata = md && frontmatterEnd(view) !== null && propertiesHidden(plugin, view) ? metadataOf(md) : null;
      return metadata?.properties.length ? metadata.focus({ bottom: true }) : false;
    },
    motionRanges(host) {
      const view = host.view;
      if (!view || plugin.isConfigView(view) || !isLivePreview(view) || activeCell(plugin, host)) return [];
      const ranges: MotionRange[] = [];
      const fm = propertiesHidden(plugin, view) ? frontmatterEnd(view) : null;
      if (fm !== null) ranges.push({ from: 0, to: fm, kind: "skip" });
      const selecting = host.state.field(helixField).mode === "select";
      for (const table of tableWidgets(view)) {
        if (!selecting) {
          ranges.push({ from: table.start, to: table.end, kind: "enter" });
          continue;
        }
        const doc = view.state.doc;
        const first = doc.lineAt(table.start).number;
        const last = doc.lineAt(table.end).number;
        for (let n = first; n <= last; n++) {
          const line = doc.line(n);
          ranges.push({ from: line.from, to: Math.min(line.to + 1, doc.length), kind: n === first + 1 ? "skip" : "row" });
        }
      }
      ranges.push(...embedRanges(view));
      return ranges.sort((a, b) => a.from - b.from);
    },
    enter(range, edge, host) {
      const view = host.view;
      if (!view) return false;
      const table = tableWidgets(view).find((t) => t.start === range.from);
      return table ? enterTable(view, table, edge) : false;
    },
    command(name, cx) {
      const active = activeCell(plugin, cx.host);
      if (active) return cellCommand(plugin, name, cx, active);
      const view = cx.host.view;
      if ((name === "extend_line_below" || name === "extend_line" || name === "select_line_below") && view && isLivePreview(view) && !plugin.isConfigView(view)) {
        cx.callbacks.push(() => {
          const doc = view.state.doc;
          const end = selOf(cx).primary().to();
          const last = doc.lineAt(Math.max(end - 1, 0));
          if (tableWidgets(view).some((t) => doc.lineAt(t.start).number === last.number)) plugin.helix.runStatic(new Context(plugin.helix, cx.host, null, null), "extend_line_below");
        });
        return false;
      }
      if ((name === "goto_file_start" || name === "extend_to_file_start") && view && cx.countRaw === null && !plugin.isConfigView(view) && propertiesHidden(plugin, view)) {
        const fm = frontmatterEnd(view);
        if (fm === null) return false;
        const doc = view.state.doc;
        pushJump(cx);
        const extend = name === "extend_to_file_start" || cx.host.state.field(helixField).mode === "select";
        setSel(cx, selOf(cx).transform((r) => r.putCursor(doc, fm, extend)));
        return true;
      }
      return false;
    },
    focused(host) {
      const md = activeView(plugin.app);
      if (!md) return null;
      const cm = componentOf(md).activeCM;
      return cm && cm !== host.view ? plugin.hostForView(cm) : null;
    },
  })];
}

export const tableSelectionMarks = EditorView.updateListener.of((update) => {
  if (!update.selectionSet && !update.docChanged) return;
  const view = update.view;
  const doc = view.state.doc;
  const ranges = view.state.selection.ranges.filter((r) => !r.empty);
  for (const table of tableWidgets(view)) {
    const covered = ranges.some((r) => r.from < table.end && r.to > table.start);
    if (!covered && !table.containerEl.classList.contains("hx-rows-selected")) continue;
    table.containerEl.classList.toggle("hx-rows-selected", covered);
    for (const row of table.rows) {
      for (const cell of row) {
        const line = doc.lineAt(cell.getAbsoluteOffsets().textStart);
        const on = ranges.some((r) => r.from < line.to && r.to > line.from && !(r.from >= table.start && r.to <= table.end));
        cell.el.classList.toggle("hx-row-selected", on);
      }
    }
  }
});

export function tableCursorCount(): number | null {
  return tableCursors?.count() ?? null;
}

export function endTableCursors(): void {
  tableCursors?.end();
}

export function tableOwner(view: EditorView): EditorView | null {
  const el = view.dom.parentElement?.closest(".cm-table-widget");
  const tile = el as unknown as { cmTile?: { widget?: TableWidget } } | null | undefined;
  return tile?.cmTile?.widget?.editor.cm ?? null;
}

export function focusedCell(plugin: HookPlugin, view: EditorView): EditorView | null {
  const md = activeView(plugin.app);
  const cell = md ? componentOf(md).tableCell : null;
  return cell && cell.table.editor.cm === view ? cell.editor.cm : null;
}

export function afterKey(plugin: HookPlugin, view: EditorView): void {
  const md = activeView(plugin.app);
  const cell = md ? componentOf(md).tableCell : null;
  if (!cell || cell.editor.cm !== view) return;
  if (view.state.field(helixField, false)?.mode !== "insert") commitHistoryNow(plugin.hostForView(cell.table.editor.cm));
}
