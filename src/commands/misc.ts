import type { Context } from "../core/editor";
import { historyApply, jumpTo, earlierTarget, laterTarget, redoStep, setHistoryCurrent, undoStep, lastEditPos, type Step, type UndoKind } from "../history";
import { nextGraphemeBoundary, prevGraphemeBoundary } from "../graphemes";
import { wordMove } from "../movement";
import { Range, Selection } from "../selection";
import { charAt, charBefore, charIsWord, isWhitespace, lineIndex, lineStart } from "../core/text";
import { helixField, historyField, helixOwned, setHelix, toNative } from "../state";
import { Transaction } from "@codemirror/state";
import { commitHistoryNow, pushJump } from "./jumps";
import { docOf, modeOf, selOf, setSel } from "./util";
import type { CommandFn } from "./motion";

function applySteps(cx: Context, steps: Step[], current: number): boolean {
  const host = cx.host;
  let success = false;
  for (const step of steps) {
    const value = host.state.field(helixField);
    const newDoc = step.changes.apply(host.state.doc);
    const sel = (step.selection ?? value.selection.map(step.changes)).ensureInvariants(newDoc);
    const next = { ...value, selection: sel };
    host.dispatch({
      changes: step.changes,
      selection: toNative(next, newDoc),
      effects: [setHelix.of(next), historyApply.of(null)],
      annotations: [helixOwned.of(true), Transaction.addToHistory.of(false), Transaction.userEvent.of("undo")],
      scrollIntoView: true,
    });
    success = true;
  }
  host.dispatch({ effects: setHistoryCurrent.of(current) });
  return success;
}

export function undo(cx: Context): void {
  const count = cx.count();
  for (let i = 0; i < count; i++) {
    commitHistoryNow(cx.host);
    const step = undoStep(cx.host.state.field(historyField));
    if (!step) {
      cx.editor.setStatus("Already at oldest change");
      break;
    }
    applySteps(cx, [step.step], step.current);
  }
}

export function redo(cx: Context): void {
  const count = cx.count();
  for (let i = 0; i < count; i++) {
    if (cx.host.state.field(historyField).pending) {
      cx.editor.setStatus("Already at newest change");
      break;
    }
    const step = redoStep(cx.host.state.field(historyField));
    if (!step) {
      cx.editor.setStatus("Already at newest change");
      break;
    }
    applySteps(cx, [step.step], step.current);
  }
}

export function earlier(cx: Context, uk: UndoKind): boolean {
  commitHistoryNow(cx.host);
  const value = cx.host.state.field(historyField);
  const target = earlierTarget(value, uk);
  const steps = jumpTo(value, target);
  return applySteps(cx, steps, target);
}

export function later(cx: Context, uk: UndoKind): boolean {
  const value = cx.host.state.field(historyField);
  if (value.pending) return false;
  const target = laterTarget(value, uk);
  const steps = jumpTo(value, target);
  return applySteps(cx, steps, target);
}

function gotoLastModification(cx: Context): void {
  const pos = lastEditPos(cx.host.state.field(historyField));
  if (pos === null) return;
  const doc = docOf(cx);
  const isSelect = modeOf(cx) === "select";
  const sel = selOf(cx).transform((r) => r.putCursor(doc, Math.min(pos, doc.length), isSelect));
  pushJump(cx);
  setSel(cx, sel);
}

function graphemeAllWord(doc: ReturnType<typeof docOf>, from: number, to: number): boolean {
  for (const ch of doc.sliceString(from, to)) if (!charIsWord(ch)) return false;
  return true;
}

function jumpToWord(cx: Context, behaviour: "move" | "extend"): void {
  const alphabet = cx.editor.config.jumpLabelAlphabet;
  if (alphabet.length === 0) return;
  const limit = alphabet.length * alphabet.length;
  const doc = docOf(cx);
  const [visibleFrom, visibleTo] = cx.editor.visibleRange(cx.host);
  const start = lineStart(doc, lineIndex(doc, visibleFrom));
  const end = lineStart(doc, lineIndex(doc, visibleTo) + 1);
  const primary = selOf(cx).primary();
  const cursor = primary.cursor(doc);
  let fwd = Range.point(cursor);
  let rev = Range.point(cursor);
  const here = charAt(doc, cursor);
  if (here !== null && !isWhitespace(here)) {
    const wordEnd = wordMove(doc, fwd, 1, "nextWordEnd");
    if (wordEnd.anchor === cursor) fwd = wordEnd;
    const wordStart = wordMove(doc, rev, 1, "prevWordStart");
    if (wordStart.anchor === nextGraphemeBoundary(doc, cursor)) rev = wordStart;
  }
  const words: Range[] = [];
  outer: for (;;) {
    let changed = false;
    while (fwd.head < end) {
      fwd = wordMove(doc, fwd, 1, "nextWordEnd");
      const g1 = prevGraphemeBoundary(doc, fwd.head);
      const g0 = prevGraphemeBoundary(doc, g1);
      const add = g0 < g1 && g1 < fwd.head && graphemeAllWord(doc, g0, fwd.head);
      if (!add) continue;
      changed = true;
      let anchor = fwd.anchor;
      while (anchor < doc.length) {
        const ch = charAt(doc, anchor)!;
        if (charIsWord(ch)) break;
        anchor += ch.length;
      }
      fwd = new Range(anchor, fwd.head);
      words.push(fwd);
      if (words.length === limit) break outer;
      break;
    }
    while (rev.head > start) {
      rev = wordMove(doc, rev, 1, "prevWordStart");
      const g1 = nextGraphemeBoundary(doc, rev.head);
      const g2 = nextGraphemeBoundary(doc, g1);
      const add = g2 > g1 && g1 > rev.head && graphemeAllWord(doc, rev.head, g2);
      if (!add) continue;
      changed = true;
      let anchor = rev.anchor;
      while (anchor > 0) {
        const ch = charBefore(doc, anchor)!;
        if (charIsWord(ch)) break;
        anchor -= ch.length;
      }
      rev = new Range(anchor, rev.head);
      words.push(rev);
      if (words.length === limit) break outer;
      break;
    }
    if (!changed) break;
  }
  jumpToLabel(cx, words, behaviour);
}

function jumpToLabel(cx: Context, labels: Range[], behaviour: "move" | "extend"): void {
  const alphabet = cx.editor.config.jumpLabelAlphabet;
  if (labels.length === 0) return;
  const doc = docOf(cx);
  const overlays: { pos: number; text: string }[] = [];
  labels.forEach((range, i) => {
    overlays.push({ pos: range.from(), text: alphabet[Math.floor(i / alphabet.length)]! });
    overlays.push({ pos: nextGraphemeBoundary(doc, range.from()), text: alphabet[i % alphabet.length]! });
  });
  overlays.sort((a, b) => a.pos - b.pos);
  cx.editor.setJumpLabels(cx.host, overlays);
  const primary = selOf(cx).primary();
  cx.onNextKey((cx, key) => {
    const ch = plainChar(key);
    const i = ch === null ? -1 : alphabet.indexOf(ch);
    if (i < 0) {
      cx.editor.setJumpLabels(cx.host, []);
      return;
    }
    const outer = i * alphabet.length;
    if (outer > labels.length) {
      cx.editor.setJumpLabels(cx.host, []);
      return;
    }
    cx.onNextKey((cx, key) => {
      cx.editor.setJumpLabels(cx.host, []);
      const ch = plainChar(key);
      const inner = ch === null ? -1 : alphabet.indexOf(ch);
      if (inner < 0) return;
      let range = labels[outer + inner];
      if (!range) return;
      if (behaviour === "extend") {
        let anchor: number;
        if (range.anchor < range.head) anchor = range.anchor < primary.from() ? range.anchor : primary.from();
        else anchor = range.anchor > primary.to() ? range.anchor : primary.to();
        range = new Range(anchor, range.head);
      } else {
        range = range.withDirection("forward");
      }
      pushJump(cx);
      setSel(cx, new Selection([range], 0));
    });
  });
}

function plainChar(key: string): string | null {
  if ([...key].length === 1) return key;
  if (key === "space") return " ";
  if (key === "minus") return "-";
  if (key === "lt") return "<";
  if (key === "gt") return ">";
  return null;
}

function workspace(name: string): CommandFn {
  return (cx) => cx.editor.workspaceCommand(cx, name);
}

export const miscCommands: Record<string, CommandFn> = {
  no_op: () => {},
  undo,
  redo,
  earlier: (cx) => {
    const count = cx.count();
    for (let i = 0; i < count; i++) {
      if (!earlier(cx, { kind: "steps", n: 1 })) {
        cx.editor.setStatus("Already at oldest change");
        break;
      }
    }
  },
  later: (cx) => {
    const count = cx.count();
    for (let i = 0; i < count; i++) {
      if (!later(cx, { kind: "steps", n: 1 })) {
        cx.editor.setStatus("Already at newest change");
        break;
      }
    }
  },
  goto_last_modification: gotoLastModification,
  goto_word: (cx) => jumpToWord(cx, "move"),
  extend_to_word: (cx) => jumpToWord(cx, "extend"),
  command_mode: (cx) => cx.editor.commandMode(cx),
  page_up: (cx) => cx.editor.scroll(cx, "page", "backward", false),
  page_down: (cx) => cx.editor.scroll(cx, "page", "forward", false),
  half_page_up: (cx) => cx.editor.scroll(cx, "half", "backward", false),
  half_page_down: (cx) => cx.editor.scroll(cx, "half", "forward", false),
  page_cursor_up: (cx) => cx.editor.scroll(cx, "page", "backward", true),
  page_cursor_down: (cx) => cx.editor.scroll(cx, "page", "forward", true),
  page_cursor_half_up: (cx) => cx.editor.scroll(cx, "half", "backward", true),
  page_cursor_half_down: (cx) => cx.editor.scroll(cx, "half", "forward", true),
  scroll_up: (cx) => cx.editor.scroll(cx, cx.count(), "backward", false),
  scroll_down: (cx) => cx.editor.scroll(cx, cx.count(), "forward", false),
  align_view_top: (cx) => cx.editor.alignView(cx, "top"),
  align_view_center: (cx) => cx.editor.alignView(cx, "center"),
  align_view_bottom: (cx) => cx.editor.alignView(cx, "bottom"),
  align_view_middle: () => {},
  goto_window_top: (cx) => cx.editor.gotoWindow(cx, "top"),
  goto_window_center: (cx) => cx.editor.gotoWindow(cx, "center"),
  goto_window_bottom: (cx) => cx.editor.gotoWindow(cx, "bottom"),
  toggle_comments: (cx) => cx.editor.runComments(cx, "toggle"),
  toggle_line_comments: (cx) => cx.editor.runComments(cx, "line"),
  toggle_block_comments: (cx) => cx.editor.runComments(cx, "block"),
  file_picker: workspace("file_picker"),
  file_picker_in_current_directory: workspace("file_picker"),
  file_picker_in_current_buffer_directory: workspace("file_picker_in_current_buffer_directory"),
  file_explorer: workspace("file_explorer"),
  file_explorer_in_current_directory: workspace("file_explorer"),
  file_explorer_in_current_buffer_directory: workspace("file_explorer_in_current_buffer_directory"),
  buffer_picker: workspace("buffer_picker"),
  jumplist_picker: workspace("jumplist_picker"),
  last_picker: workspace("last_picker"),
  symbol_picker: workspace("symbol_picker"),
  syntax_symbol_picker: workspace("symbol_picker"),
  lsp_or_syntax_symbol_picker: workspace("symbol_picker"),
  workspace_symbol_picker: workspace("workspace_symbol_picker"),
  syntax_workspace_symbol_picker: workspace("workspace_symbol_picker"),
  lsp_or_syntax_workspace_symbol_picker: workspace("workspace_symbol_picker"),
  command_palette: workspace("command_palette"),
  code_action: workspace("code_action"),
  diagnostics_picker: workspace("diagnostics_picker"),
  workspace_diagnostics_picker: workspace("workspace_diagnostics_picker"),
  goto_first_diag: workspace("goto_first_diag"),
  goto_last_diag: workspace("goto_last_diag"),
  goto_next_diag: workspace("goto_next_diag"),
  goto_prev_diag: workspace("goto_prev_diag"),
  global_search: workspace("global_search"),
  goto_file: workspace("goto_file"),
  goto_file_hsplit: workspace("goto_file_hsplit"),
  goto_file_vsplit: workspace("goto_file_vsplit"),
  goto_definition: workspace("goto_definition"),
  goto_reference: workspace("goto_reference"),
  hover: workspace("hover"),
  rename_symbol: workspace("rename_symbol"),
  goto_last_accessed_file: workspace("goto_last_accessed_file"),
  goto_last_modified_file: workspace("goto_last_modified_file"),
  goto_next_buffer: workspace("goto_next_buffer"),
  goto_previous_buffer: workspace("goto_previous_buffer"),
  jump_view_left: workspace("jump_view_left"),
  jump_view_right: workspace("jump_view_right"),
  jump_view_up: workspace("jump_view_up"),
  jump_view_down: workspace("jump_view_down"),
  swap_view_left: workspace("swap_view_left"),
  swap_view_right: workspace("swap_view_right"),
  swap_view_up: workspace("swap_view_up"),
  swap_view_down: workspace("swap_view_down"),
  rotate_view: workspace("rotate_view"),
  rotate_view_reverse: workspace("rotate_view_reverse"),
  hsplit: workspace("hsplit"),
  vsplit: workspace("vsplit"),
  hsplit_new: workspace("hsplit_new"),
  vsplit_new: workspace("vsplit_new"),
  wclose: workspace("wclose"),
  wonly: workspace("wonly"),
};

export const UNSUPPORTED = [
  "move_parent_node_end",
  "move_parent_node_start",
  "extend_parent_node_end",
  "extend_parent_node_start",
  "expand_selection",
  "shrink_selection",
  "select_next_sibling",
  "select_prev_sibling",
  "select_all_siblings",
  "select_all_children",
  "goto_next_function",
  "goto_prev_function",
  "goto_next_class",
  "goto_prev_class",
  "goto_next_parameter",
  "goto_prev_parameter",
  "goto_next_comment",
  "goto_prev_comment",
  "goto_next_test",
  "goto_prev_test",
  "goto_next_xml_element",
  "goto_prev_xml_element",
  "goto_next_entry",
  "goto_prev_entry",
  "goto_next_change",
  "goto_prev_change",
  "goto_first_change",
  "goto_last_change",
  "goto_declaration",
  "goto_type_definition",
  "goto_implementation",
  "changed_file_picker",
  "select_references_to_symbol_under_cursor",
  "signature_help",
  "completion",
  "format_selections",
  "goto_next_tabstop",
  "goto_prev_tabstop",
  "transpose_view",
  "shell_pipe",
  "shell_pipe_to",
  "shell_insert_output",
  "shell_append_output",
  "shell_keep_pipe",
  "suspend",
  "dap_launch",
  "dap_restart",
  "dap_toggle_breakpoint",
  "dap_continue",
  "dap_pause",
  "dap_step_in",
  "dap_step_out",
  "dap_next",
  "dap_variables",
  "dap_terminate",
  "dap_edit_condition",
  "dap_edit_log",
  "dap_switch_thread",
  "dap_switch_stack_frame",
  "dap_enable_exceptions",
  "dap_disable_exceptions",
];
