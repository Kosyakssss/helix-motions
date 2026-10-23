import type { Completion } from "../core/prompt";
import type { Context } from "../core/editor";
import { nextGraphemeBoundary } from "../graphemes";
import { parseUndoKind } from "../history";
import { Selection } from "../selection";
import { refill } from "../core/textwrap";
import { OPTIONS } from "../core/options";
import { apply, changeSetOf, docOf, selOf, setSel } from "./util";
import { earlier, later } from "./misc";
import { yankJoinedTo, paste, replaceSelectionsWithRegister } from "./edit";
import { gotoLineWithoutJumplist } from "./motion";
import { commitHistoryNow, jumplistFor } from "./jumps";

export type PromptEvent = "update" | "validate" | "abort";

export interface TypableCommand {
  name: string;
  aliases: string[];
  doc: string;
  flags?: Record<string, string>;
  fun: (cx: Context, args: Args, event: PromptEvent) => void;
}

export interface Args {
  positional: string[];
  flags: Set<string>;
  raw: string;
}

interface Token {
  start: number;
  contentStart: number;
  content: string;
  quote: string | null;
  terminated: boolean;
}

function scanTokens(input: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i]!)) i++;
    if (i >= input.length) break;
    const start = i;
    const q = input[i]!;
    if (q === "'" || q === '"' || q === "`") {
      let content = "";
      let j = i + 1;
      let terminated = false;
      while (j < input.length) {
        if (input[j] === q) {
          if (input[j + 1] === q) {
            content += q;
            j += 2;
            continue;
          }
          terminated = true;
          j++;
          break;
        }
        content += input[j];
        j++;
      }
      out.push({ start, contentStart: start + 1, content, quote: q, terminated });
      i = j;
      continue;
    }
    let tok = "";
    while (i < input.length && !/\s/.test(input[i]!)) {
      if (input[i] === "\\" && i + 1 < input.length) {
        tok += input[i + 1];
        i += 2;
        continue;
      }
      tok += input[i];
      i++;
    }
    out.push({ start, contentStart: start, content: tok, quote: null, terminated: false });
  }
  return out;
}

export function tokenize(input: string): string[] {
  return scanTokens(input).map((t) => t.content);
}

function parseArgs(raw: string, cmd: TypableCommand): Args {
  const tokens = tokenize(raw);
  const flags = new Set<string>();
  const positional: string[] = [];
  let onlyPositional = false;
  for (const t of tokens) {
    if (!onlyPositional && t === "--") {
      onlyPositional = true;
      continue;
    }
    if (!onlyPositional && cmd.flags && t.startsWith("-")) {
      const name = t.replace(/^--?/, "");
      const full = Object.entries(cmd.flags).find(([long, short]) => long === name || short === name);
      if (full) {
        flags.add(full[0]);
        continue;
      }
    }
    positional.push(t);
  }
  return { positional, flags, raw };
}

function validateOnly(fun: (cx: Context, args: Args) => void): TypableCommand["fun"] {
  return (cx, args, event) => {
    if (event === "validate") fun(cx, args);
  };
}

function characterInfo(cx: Context): void {
  const doc = docOf(cx);
  const start = selOf(cx).primary().cursor(doc);
  const end = nextGraphemeBoundary(doc, start);
  if (start === end) return;
  const g = doc.sliceString(start, end);
  let printable = "";
  for (const c of g) printable += c === "\0" ? "\\0" : c === "\t" ? "\\t" : c === "\n" ? "\\n" : c === "\r" ? "\\r" : c;
  const cps = [...g].map((c) => "U+" + c.codePointAt(0)!.toString(16).padStart(4, "0")).join(" ");
  const bytes = new TextEncoder().encode(g);
  const hex = bytes.length > 1 ? " Hex: " + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(" ") : "";
  const dec = bytes.length === 1 ? ` Dec ${bytes[0]} Hex ${bytes[0]!.toString(16).padStart(2, "0")}` : hex;
  cx.editor.setStatus(`"${printable}" (${cps})${dec}`);
}

function sortCommand(cx: Context, args: Args): void {
  const doc = docOf(cx);
  const sel = selOf(cx);
  if (sel.ranges.length === 1) {
    cx.editor.setError("'sort': Sorting requires multiple selections. Hint: split selection first");
    return;
  }
  const frags = sel.ranges.map((r) => doc.sliceString(r.from(), r.to()));
  const insensitive = args.flags.has("insensitive");
  const reverse = args.flags.has("reverse");
  const key = (s: string) => (insensitive ? s.toLowerCase() : s);
  const cmp = (a: string, b: string) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  frags.sort((a, b) => (reverse ? cmp(b, a) : cmp(a, b)));
  apply(cx, changeSetOf(doc, sel.ranges.map((r, i) => [r.from(), r.to(), frags[i]!])));
  commitHistoryNow(cx.host);
}

let gotoPreview: Selection | null = null;

function gotoLineNumber(cx: Context, args: Args, event: PromptEvent): void {
  const update = () => {
    const n = Number(args.positional[0]);
    if (!Number.isInteger(n) || n <= 0) {
      cx.editor.setError("'goto': invalid line number");
      return false;
    }
    if (gotoPreview === null) gotoPreview = selOf(cx);
    gotoLineWithoutJumplist(cx, n, "move");
    return true;
  };
  if (event === "abort" || (event === "update" && args.positional.length === 0)) {
    if (gotoPreview) setSel(cx, gotoPreview);
    gotoPreview = null;
    return;
  }
  if (event === "update") {
    update();
    return;
  }
  if (!update()) return;
  const last = gotoPreview!;
  gotoPreview = null;
  jumplistFor(cx).push({ docId: cx.host.id, selection: last });
}

function ws(name: string, extra: Partial<TypableCommand> = {}): Pick<TypableCommand, "fun"> & Partial<TypableCommand> {
  return { ...extra, fun: validateOnly((cx, args) => cx.editor.workspaceCommand(cx, name, args.positional)) };
}

const DEFS: (Omit<TypableCommand, "fun"> & { fun: TypableCommand["fun"] })[] = [
  { name: "exit", aliases: ["x", "xit"], doc: "Write changes to disk if the buffer is modified and then quit.", ...ws("write-quit") },
  { name: "exit!", aliases: ["x!", "xit!"], doc: "Force write and quit.", ...ws("write-quit") },
  { name: "quit", aliases: ["q"], doc: "Close the current view.", ...ws("quit") },
  { name: "quit!", aliases: ["q!"], doc: "Force close the current view.", ...ws("quit") },
  { name: "open", aliases: ["o", "edit", "e"], doc: "Open a file from disk into the current view.", ...ws("open") },
  { name: "buffer-close", aliases: ["bc", "bclose"], doc: "Close the current buffer.", ...ws("buffer-close") },
  { name: "buffer-close!", aliases: ["bc!", "bclose!"], doc: "Close the current buffer forcefully.", ...ws("buffer-close") },
  { name: "buffer-close-others", aliases: ["bco", "bcloseother"], doc: "Close all buffers but the focused one.", ...ws("buffer-close-others") },
  { name: "buffer-close-others!", aliases: ["bco!", "bcloseother!"], doc: "Force close all buffers but the focused one.", ...ws("buffer-close-others") },
  { name: "buffer-close-all", aliases: ["bca", "bcloseall"], doc: "Close all buffers without quitting.", ...ws("buffer-close-all") },
  { name: "buffer-close-all!", aliases: ["bca!", "bcloseall!"], doc: "Force close all buffers.", ...ws("buffer-close-all") },
  { name: "buffer-next", aliases: ["bn", "bnext"], doc: "Goto next buffer.", ...ws("goto_next_buffer") },
  { name: "buffer-previous", aliases: ["bp", "bprev"], doc: "Goto previous buffer.", ...ws("goto_previous_buffer") },
  { name: "write", aliases: ["w"], doc: "Write changes to disk.", ...ws("write") },
  { name: "write!", aliases: ["w!"], doc: "Force write changes to disk.", ...ws("write") },
  { name: "write-buffer-close", aliases: ["wbc"], doc: "Write changes and close the buffer.", ...ws("write-buffer-close") },
  { name: "write-buffer-close!", aliases: ["wbc!"], doc: "Force write changes and close the buffer.", ...ws("write-buffer-close") },
  { name: "new", aliases: ["n"], doc: "Create a new scratch buffer.", ...ws("new") },
  { name: "write-quit", aliases: ["wq"], doc: "Write changes and close the view.", ...ws("write-quit") },
  { name: "write-quit!", aliases: ["wq!"], doc: "Write changes and close the view forcefully.", ...ws("write-quit") },
  { name: "write-all", aliases: ["wa"], doc: "Write changes from all buffers.", ...ws("write-all") },
  { name: "write-all!", aliases: ["wa!"], doc: "Forcefully write changes from all buffers.", ...ws("write-all") },
  { name: "write-quit-all", aliases: ["wqa", "xa"], doc: "Write all buffers and close all views.", ...ws("write-quit-all") },
  { name: "write-quit-all!", aliases: ["wqa!", "xa!"], doc: "Forcefully write all buffers and close all views.", ...ws("write-quit-all") },
  { name: "quit-all", aliases: ["qa"], doc: "Close all views.", ...ws("quit-all") },
  { name: "quit-all!", aliases: ["qa!"], doc: "Force close all views.", ...ws("quit-all") },
  { name: "update", aliases: ["u"], doc: "Write changes only if the file has been modified.", ...ws("write") },
  { name: "vsplit", aliases: ["vs"], doc: "Open the file in a vertical split.", ...ws("vsplit") },
  { name: "vsplit-new", aliases: ["vnew"], doc: "Open a scratch buffer in a vertical split.", ...ws("vsplit_new") },
  { name: "hsplit", aliases: ["hs", "sp"], doc: "Open the file in a horizontal split.", ...ws("hsplit") },
  { name: "hsplit-new", aliases: ["hnew"], doc: "Open a scratch buffer in a horizontal split.", ...ws("hsplit_new") },
  { name: "reload", aliases: ["rl"], doc: "Discard changes and reload from the source file.", ...ws("reload") },
  { name: "reload-all", aliases: ["rla"], doc: "Discard changes and reload all documents.", ...ws("reload-all") },
  { name: "move", aliases: ["mv"], doc: "Move the current buffer and its file to a different path.", ...ws("move") },
  { name: "move!", aliases: ["mv!"], doc: "Move the current buffer, creating subdirectories.", ...ws("move") },
  { name: "read", aliases: ["r"], doc: "Load a file into buffer.", ...ws("read") },
  { name: "config-reload", aliases: [], doc: "Refresh user config.", ...ws("config-reload") },
  { name: "config-open", aliases: [], doc: "Open the user config.toml file.", ...ws("config-open") },
  { name: "tutor", aliases: [], doc: "Open the tutorial.", ...ws("tutor") },
  {
    name: "goto",
    aliases: ["g"],
    doc: "Goto line number.",
    fun: gotoLineNumber,
  },
  {
    name: "earlier",
    aliases: ["ear"],
    doc: "Jump back to an earlier point in edit history.",
    fun: validateOnly((cx, args) => {
      let uk;
      try {
        uk = parseUndoKind(args.positional.join(" "));
      } catch (err) {
        cx.editor.setError(`'earlier': ${(err as Error).message}`);
        return;
      }
      if (!earlier(cx, uk)) cx.editor.setStatus("Already at oldest change");
    }),
  },
  {
    name: "later",
    aliases: ["lat"],
    doc: "Jump to a later point in edit history.",
    fun: validateOnly((cx, args) => {
      let uk;
      try {
        uk = parseUndoKind(args.positional.join(" "));
      } catch (err) {
        cx.editor.setError(`'later': ${(err as Error).message}`);
        return;
      }
      if (!later(cx, uk)) cx.editor.setStatus("Already at newest change");
    }),
  },
  {
    name: "yank-join",
    aliases: [],
    doc: "Yank joined selections.",
    fun: validateOnly((cx, args) =>
      yankJoinedTo(cx, args.positional[0] ?? "\n", cx.editor.selectedRegister ?? cx.editor.config.defaultYankRegister),
    ),
  },
  { name: "clipboard-yank", aliases: [], doc: "Yank main selection into system clipboard.", fun: validateOnly((cx) => cx.editor.runStatic(cx, "yank_main_selection_to_clipboard")) },
  { name: "clipboard-yank-join", aliases: [], doc: "Yank joined selections into system clipboard.", fun: validateOnly((cx, args) => yankJoinedTo(cx, args.positional[0] ?? "\n", "+")) },
  { name: "primary-clipboard-yank", aliases: [], doc: "Yank main selection into system primary clipboard.", fun: validateOnly((cx) => cx.editor.runStatic(cx, "yank_main_selection_to_primary_clipboard")) },
  { name: "primary-clipboard-yank-join", aliases: [], doc: "Yank joined selections into system primary clipboard.", fun: validateOnly((cx, args) => yankJoinedTo(cx, args.positional[0] ?? "\n", "*")) },
  { name: "clipboard-paste-after", aliases: [], doc: "Paste system clipboard after selections.", fun: validateOnly((cx) => paste(cx, "+", "after", 1)) },
  { name: "clipboard-paste-before", aliases: [], doc: "Paste system clipboard before selections.", fun: validateOnly((cx) => paste(cx, "+", "before", 1)) },
  { name: "clipboard-paste-replace", aliases: [], doc: "Replace selections with content of system clipboard.", fun: validateOnly((cx) => replaceSelectionsWithRegister(cx, "+", 1)) },
  { name: "primary-clipboard-paste-after", aliases: [], doc: "Paste primary clipboard after selections.", fun: validateOnly((cx) => paste(cx, "*", "after", 1)) },
  { name: "primary-clipboard-paste-before", aliases: [], doc: "Paste primary clipboard before selections.", fun: validateOnly((cx) => paste(cx, "*", "before", 1)) },
  { name: "primary-clipboard-paste-replace", aliases: [], doc: "Replace selections with content of system primary clipboard.", fun: validateOnly((cx) => replaceSelectionsWithRegister(cx, "*", 1)) },
  { name: "character-info", aliases: ["char"], doc: "Get info about the character under the primary cursor.", fun: validateOnly(characterInfo) },
  {
    name: "sort",
    aliases: [],
    doc: "Sort ranges in selection.",
    flags: { reverse: "r", insensitive: "i" },
    fun: validateOnly(sortCommand),
  },
  {
    name: "reflow",
    aliases: [],
    doc: "Hard-wrap the current selection of lines to a given width.",
    fun: validateOnly((cx, args) => {
      const width = args.positional[0] !== undefined ? Number(args.positional[0]) : cx.editor.config.textWidth;
      if (!Number.isInteger(width)) {
        cx.editor.setError("'reflow': invalid digit found in string");
        return;
      }
      const doc = docOf(cx);
      apply(cx, changeSetOf(doc, selOf(cx).ranges.map((r) => [r.from(), r.to(), refill(doc.sliceString(r.from(), r.to()), width)])));
      commitHistoryNow(cx.host);
    }),
  },
  {
    name: "clear-register",
    aliases: [],
    doc: "Clear given register. If no argument is provided, clear all registers.",
    fun: validateOnly((cx, args) => {
      const r = args.positional[0];
      if (r === undefined) {
        cx.editor.registers.clear();
        cx.editor.setStatus("All registers cleared");
        return;
      }
      if ([...r].length !== 1) {
        cx.editor.setError(`'clear-register': Invalid register ${r}`);
        return;
      }
      if (cx.editor.registers.remove(r)) cx.editor.setStatus(`Register ${r} cleared`);
      else cx.editor.setError(`Register ${r} not found`);
    }),
  },
  {
    name: "set-register",
    aliases: [],
    doc: "Set contents of the given register.",
    fun: validateOnly((cx, args) => {
      const [r, v] = args.positional;
      if (r === undefined || v === undefined || [...r].length !== 1) {
        cx.editor.setError(`'set-register': Invalid register ${r ?? ""}`);
        return;
      }
      try {
        cx.editor.registers.write(r, [v]);
      } catch (err) {
        cx.editor.setError(`'set-register': ${(err as Error).message}`);
      }
    }),
  },
  {
    name: "indent-style",
    aliases: [],
    doc: "Set the indentation style for editing. ('t' for tabs or 1-16 for number of spaces.)",
    fun: validateOnly((cx, args) => {
      const a = args.positional[0];
      if (a === undefined) {
        const s = cx.editor.config.indentStyle;
        cx.editor.setStatus(s.kind === "tabs" ? "tabs" : `${s.width} ${s.width === 1 ? "space" : "spaces"}`);
        return;
      }
      if (a === "t" || a === "tabs") cx.editor.config.indentStyle = { kind: "tabs" };
      else if (/^\d+$/.test(a) && Number(a) >= 1 && Number(a) <= 16) cx.editor.config.indentStyle = { kind: "spaces", width: Number(a) };
      else cx.editor.setError("'indent-style': invalid indent style");
    }),
  },
  { name: "set-option", aliases: ["set"], doc: "Set a config option at runtime.", fun: validateOnly((cx, args) => cx.editor.setOption(cx, args.positional)) },
  { name: "toggle-option", aliases: ["toggle"], doc: "Toggle a config option at runtime.", fun: validateOnly((cx, args) => cx.editor.toggleOption(cx, args.positional)) },
  { name: "get-option", aliases: ["get"], doc: "Get the current value of a config option.", fun: validateOnly((cx, args) => cx.editor.getOption(cx, args.positional)) },
  { name: "echo", aliases: [], doc: "Prints the given arguments to the statusline.", fun: validateOnly((cx, args) => cx.editor.setStatus(args.positional.join(" "))) },
  { name: "noop", aliases: [], doc: "Does nothing.", fun: () => {} },
  { name: "redraw", aliases: [], doc: "Clear and re-render the whole UI", fun: validateOnly((cx) => cx.host.view?.requestMeasure()) },
];

export const TYPABLE: TypableCommand[] = DEFS as TypableCommand[];

export const TYPABLE_MAP = new Map<string, TypableCommand>();
for (const cmd of TYPABLE) {
  TYPABLE_MAP.set(cmd.name, cmd);
  for (const a of cmd.aliases) TYPABLE_MAP.set(a, cmd);
}

export function splitCommandLine(input: string): [string, string] {
  const trimmed = input.replace(/^\s+/, "");
  const m = /^(\S*)\s*([\s\S]*)$/.exec(trimmed)!;
  return [m[1]!, m[2]!];
}

export function executeCommandLine(cx: Context, input: string, event: PromptEvent): void {
  const [command, rest] = splitCommandLine(input);
  if (command === "") return;
  if (/^\d+$/.test(command) && rest.trim() === "") {
    const goto = TYPABLE_MAP.get("goto")!;
    goto.fun(cx, parseArgs(command, goto), event);
    return;
  }
  const cmd = TYPABLE_MAP.get(command);
  if (!cmd) {
    if (event === "validate") cx.editor.setError(`no such command: '${command}'`);
    return;
  }
  cmd.fun(cx, parseArgs(rest, cmd), event);
}

const PATH_COMMANDS = new Set(["open", "vsplit", "hsplit", "read", "move", "move!", "write", "write!"]);
const OPTION_COMMANDS = new Set(["set-option", "toggle-option", "get-option"]);

export let pathCompleter: ((prefix: string) => string[]) | null = null;

export function setPathCompleter(fn: ((prefix: string) => string[]) | null): void {
  pathCompleter = fn;
}

function quoteCompletion(token: Token, candidate: string): Completion {
  if (token.quote === null) {
    const text = /[ \t%]/.test(candidate) ? `'${candidate.replace(/'/g, "''")}'` : candidate;
    return { start: token.start, text, label: candidate };
  }
  return { start: token.contentStart, text: candidate.split(token.quote).join(token.quote + token.quote), label: candidate };
}

export function completeCommandLine(input: string): Completion[] {
  const [command, rest] = splitCommandLine(input);
  if (rest !== "" || input.endsWith(" ")) {
    const cmd = TYPABLE_MAP.get(command);
    if (!cmd) return [];
    const tokens = scanTokens(input).slice(1);
    let token = tokens[tokens.length - 1];
    if (!token || (token.quote === null && /\s$/.test(input)) || token.terminated) {
      if (token?.terminated) return [];
      token = { start: input.length, contentStart: input.length, content: "", quote: null, terminated: false };
    }
    const tok = token;
    if (PATH_COMMANDS.has(cmd.name) && pathCompleter) return pathCompleter(tok.content).slice(0, 200).map((c) => quoteCompletion(tok, c));
    if (OPTION_COMMANDS.has(cmd.name) && tokens.length <= 1) {
      return Object.keys(OPTIONS)
        .filter((k) => k.startsWith(tok.content))
        .sort()
        .map((k) => ({ start: tok.start, text: k, label: k }));
    }
    return [];
  }
  const start = input.length - input.replace(/^\s+/, "").length;
  const names = new Set<string>();
  for (const cmd of TYPABLE) {
    if (cmd.name.startsWith(command)) names.add(cmd.name);
    for (const a of cmd.aliases) if (a.startsWith(command)) names.add(cmd.name);
  }
  return [...names].sort().map((n) => ({ start, text: n, label: n }));
}
