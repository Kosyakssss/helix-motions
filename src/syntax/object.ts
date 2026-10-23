import { Text } from "@codemirror/state";
import type { Node } from "./ts";
import { Range, Selection, type Direction } from "../selection";
import { findMatchingBracketPlaintext, PAIRS } from "../match-brackets";
import type { Syntax, SyntaxCursor } from "./syntax";

function withCursor<T>(syntax: Syntax, f: (cursor: SyntaxCursor) => T): T {
  const cursor = syntax.walk();
  try {
    return f(cursor);
  } finally {
    cursor.dispose();
  }
}

export function expandSelection(syntax: Syntax, selection: Selection): Selection {
  return withCursor(syntax, (cursor) =>
    selection.transform((range) => {
      const from = syntax.byteOf(range.from());
      const to = syntax.byteOf(range.to());
      cursor.resetToByteRange(from, to);
      for (;;) {
        const node = cursor.node();
        if (node.startByte !== from || node.endByte !== to) break;
        if (!cursor.gotoParent()) break;
      }
      const node = cursor.node();
      return new Range(syntax.posOf(node.endByte), syntax.posOf(node.startByte)).withDirection(range.direction());
    }),
  );
}

export function shrinkSelection(syntax: Syntax, selection: Selection): Selection {
  return selectNodeImpl(syntax, selection, (cursor) => void cursor.gotoFirstChild(), null);
}

export function selectNextSibling(syntax: Syntax, selection: Selection): Selection {
  return selectNodeImpl(
    syntax,
    selection,
    (cursor) => {
      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) break;
      }
    },
    "forward",
  );
}

export function selectPrevSibling(syntax: Syntax, selection: Selection): Selection {
  return selectNodeImpl(
    syntax,
    selection,
    (cursor) => {
      while (!cursor.gotoPreviousSibling()) {
        if (!cursor.gotoParent()) break;
      }
    },
    "backward",
  );
}

export function selectAllSiblings(syntax: Syntax, selection: Selection): Selection {
  return withCursor(syntax, (cursor) =>
    transformIter(selection, (range) => {
      cursor.resetToByteRange(syntax.byteOf(range.from()), syntax.byteOf(range.to()));
      if (!cursor.gotoParentWith((parent) => parent.childCount > 1)) return [range];
      return selectChildren(syntax, cursor, range);
    }),
  );
}

export function selectAllChildren(syntax: Syntax, selection: Selection): Selection {
  return withCursor(syntax, (cursor) =>
    transformIter(selection, (range) => {
      cursor.resetToByteRange(syntax.byteOf(range.from()), syntax.byteOf(range.to()));
      return selectChildren(syntax, cursor, range);
    }),
  );
}

function transformIter(selection: Selection, f: (range: Range) => Range[]): Selection {
  return new Selection(selection.ranges.flatMap(f), selection.primaryIndex);
}

function selectChildren(syntax: Syntax, cursor: SyntaxCursor, range: Range): Range[] {
  const children = cursor
    .children()
    .filter((child) => child.isNamed)
    .map((child) => new Range(syntax.posOf(child.startByte), syntax.posOf(child.endByte)).withDirection(range.direction()));
  return children.length > 0 ? children : [range];
}

function selectNodeImpl(
  syntax: Syntax,
  selection: Selection,
  motion: (cursor: SyntaxCursor) => void,
  direction: Direction | null,
): Selection {
  return withCursor(syntax, (cursor) =>
    selection.transform((range) => {
      cursor.resetToByteRange(syntax.byteOf(range.from()), syntax.byteOf(range.to()));
      motion(cursor);
      const node = cursor.node();
      return new Range(syntax.posOf(node.startByte), syntax.posOf(node.endByte)).withDirection(direction ?? range.direction());
    }),
  );
}

function findParentStart(node: Node): Node | null {
  const start = node.startByte;
  let current = node;
  while (current.startByte >= start || !current.isNamed) {
    const parent = current.parent;
    if (!parent) return null;
    current = parent;
  }
  return current;
}

export function moveParentNodeEnd(
  syntax: Syntax,
  doc: Text,
  selection: Selection,
  dir: Direction,
  movement: "move" | "extend",
): Selection {
  return selection.transform((range) => {
    let node = syntax.namedDescendantForByteRange(syntax.byteOf(range.from()), syntax.byteOf(range.to()));
    if (!node) return range;
    let endHead: number;
    if (dir === "forward") {
      endHead = syntax.posOf(node.endByte);
    } else {
      endHead = syntax.posOf(node.startByte);
      if (endHead === range.cursor(doc)) {
        node = findParentStart(node) ?? node;
        endHead = syntax.posOf(node.startByte);
      }
    }
    if (movement === "move") {
      return range.direction() === "forward" ? new Range(endHead, endHead + 1) : new Range(endHead + 1, endHead);
    }
    if (endHead >= range.anchor) endHead += 1;
    return new Range(range.anchor, endHead);
  });
}

const MATCH_LIMIT = 16;

function asChar(syntax: Syntax, node: Node): [number, string] | null {
  const start = node.startByte;
  if (node.endByte - start !== 1) return null;
  return [syntax.posOf(start), syntax.slice(start, start + 1)];
}

function asClosePair(syntax: Syntax, node: Node): [string, string] | null {
  const ch = asChar(syntax, node);
  if (!ch) return null;
  const pair = PAIRS.find(([, close]) => close === ch[1]);
  return pair ? [ch[1], pair[0]] : null;
}

function asOpenPair(syntax: Syntax, node: Node): [string, string] | null {
  const ch = asChar(syntax, node);
  if (!ch) return null;
  const pair = PAIRS.find(([open]) => open === ch[1]);
  return pair ? [ch[1], pair[1]] : null;
}

function findPairEnd(syntax: Syntax, start: Node | null, startChar: string, endChar: string, direction: Direction): number | null {
  let depth = 0;
  let node = start;
  for (let i = 0; node && i < MATCH_LIMIT; i++) {
    const ch = asChar(syntax, node);
    if (ch) {
      if (ch[1] === endChar) {
        if (depth === 0) return ch[0];
        depth--;
      } else if (ch[1] === startChar) {
        depth++;
      }
    }
    node = direction === "forward" ? node.nextSibling : node.previousSibling;
  }
  return null;
}

function isValidPair(ch: string): boolean {
  return PAIRS.some(([open, close]) => open === ch || close === ch);
}

export function findMatchingBracket(syntax: Syntax, doc: Text, pos: number): number | null {
  if (pos >= doc.length) return null;
  const ch = String.fromCodePoint(doc.sliceString(pos, pos + 2).codePointAt(0)!);
  if (!isValidPair(ch)) return null;
  return findPair(syntax, doc, pos, false);
}

export function findMatchingBracketFuzzy(syntax: Syntax, doc: Text, pos: number): number | null {
  return findPair(syntax, doc, pos, true);
}

function findPair(syntax: Syntax, doc: Text, pos: number, traverseParents: boolean): number | null {
  const posByte = syntax.byteOf(pos);
  const root = syntax.treeForByteRange(posByte, posByte).rootNode;
  const start = root.descendantForByteRange(posByte, posByte);
  if (!start) return null;
  let node: Node = start;
  for (;;) {
    if (node.isNamed && node.childCount >= 2) {
      const open = asChar(syntax, node.child(0)!);
      const close = asChar(syntax, node.child(node.childCount - 1)!);
      if (open && close && PAIRS.some(([o, c]) => o === open[1] && c === close[1]) && open[0] <= pos && pos <= close[0]) {
        if (close[0] === pos) return open[0];
        if (traverseParents || open[0] === pos) return close[0];
      }
    }
    const closePair = asClosePair(syntax, node);
    if (closePair) {
      const start = findPairEnd(syntax, node.previousSibling, closePair[0], closePair[1], "backward");
      if (start !== null) return start;
    }
    const openPair = asOpenPair(syntax, node);
    if (openPair) {
      const end = findPairEnd(syntax, node.nextSibling, openPair[0], openPair[1], "forward");
      if (end !== null) return end;
    }
    if (traverseParents) {
      let sibling = node.nextSibling;
      for (let i = 0; sibling && i < MATCH_LIMIT; i++, sibling = sibling.nextSibling) {
        const pair = asClosePair(syntax, sibling);
        if (!pair) continue;
        if (findPairEnd(syntax, sibling.previousSibling, pair[0], pair[1], "backward") !== null) return syntax.posOf(sibling.startByte);
      }
    } else if (node.isNamed) {
      break;
    }
    const parent: Node | null = node.parent;
    if (!parent) break;
    node = parent;
  }
  const leaf = root.namedDescendantForByteRange(posByte, posByte + 1);
  if (!leaf || leaf.childCount !== 0) return null;
  const leafStart = syntax.posOf(leaf.startByte);
  const text = Text.of(doc.sliceString(leafStart, syntax.posOf(leaf.endByte)).split("\n"));
  const found = findMatchingBracketPlaintext(text, pos - leafStart);
  return found === null ? null : found + leafStart;
}
