import { backdropOf, type Box, CellMarker, cellWidth, cornerClasses, type CursorShape, glyphFor, isOpaque, setHighlight } from "helix-cm6/engine";

type DomRange = ReturnType<Document["createRange"]>;

export interface PaintRange {
  from: number;
  to: number;
  pos: number;
  end: number;
  eol: boolean;
  primary: boolean;
}

export interface PaintCell {
  content: HTMLElement;
  source: string;
  ranges: PaintRange[];
}

function renderedOffset(source: string, rendered: string, offset: number): number {
  let at = 0;
  for (let i = 0; i < offset && i < source.length && at < rendered.length; i++) {
    if (source[i] === rendered[at]) at++;
  }
  return at;
}

class CellText {
  readonly rendered: string;
  private readonly style: CSSStyleDeclaration;

  constructor(
    readonly content: HTMLElement,
    private readonly source: string,
    private readonly root: HTMLElement,
  ) {
    this.rendered = content.textContent ?? "";
    this.style = getComputedStyle(content);
  }

  offset(pos: number): number {
    return renderedOffset(this.source, this.rendered, pos);
  }

  private point(offset: number, forward: boolean): [Node, number] | null {
    const walker = this.content.ownerDocument.createTreeWalker(this.content, NodeFilter.SHOW_TEXT);
    let left = offset;
    let last: Text | null = null;
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      last = node;
      if (forward ? left < node.length : left <= node.length) return [node, left];
      left -= node.length;
    }
    return last ? [last, last.length] : null;
  }

  range(from: number, to: number): DomRange | null {
    const start = this.point(from, true);
    const end = this.point(to, false);
    if (!start || !end) return null;
    const range = this.content.ownerDocument.createRange();
    range.setStart(start[0], start[1]);
    range.setEnd(end[0], end[1]);
    return range;
  }

  private textTop(): number {
    return this.content.getBoundingClientRect().top + parseFloat(this.style.borderTopWidth) + parseFloat(this.style.paddingTop);
  }

  row(y: number): [number, number] {
    const height = parseFloat(this.style.lineHeight) || this.content.getBoundingClientRect().height;
    const top = this.textTop();
    const k = Math.max(0, Math.floor((y - top) / height));
    return [top + k * height, top + (k + 1) * height];
  }

  endOfText(offset: number): { left: number; top: number; bottom: number } {
    const last = offset > 0 ? this.range(offset - 1, offset) : null;
    const rects = last ? Array.from(last.getClientRects()).filter((r) => r.width > 0) : [];
    const rect = rects[rects.length - 1];
    if (rect) return { left: rect.right, top: rect.top, bottom: rect.bottom };
    const box = this.content.getBoundingClientRect();
    const top = this.textTop();
    const left = box.left + parseFloat(this.style.borderLeftWidth) + parseFloat(this.style.paddingLeft);
    return { left, top, bottom: top + (parseFloat(this.style.lineHeight) || box.height) };
  }

  opaque(node: Node): boolean {
    for (let e = node.nodeType === 1 ? (node as Element) : node.parentElement; e && e !== this.root; e = e.parentElement) {
      if (isOpaque(getComputedStyle(e).backgroundColor)) return true;
    }
    return false;
  }
}

export class CellLayers {
  private root: HTMLElement | null = null;
  private layers: HTMLElement[] = [];
  private mutations: MutationObserver | null = null;
  private sizes: ResizeObserver | null = null;

  constructor(private readonly redraw: () => void) {}

  private watch(root: HTMLElement): void {
    if (this.root === root) return;
    this.clear();
    this.root = root;
    root.classList.add("hx-cell-cursors-on");
    const win = root.ownerDocument.defaultView;
    if (!win) return;
    this.mutations = new win.MutationObserver(() => this.redraw());
    this.mutations.observe(root, { subtree: true, childList: true, characterData: true });
    this.sizes = new win.ResizeObserver(() => this.redraw());
    this.sizes.observe(root);
  }

  clear(): void {
    this.mutations?.disconnect();
    this.sizes?.disconnect();
    this.mutations = null;
    this.sizes = null;
    for (const layer of this.layers) layer.remove();
    this.layers = [];
    if (this.root) {
      setHighlight(this, this.root.ownerDocument, []);
      this.root.classList.remove("hx-cell-cursors-on");
    }
    this.root = null;
  }

  draw(root: HTMLElement, cells: readonly PaintCell[], shape: CursorShape, insert: boolean): void {
    this.watch(root);
    for (const layer of this.layers) layer.remove();
    const below = root.createDiv("cm-layer hx-cell-selections");
    const above = root.createDiv("cm-layer hx-cell-cursors");
    this.layers = [below, above];
    const page = root.ownerDocument;
    const base = root.getBoundingClientRect();
    const toRoot = (box: Box): Box => ({
      left: box.left - base.left + root.scrollLeft,
      right: box.right - base.left + root.scrollLeft,
      top: box.top - base.top + root.scrollTop,
      bottom: box.bottom - base.top + root.scrollTop,
    });
    const marks: DomRange[] = [];
    for (const cell of cells) {
      const text = new CellText(cell.content, cell.source, root);
      const selected: Box[] = [];
      for (const part of cell.ranges) {
        const from = text.offset(part.from);
        const to = text.offset(part.to);
        const range = to > from ? text.range(from, to) : null;
        if (!range) continue;
        if (text.opaque(range.startContainer)) marks.push(range);
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.width <= 0) continue;
          const row = text.row((rect.top + rect.bottom) / 2);
          const box = { left: rect.left, right: rect.right, top: row[0], bottom: row[1] };
          selected.push(box);
          below.appendChild(new CellMarker(page, "hx-cell hx-cell-sel", toRoot(box), null, null).draw());
        }
      }
      if (shape === "hidden") continue;
      for (const part of cell.ranges) {
        if (part.pos < 0) continue;
        const start = text.offset(part.pos);
        const end = Math.max(text.offset(part.end), start + 1);
        const range = !part.eol && start < text.rendered.length ? text.range(start, end) : null;
        const rect = range ? Array.from(range.getClientRects()).find((r) => r.width > 0) : undefined;
        const at = rect ?? text.endOfText(start);
        const row = text.row((at.top + at.bottom) / 2);
        const form = insert && part.primary ? shape : "block";
        const box = { left: at.left, right: form === "bar" ? at.left + 2 : rect ? rect.right : at.left + cellWidth(text.content), top: row[0], bottom: row[1] };
        const owner = range && rect ? (range.startContainer.nodeType === 1 ? (range.startContainer as Element) : range.startContainer.parentElement) : null;
        const glyph = form === "block" && rect ? glyphFor(owner, text.rendered.slice(start, end), row[0], rect) : null;
        const cls = ["hx-cell", `hx-cell-${form}`, part.primary ? "hx-cell-primary" : "", ...cornerClasses(box, selected)].filter(Boolean).join(" ");
        above.appendChild(new CellMarker(page, cls, toRoot(box), glyph, form === "block" ? backdropOf(owner ?? text.content) : null).draw());
      }
    }
    setHighlight(this, page, marks);
    this.mutations?.takeRecords();
  }
}
