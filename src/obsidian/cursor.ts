import type { Extension } from "@codemirror/state";
import { layer, type EditorView, type LayerMarker } from "@codemirror/view";
import type { HelixEditor } from "../core/editor";
import { nextGraphemeBoundary, prevGraphemeBoundary } from "../graphemes";
import type { Range as HelixRange } from "../selection";
import { helixField, type HelixState } from "../state";

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Glyph {
  text: string;
  top: number;
  height: number;
  font: string;
  spacing: string;
  features: string;
  variations: string;
}

interface Backdrop {
  color: string;
  image: string;
}

interface Cell {
  pos: number;
  end: number;
  primary: boolean;
  eol: boolean;
}

class CellMarker implements LayerMarker {
  constructor(
    readonly cls: string,
    readonly box: Box,
    readonly glyph: Glyph | null,
    readonly backdrop: Backdrop | null,
  ) {}

  eq(other: LayerMarker): boolean {
    if (!(other instanceof CellMarker) || other.cls !== this.cls) return false;
    if (this.backdrop?.color !== other.backdrop?.color || this.backdrop?.image !== other.backdrop?.image) return false;
    const a = this.box;
    const b = other.box;
    if (a.left !== b.left || a.top !== b.top || a.right !== b.right || a.bottom !== b.bottom) return false;
    const g = this.glyph;
    const h = other.glyph;
    if (!g || !h) return g === h;
    return (
      g.text === h.text &&
      g.top === h.top &&
      g.height === h.height &&
      g.font === h.font &&
      g.spacing === h.spacing &&
      g.features === h.features &&
      g.variations === h.variations
    );
  }

  draw(): HTMLElement {
    const el = createDiv();
    this.apply(el);
    return el;
  }

  update(dom: HTMLElement, prev: LayerMarker): boolean {
    if (!(prev instanceof CellMarker)) return false;
    this.apply(dom);
    return true;
  }

  private apply(el: HTMLElement): void {
    el.className = this.cls;
    el.setCssProps({
      "--hx-cell-left": `${this.box.left}px`,
      "--hx-cell-top": `${this.box.top}px`,
      "--hx-cell-width": `${this.box.right - this.box.left}px`,
      "--hx-cell-height": `${this.box.bottom - this.box.top}px`,
      "--hx-cell-backdrop": this.backdrop?.color ?? "transparent",
      "--hx-cell-backdrop-image": this.backdrop?.image ?? "none",
    });
    el.empty();
    const g = this.glyph;
    if (!g) return;
    const span = el.createSpan({ cls: "hx-cell-glyph", text: g.text });
    span.setCssProps({
      "--hx-glyph-top": `${g.top}px`,
      "--hx-glyph-height": `${g.height}px`,
      "--hx-glyph-font": g.font,
      "--hx-glyph-spacing": g.spacing,
      "--hx-glyph-features": g.features,
      "--hx-glyph-variations": g.variations,
    });
  }
}

class Measure {
  private rows = new Map<Element, { top: number; height: number }>();
  private opaque = new Map<Element, boolean>();
  private lineBoxes = new Map<number, Box[]>();
  private backdrops = new Map<Element, Backdrop>();

  constructor(
    readonly view: EditorView,
    readonly model: Model,
  ) {}

  lineElement(pos: number): HTMLElement | null {
    const { node, offset } = this.view.domAtPos(pos);
    const target = node.nodeType === 1 && offset < node.childNodes.length ? node.childNodes[offset]! : node;
    const el = target.nodeType === 1 ? (target as HTMLElement) : target.parentElement;
    return el?.closest<HTMLElement>(".cm-line") ?? null;
  }

  row(line: HTMLElement | null, y: number): [number, number] | null {
    if (!line) return null;
    let metrics = this.rows.get(line);
    if (!metrics) {
      const rect = line.getBoundingClientRect();
      const style = getComputedStyle(line);
      const top = rect.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
      const height = parseFloat(style.lineHeight);
      if (!(height > 0)) return null;
      metrics = { top, height };
      this.rows.set(line, metrics);
    }
    const k = Math.max(0, Math.floor((y - metrics.top) / metrics.height));
    return [metrics.top + k * metrics.height, metrics.top + (k + 1) * metrics.height];
  }

  backdrop(pos: number): Backdrop | null {
    const { node } = this.view.domAtPos(pos, 1);
    const start = node.nodeType === 1 ? (node as Element) : node.parentElement;
    if (!start) return null;
    const known = this.backdrops.get(start);
    if (known) return known;
    const layers: string[] = [];
    let color = "transparent";
    for (let e: Element | null = start; e; e = e.parentElement) {
      const bg = getComputedStyle(e).backgroundColor;
      if (isOpaque(bg)) {
        color = bg;
        break;
      }
      if (!/^(transparent|rgba\(0, 0, 0, 0\))$/.test(bg)) layers.push(`linear-gradient(${bg}, ${bg})`);
    }
    const result = { color, image: layers.length > 0 ? layers.join(", ") : "none" };
    this.backdrops.set(start, result);
    return result;
  }

  onOpaque(el: Element | null): boolean {
    const chain: Element[] = [];
    let result = false;
    for (let e = el; e && !e.classList.contains("cm-content"); e = e.parentElement) {
      const known = this.opaque.get(e);
      if (known !== undefined) {
        result = known;
        break;
      }
      chain.push(e);
      if (isOpaque(getComputedStyle(e).backgroundColor)) {
        result = true;
        break;
      }
      if (e.classList.contains("cm-line")) break;
    }
    for (const e of chain) this.opaque.set(e, result);
    return result;
  }

  boxes(n: number): Box[] {
    let boxes = this.lineBoxes.get(n);
    if (boxes) return boxes;
    boxes = [];
    this.lineBoxes.set(n, boxes);
    const doc = this.view.state.doc;
    if (n < 1 || n > doc.lines) return boxes;
    const line = doc.line(n);
    const el = this.lineElement(line.from);
    for (const seg of this.model.byLine.get(n) ?? []) {
      if (seg.to > seg.from) {
        const r = domRange(this.view, seg.from, seg.to);
        for (const rect of r ? Array.from(r.getClientRects()) : []) {
          const row = this.row(el, (rect.top + rect.bottom) / 2);
          if (row && rect.width > 0) boxes.push({ left: rect.left, right: rect.right, top: row[0], bottom: row[1] });
        }
      }
    }
    if (this.model.newlines.has(n) && !this.model.eol.has(line.to) && el) {
      const c = this.view.coordsAtPos(line.to, -1) ?? this.view.coordsAtPos(line.to, 1);
      const row = c && this.row(el, (c.top + c.bottom) / 2);
      if (c && row) boxes.push({ left: c.right, right: c.right + spaceWidth(el), top: row[0], bottom: row[1] });
    }
    return boxes;
  }
}

function cellWidth(el: Element): number {
  return 0.6 * parseFloat(getComputedStyle(el).fontSize);
}

let canvas: CanvasRenderingContext2D | null = null;
const spaces = new Map<string, number>();

function spaceWidth(el: Element): number {
  const font = getComputedStyle(el).font;
  let width = spaces.get(font);
  if (width === undefined) {
    canvas ??= createEl("canvas").getContext("2d");
    if (!canvas) return cellWidth(el);
    canvas.font = font;
    width = canvas.measureText(" ").width;
    spaces.set(font, width);
  }
  return width;
}

function isOpaque(color: string): boolean {
  if (color === "transparent") return false;
  const alpha = /rgba\([^)]*,\s*([\d.]+)\)$/.exec(color) ?? /\/\s*([\d.]+%?)\s*\)$/.exec(color);
  if (!alpha) return true;
  const a = alpha[1]!;
  return a.endsWith("%") ? parseFloat(a) >= 100 : parseFloat(a) >= 1;
}

function covered(boxes: Box[], x: number, y: number): boolean {
  return boxes.some((b) => x >= b.left && x < b.right && y >= b.top && y < b.bottom);
}

interface Segment {
  from: number;
  to: number;
  native: boolean;
}

interface Model {
  value: HelixState;
  shape: CursorShape;
  byLine: Map<number, Segment[]>;
  newlines: Map<number, boolean>;
  eol: Set<number>;
  cells: Cell[];
}

type CursorShape = HelixEditor["config"]["cursorShape"]["normal"];

function model(view: EditorView, editor: HelixEditor): Model | null {
  const value = view.state.field(helixField, false);
  if (!value) return null;
  const doc = view.state.doc;
  const shape = editor.config.cursorShape[value.mode];
  const insert = value.mode === "insert";
  const { from: vFrom, to: vTo } = view.viewport;
  const byLine = new Map<number, Segment[]>();
  const newlines = new Map<number, boolean>();
  const cells: Cell[] = [];
  value.selection.ranges.forEach((range: HelixRange, i) => {
    const primary = i === value.selection.primaryIndex;
    const native = primary && !insert;
    const drawsCell = shape !== "hidden" && !(insert && primary && shape === "bar") && !view.composing;
    let from = range.from();
    let to = range.to();
    if (insert) {
      const r = range.minWidth1(doc);
      if (r.head > r.anchor) {
        from = r.anchor;
        to = prevGraphemeBoundary(doc, r.head);
      } else {
        const cursorEnd = nextGraphemeBoundary(doc, r.head);
        from = primary && shape !== "block" && cursorEnd !== r.anchor ? r.head : cursorEnd;
        to = r.anchor;
      }
    }
    const start = Math.max(from, vFrom);
    const end = Math.min(to, vTo);
    for (let pos = start; pos < end; ) {
      const line = doc.lineAt(pos);
      const segEnd = Math.min(end, line.to);
      const list = byLine.get(line.number) ?? [];
      list.push({ from: pos, to: segEnd, native });
      byLine.set(line.number, list);
      if (to > line.to && line.to < doc.length) newlines.set(line.number, native && newlines.get(line.number) !== false);
      pos = line.to + 1;
    }
    const pos = range.cursor(doc);
    if (drawsCell && pos >= vFrom && pos <= vTo) {
      const eol = pos >= doc.length || doc.lineAt(pos).to === pos;
      cells.push({ pos, end: eol ? pos : nextGraphemeBoundary(doc, pos), primary, eol });
    }
  });
  const eol = new Set(cells.filter((c) => c.eol).map((c) => c.pos));
  return { value, shape, byLine, newlines, eol, cells };
}

const highlights = new WeakMap<object, { highlight: RangeSet; views: Map<EditorView, Range[]> }>();

interface RangeSet {
  add(range: Range): unknown;
  delete(range: Range): unknown;
}

interface HighlightWindow {
  Highlight?: new () => RangeSet;
  CSS: { highlights?: { set(name: string, value: RangeSet): unknown } };
}

function setHighlight(view: EditorView, ranges: Range[]): void {
  const win = view.dom.ownerDocument.defaultView as HighlightWindow | null;
  if (!win?.Highlight || !win.CSS.highlights) return;
  let entry = highlights.get(win);
  if (!entry) {
    entry = { highlight: new win.Highlight(), views: new Map() };
    highlights.set(win, entry);
    win.CSS.highlights.set("hx-sel", entry.highlight);
  }
  for (const r of entry.views.get(view) ?? []) entry.highlight.delete(r);
  if (ranges.length === 0) entry.views.delete(view);
  else entry.views.set(view, ranges);
  for (const r of ranges) entry.highlight.add(r);
}

function domRange(view: EditorView, from: number, to: number): Range | null {
  try {
    const a = view.domAtPos(from, 1);
    const b = view.domAtPos(to, -1);
    const r = view.dom.ownerDocument.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    return r.collapsed ? null : r;
  } catch {
    return null;
  }
}

function opaqueParts(measure: Measure, range: Range): Range[] {
  const out: Range[] = [];
  const doc = range.startContainer.ownerDocument;
  if (!doc) return out;
  const root = range.commonAncestorContainer;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Node[] = root.nodeType === 3 ? [root] : [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  for (const node of nodes) {
    if (!range.intersectsNode(node) || !measure.onOpaque(node.parentElement)) continue;
    const r = doc.createRange();
    r.setStart(node, node === range.startContainer ? range.startOffset : 0);
    r.setEnd(node, node === range.endContainer ? range.endOffset : (node.nodeValue ?? "").length);
    if (!r.collapsed) out.push(r);
  }
  return out;
}

function glyphAt(view: EditorView, cell: Cell, top: number, coords: { top: number; bottom: number }): Glyph | null {
  const text = view.state.doc.sliceString(cell.pos, cell.end);
  if (/^\s*$/.test(text)) return null;
  const { node } = view.domAtPos(cell.pos, 1);
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  if (!el) return null;
  const style = getComputedStyle(el);
  return {
    text,
    top: coords.top - top,
    height: coords.bottom - coords.top,
    font: style.font,
    spacing: style.letterSpacing,
    features: style.fontFeatureSettings,
    variations: style.fontVariationSettings,
  };
}

function base(view: EditorView, box: Box): Box {
  const rect = view.scrollDOM.getBoundingClientRect();
  const left = rect.left - view.scrollDOM.scrollLeft * view.scaleX;
  const top = rect.top - view.scrollDOM.scrollTop * view.scaleY;
  return { left: box.left - left, right: box.right - left, top: box.top - top, bottom: box.bottom - top };
}

function selectionMarkers(view: EditorView, editor: HelixEditor): LayerMarker[] {
  const m = model(view, editor);
  if (!m) {
    setHighlight(view, []);
    return [];
  }
  const measure = new Measure(view, m);
  const doc = view.state.doc;
  const out: LayerMarker[] = [];
  const ranges: Range[] = [];
  for (const [n, segs] of m.byLine) {
    const drawn = segs.filter((s) => !s.native);
    const ownNewline = m.newlines.get(n) === false;
    if (drawn.length === 0 && !ownNewline) continue;
    const line = doc.line(n);
    const el = measure.lineElement(line.from);
    for (const seg of drawn) {
      if (seg.to <= seg.from) continue;
      const r = domRange(view, seg.from, seg.to);
      if (!r) continue;
      ranges.push(...opaqueParts(measure, r));
      for (const rect of Array.from(r.getClientRects())) {
        const row = measure.row(el, (rect.top + rect.bottom) / 2);
        if (row && rect.width > 0) {
          out.push(new CellMarker("hx-cell hx-cell-sel", base(view, { left: rect.left, right: rect.right, top: row[0], bottom: row[1] }), null, null));
        }
      }
    }
    if (ownNewline && !m.eol.has(line.to) && el) {
      const c = view.coordsAtPos(line.to, -1) ?? view.coordsAtPos(line.to, 1);
      const row = c && measure.row(el, (c.top + c.bottom) / 2);
      if (c && row) {
        out.push(new CellMarker("hx-cell hx-cell-sel", base(view, { left: c.right, right: c.right + spaceWidth(el), top: row[0], bottom: row[1] }), null, null));
      }
    }
  }
  setHighlight(view, ranges);
  return out;
}

function cellMarkers(view: EditorView, editor: HelixEditor): LayerMarker[] {
  const m = model(view, editor);
  if (!m || m.cells.length === 0) return [];
  const measure = new Measure(view, m);
  const doc = view.state.doc;
  const out: LayerMarker[] = [];
  for (const cell of m.cells) {
    const line = doc.lineAt(cell.pos);
    const el = measure.lineElement(line.from);
    let left: number;
    let right: number;
    let coords: { top: number; bottom: number };
    if (cell.eol) {
      const c = view.coordsAtPos(cell.pos, -1) ?? view.coordsAtPos(cell.pos, 1);
      if (!c || !el) continue;
      left = c.right;
      right = c.right + cellWidth(el);
      coords = c;
    } else {
      const a = view.coordsAtPos(cell.pos, 1);
      const b = view.coordsAtPos(cell.end, -1);
      if (!a || !b) continue;
      left = Math.min(a.left, b.right);
      right = Math.max(a.left, b.right);
      coords = a;
    }
    const row = measure.row(el, (coords.top + coords.bottom) / 2);
    if (!row) continue;
    const box: Box = { left, right, top: row[0], bottom: row[1] };
    const near = [...measure.boxes(line.number - 1), ...measure.boxes(line.number), ...measure.boxes(line.number + 1)];
    const square = (x1: number, y1: number, x2: number, y2: number) => covered(near, x1, y1) || covered(near, x2, y2);
    const corners = [
      square(box.left - 1, box.top + 1, box.left + 1, box.top - 1) ? "hx-cell-sq-tl" : "",
      square(box.right + 1, box.top + 1, box.right - 1, box.top - 1) ? "hx-cell-sq-tr" : "",
      square(box.left - 1, box.bottom - 1, box.left + 1, box.bottom + 1) ? "hx-cell-sq-bl" : "",
      square(box.right + 1, box.bottom - 1, box.right - 1, box.bottom + 1) ? "hx-cell-sq-br" : "",
    ];
    const insertPrimary = m.value.mode === "insert" && cell.primary;
    const shape = insertPrimary ? m.shape : "block";
    const cls = ["hx-cell", `hx-cell-${shape}`, cell.primary ? "hx-cell-primary" : "", ...corners].filter(Boolean).join(" ");
    const glyph = shape === "block" && !cell.eol ? glyphAt(view, cell, row[0], coords) : null;
    const backdrop = shape === "block" ? measure.backdrop(cell.pos) : null;
    out.push(new CellMarker(cls, base(view, box), glyph, backdrop));
  }
  return out;
}

export function cursorLayers(editor: HelixEditor): Extension {
  return [
    layer({
      above: false,
      class: "hx-selections",
      update: () => true,
      markers: (view) => selectionMarkers(view, editor),
      destroy: (_layer, view) => setHighlight(view, []),
    }),
    layer({
      above: true,
      class: "hx-cursors",
      update: () => true,
      markers: (view) => cellMarkers(view, editor),
    }),
  ];
}
