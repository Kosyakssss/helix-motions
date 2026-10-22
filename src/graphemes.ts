import { findClusterBreak, type Text } from "@codemirror/state";

export function nextGraphemeBoundary(doc: Text, pos: number): number {
  if (pos >= doc.length) return doc.length;
  const line = doc.lineAt(pos);
  if (pos >= line.to) return pos + 1;
  return line.from + findClusterBreak(line.text, pos - line.from, true);
}

export function prevGraphemeBoundary(doc: Text, pos: number): number {
  if (pos <= 0) return 0;
  if (pos > doc.length) return doc.length;
  const line = doc.lineAt(pos);
  if (pos <= line.from) return pos - 1;
  return line.from + findClusterBreak(line.text, pos - line.from, false);
}

export function nthNextGraphemeBoundary(doc: Text, pos: number, n: number): number {
  for (let i = 0; i < n; i++) pos = nextGraphemeBoundary(doc, pos);
  return pos;
}

export function nthPrevGraphemeBoundary(doc: Text, pos: number, n: number): number {
  for (let i = 0; i < n; i++) pos = prevGraphemeBoundary(doc, pos);
  return pos;
}

export function isGraphemeBoundary(doc: Text, pos: number): boolean {
  if (pos <= 0 || pos >= doc.length) return true;
  const line = doc.lineAt(pos);
  if (pos === line.from || pos === line.to) return true;
  const rel = pos - line.from;
  return findClusterBreak(line.text, findClusterBreak(line.text, rel, false), true) === rel;
}

export function ensureGraphemeBoundaryNext(doc: Text, pos: number): number {
  return isGraphemeBoundary(doc, pos) ? pos : nextGraphemeBoundary(doc, pos);
}

export function ensureGraphemeBoundaryPrev(doc: Text, pos: number): number {
  return isGraphemeBoundary(doc, pos) ? pos : prevGraphemeBoundary(doc, pos);
}
