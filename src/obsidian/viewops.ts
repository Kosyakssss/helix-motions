import { EditorView } from "@codemirror/view";
import type { Context, ViewOps } from "../core/editor";
import type { Host } from "../core/host";
import { moveVisualVertically } from "../movement";
import { Range, Selection } from "../selection";
import { modeOf, selOf, setSel } from "../commands/util";

function rows(view: EditorView, amount: number | "page" | "half"): number {
  const lh = view.defaultLineHeight;
  const height = view.scrollDOM.clientHeight;
  if (amount === "page") return Math.max(1, Math.floor(height / lh));
  if (amount === "half") return Math.max(1, Math.floor(height / lh / 2));
  return amount;
}

function posAtScreenY(view: EditorView, y: number): number {
  const block = view.lineBlockAtHeight(y - view.documentTop);
  const rect = view.contentDOM.getBoundingClientRect();
  const pos = view.posAtCoords({ x: rect.left + 1, y }, false);
  return pos ?? block.from;
}

export function makeViewOps(scrolloff: () => number): ViewOps {
  return {
    scroll(cx: Context, amount, dir, sync) {
      const view = cx.host.view;
      if (!view) return;
      const n = amount === "page" || amount === "half" ? rows(view, amount) : amount * (cx.editor.config.scrollLines > 0 ? 1 : 1);
      const lh = view.defaultLineHeight;
      view.scrollDOM.scrollTop += (dir === "forward" ? 1 : -1) * n * lh;
      const doc = view.state.doc;
      const extend = modeOf(cx) === "select";
      if (sync) {
        setSel(
          cx,
          selOf(cx).transform((r) => moveVisualVertically(view, r, dir, n, extend ? "extend" : "move")),
          { scrollIntoView: false },
        );
        return;
      }
      const rect = view.scrollDOM.getBoundingClientRect();
      const so = Math.min(scrolloff(), Math.floor((view.scrollDOM.clientHeight / lh - 1) / 2));
      const sel = selOf(cx);
      const primary = sel.primary();
      const cursor = primary.cursor(doc);
      let head: number;
      if (dir === "forward") {
        head = posAtScreenY(view, rect.top + so * lh + 1);
        if (head <= cursor) return;
      } else {
        head = posAtScreenY(view, rect.bottom - (so + 1) * lh + 1);
        if (head >= cursor) return;
      }
      const anchor = extend ? primary.anchor : head;
      const ranges = sel.ranges.map((r, i) => (i === sel.primaryIndex ? new Range(anchor, head) : r));
      setSel(cx, new Selection(ranges, sel.primaryIndex), { scrollIntoView: false });
    },
    alignView(cx, align) {
      const view = cx.host.view;
      if (!view) return;
      const pos = selOf(cx).primary().cursor(view.state.doc);
      const y = align === "top" ? "start" : align === "center" ? "center" : "end";
      view.dispatch({ effects: EditorView.scrollIntoView(pos, { y, yMargin: align === "center" ? 0 : scrolloff() * view.defaultLineHeight }) });
    },
    gotoWindow(cx, align) {
      const view = cx.host.view;
      if (!view) return;
      const count = cx.count() - 1;
      const lh = view.defaultLineHeight;
      const rect = view.scrollDOM.getBoundingClientRect();
      const visibleRows = Math.floor(view.scrollDOM.clientHeight / lh);
      const so = Math.min(scrolloff(), Math.floor((visibleRows - 1) / 2));
      let row = align === "top" ? so + count : align === "center" ? Math.floor((visibleRows - 1) / 2) : visibleRows - 1 - (so + count);
      row = Math.max(so, Math.min(row, visibleRows - 1 - so));
      const pos = posAtScreenY(view, rect.top + row * lh + lh / 2);
      const doc = view.state.doc;
      const extend = modeOf(cx) === "select";
      setSel(cx, selOf(cx).transform((r) => r.putCursor(doc, pos, extend)), { scrollIntoView: false });
    },
    visibleRange(host: Host): [number, number] {
      const view = host.view;
      if (!view) return [0, host.state.doc.length];
      const rect = view.scrollDOM.getBoundingClientRect();
      const top = posAtScreenY(view, rect.top + 1);
      const bottom = posAtScreenY(view, rect.bottom - 1);
      return [top, bottom];
    },
  };
}
