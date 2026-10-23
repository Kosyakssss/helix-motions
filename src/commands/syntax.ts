import type { Context } from "../core/editor";
import { Range, type Direction, type Selection } from "../selection";
import {
  expandSelection,
  moveParentNodeEnd,
  selectAllChildren,
  selectAllSiblings,
  selectNextSibling,
  selectPrevSibling,
  shrinkSelection,
} from "../syntax/object";
import type { Syntax } from "../syntax/syntax";
import { applyMotion, type CommandFn } from "./motion";
import { pushJump } from "./jumps";
import { docOf, modeOf, selOf, setSel, syntaxOf } from "./util";

function contains(superSet: Selection, subSet: Selection): boolean {
  const supers = superSet.ranges;
  const subs = subSet.ranges;
  let i = 0;
  let j = 0;
  for (;;) {
    const a = supers[i];
    const b = subs[j];
    if (!b) return true;
    if (!a) return false;
    if (a.to() <= b.from() && a.from() !== b.from()) {
      i++;
    } else if (a.from() <= b.from() && b.to() <= a.to()) {
      j++;
    } else {
      return false;
    }
  }
}

function expand(cx: Context): void {
  applyMotion(cx, (cx) => {
    const syntax = syntaxOf(cx);
    if (!syntax) return;
    const current = selOf(cx);
    const next = expandSelection(syntax, current);
    if (!current.eq(next)) {
      cx.editor.objectSelections(cx.host).push(current);
      setSel(cx, next);
    }
  });
}

function shrink(cx: Context): void {
  applyMotion(cx, (cx) => {
    const stack = cx.editor.objectSelections(cx.host);
    const current = selOf(cx);
    const prev = stack.pop();
    if (prev) {
      if (contains(current, prev)) {
        setSel(cx, prev);
        return;
      }
      stack.length = 0;
    }
    const syntax = syntaxOf(cx);
    if (syntax) setSel(cx, shrinkSelection(syntax, current));
  });
}

function selectWith(f: (syntax: Syntax, selection: Selection) => Selection): CommandFn {
  return (cx) =>
    applyMotion(cx, (cx) => {
      const syntax = syntaxOf(cx);
      if (syntax) setSel(cx, f(syntax, selOf(cx)));
    });
}

function moveNodeBound(dir: Direction, movement: "move" | "extend"): CommandFn {
  return (cx) =>
    applyMotion(cx, (cx) => {
      const syntax = syntaxOf(cx);
      if (syntax) setSel(cx, moveParentNodeEnd(syntax, docOf(cx), selOf(cx), dir, movement));
    });
}

function gotoTsObject(dir: Direction): CommandFn {
  return (cx) =>
    applyMotion(cx, (cx) => {
      if (!syntaxOf(cx)) {
        cx.editor.setStatus("Syntax-tree is not available in current buffer");
        return;
      }
      const isSelect = modeOf(cx) === "select";
      const selection = selOf(cx).transform((range) => {
        if (!isSelect) return range.withDirection(dir);
        return new Range(range.anchor, range.head < range.anchor ? range.anchor : range.head);
      });
      pushJump(cx);
      setSel(cx, selection);
    });
}

export const syntaxCommands: Record<string, CommandFn> = {
  expand_selection: expand,
  shrink_selection: shrink,
  select_next_sibling: selectWith(selectNextSibling),
  select_prev_sibling: selectWith(selectPrevSibling),
  select_all_siblings: selectWith(selectAllSiblings),
  select_all_children: selectWith(selectAllChildren),
  move_parent_node_end: moveNodeBound("forward", "move"),
  move_parent_node_start: moveNodeBound("backward", "move"),
  extend_parent_node_end: moveNodeBound("forward", "extend"),
  extend_parent_node_start: moveNodeBound("backward", "extend"),
  goto_next_function: gotoTsObject("forward"),
  goto_prev_function: gotoTsObject("backward"),
  goto_next_class: gotoTsObject("forward"),
  goto_prev_class: gotoTsObject("backward"),
  goto_next_parameter: gotoTsObject("forward"),
  goto_prev_parameter: gotoTsObject("backward"),
  goto_next_comment: gotoTsObject("forward"),
  goto_prev_comment: gotoTsObject("backward"),
  goto_next_test: gotoTsObject("forward"),
  goto_prev_test: gotoTsObject("backward"),
  goto_next_xml_element: gotoTsObject("forward"),
  goto_prev_xml_element: gotoTsObject("backward"),
  goto_next_entry: gotoTsObject("forward"),
  goto_prev_entry: gotoTsObject("backward"),
};
