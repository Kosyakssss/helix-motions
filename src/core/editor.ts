import { keyChar, keySequenceFormat, parseMacro } from "../keys";
import { Keymaps, type KeymapResult, type MappableCommand, type TrieNode } from "../keymap/trie";
import { MemoryClipboard, Registers, type RegisterEnv } from "../registers";
import { defaultConfig, type Config } from "../config";
import { doc, mode, selection, type Host } from "./host";
import { executeCommand, runTypable, STATIC_COMMANDS } from "../commands";
import { Prompt } from "./prompt";
import { commitHistoryNow, JumpList, type Jump } from "../commands/jumps";
import { completeCommandLine, executeCommandLine } from "../commands/typed";
import { setSel } from "../commands/util";
import { getOption, setOption, toggleOption } from "./options";
import { runComments, type CommentTokens } from "../commands/comments";

export type OnKeyCallback = (cx: Context, key: string) => void;
export type OnKeyKind = "pseudoPending" | "fallback";

export interface Status {
  message: string;
  severity: "info" | "error";
}

export class Context {
  onNextKeyCallback: { cb: OnKeyCallback; kind: OnKeyKind } | null = null;
  readonly callbacks: (() => void)[] = [];
  constructor(
    readonly editor: HelixEditor,
    readonly host: Host,
    public countRaw: number | null,
    public register: string | null,
  ) {}

  count(): number {
    return this.countRaw ?? 1;
  }

  onNextKey(cb: OnKeyCallback, kind: OnKeyKind = "pseudoPending"): void {
    this.onNextKeyCallback = { cb, kind };
  }
}

export interface HandleKeyOptions {
  nativeInsert?: boolean;
  passThrough?: (key: string) => boolean;
}

export interface PromptRequest {
  label: string;
  initial?: string;
  history?: string;
  complete?: (input: string) => string[];
  onChange?: (input: string) => void;
  onAccept: (input: string) => void;
  onCancel?: () => void;
  wordUnderCursor?: () => string;
}

export interface JumpLabel {
  pos: number;
  text: string;
}

export interface UiHooks {
  notify?(status: Status): void;
  render?(host: Host): void;
  promptChanged?(host: Host, prompt: Prompt | null): void;
  jumpLabels?(host: Host, labels: JumpLabel[]): void;
}

export interface Workspace {
  run(cx: Context, name: string, args: string[]): void;
  openJump?(cx: Context, jump: Jump): void;
}

export interface ViewOps {
  scroll(cx: Context, amount: number | "page" | "half", dir: "forward" | "backward", syncCursor: boolean): void;
  alignView(cx: Context, align: "top" | "center" | "bottom"): void;
  gotoWindow(cx: Context, align: "top" | "center" | "bottom"): void;
  visibleRange(host: Host): [number, number];
}

export class HelixEditor {
  keymaps: Keymaps;
  registers: Registers;
  config: Config;
  count: number | null = null;
  selectedRegister: string | null = null;
  onNextKeyState: { cb: OnKeyCallback; kind: OnKeyKind } | null = null;
  pseudoPending: string[] = [];
  lastInsert: { command: MappableCommand; keys: string[] } = {
    command: { kind: "static", name: "normal_mode" },
    keys: [],
  };
  macroRecording: { register: string; keys: string[] } | null = null;
  macroReplaying: string[] = [];
  lastMotion: ((cx: Context) => void) | null = null;
  status: Status | null = null;
  autoinfo: TrieNode | { title: string; body: [string, string][] } | null = null;
  ui: UiHooks = {};
  workspace: Workspace | null = null;
  viewOps: ViewOps | null = null;
  activePrompt: Prompt | null = null;
  visualLines = false;
  helixAutoPairs = true;
  continueLists = false;
  jumpLabels = new Map<string, JumpLabel[]>();
  commentTokens: ((host: Host, pos: number) => CommentTokens) | null = null;
  onConfigChanged: (() => void) | null = null;
  replayKeyHook: ((host: Host, key: string) => boolean) | null = null;
  onNextKeyCleanup: (() => void)[] = [];
  private jumplists = new Map<string, JumpList>();

  constructor(keymaps: Keymaps, config: Config = defaultConfig()) {
    this.keymaps = keymaps;
    this.config = config;
    this.registers = new Registers(new MemoryClipboard());
  }

  setStatus(message: string): void {
    this.status = { message, severity: "info" };
    this.ui.notify?.(this.status);
  }

  setError(message: string): void {
    this.status = { message, severity: "error" };
    this.ui.notify?.(this.status);
  }

  keyChar(key: string): string | null {
    try {
      return keyChar(key);
    } catch {
      return null;
    }
  }

  parseMacro(keys: string): string[] {
    return parseMacro(keys);
  }

  registerEnv(host: Host): RegisterEnv {
    return {
      selectionCount: () => selection(host).ranges.length,
      selectionFragments: () => selection(host).ranges.map((r) => doc(host).sliceString(r.from(), r.to())),
      documentName: () => host.name,
    };
  }

  autoinfoRegisters(title: string): void {
    this.autoinfo = { title, body: this.registers.preview() };
  }

  jumplist(host: Host): JumpList {
    const key = host.paneId;
    let list = this.jumplists.get(key);
    if (!list) {
      list = new JumpList({ docId: host.id, selection: selection(host) });
      this.jumplists.set(key, list);
    }
    return list;
  }

  docChanged(host: Host, changes: import("@codemirror/state").ChangeDesc): void {
    for (const list of this.jumplists.values()) list.map(host.id, changes);
  }

  resetJumplists(): void {
    this.jumplists.clear();
  }

  allJumplists(): Iterable<JumpList> {
    return this.jumplists.values();
  }

  jumpTo(cx: Context, jump: Jump): void {
    if (jump.docId === cx.host.id) {
      setSel(cx, jump.selection);
      return;
    }
    if (this.workspace?.openJump) this.workspace.openJump(cx, jump);
  }

  runStatic(cx: Context, name: string): void {
    executeCommand(cx, { kind: "static", name });
  }

  workspaceCommand(cx: Context, name: string, args: string[] = []): void {
    if (this.workspace) this.workspace.run(cx, name, args);
    else this.setStatus(`${name} needs Obsidian`);
  }

  scroll(cx: Context, amount: number | "page" | "half", dir: "forward" | "backward", sync: boolean): void {
    this.viewOps?.scroll(cx, amount, dir, sync);
  }

  alignView(cx: Context, align: "top" | "center" | "bottom"): void {
    this.viewOps?.alignView(cx, align);
  }

  gotoWindow(cx: Context, align: "top" | "center" | "bottom"): void {
    this.viewOps?.gotoWindow(cx, align);
  }

  visibleRange(host: Host): [number, number] {
    return this.viewOps?.visibleRange(host) ?? [0, host.state.doc.length];
  }

  setJumpLabels(host: Host, labels: JumpLabel[]): void {
    if (labels.length === 0) this.jumpLabels.delete(host.id);
    else this.jumpLabels.set(host.id, labels);
    this.ui.jumpLabels?.(host, labels);
  }

  runComments(cx: Context, kind: "toggle" | "line" | "block"): void {
    runComments(cx, kind);
  }

  setOption(cx: Context, args: string[]): void {
    setOption(this, args);
    void cx;
  }

  toggleOption(cx: Context, args: string[]): void {
    toggleOption(this, args);
    void cx;
  }

  getOption(cx: Context, args: string[]): void {
    getOption(this, args);
    void cx;
  }

  prompt(cx: Context, request: PromptRequest): void {
    this.activePrompt = new Prompt(this, cx.host, request);
    this.ui.promptChanged?.(cx.host, this.activePrompt);
  }

  commandMode(cx: Context): void {
    const host = cx.host;
    const fresh = () => new Context(this, host, null, null);
    this.prompt(cx, {
      label: ":",
      history: ":",
      complete: completeCommandLine,
      onChange: (input) => executeCommandLine(fresh(), input, "update"),
      onAccept: (input) => executeCommandLine(fresh(), input, "validate"),
      onCancel: () => executeCommandLine(fresh(), "", "abort"),
    });
  }

  handleKey(host: Host, key: string, options: HandleKeyOptions = {}): boolean {
    if (this.onNextKeyCleanup.length > 0) {
      const cleanups = this.onNextKeyCleanup;
      this.onNextKeyCleanup = [];
      for (const fn of cleanups) fn();
    }
    if (this.macroRecording && this.macroReplaying.length === 0) {
      this.macroRecording.keys.push(key);
    }
    if (this.activePrompt) {
      const prompt = this.activePrompt;
      const result = prompt.handleKey(key);
      if (result === "closed" && this.activePrompt === prompt) {
        this.activePrompt = null;
      }
      this.ui.promptChanged?.(host, this.activePrompt);
      this.ui.render?.(host);
      return true;
    }
    const cx = new Context(this, host, null, null);
    this.status = null;
    const currentMode = mode(host);
    let consumed = true;
    if (!this.onNextKey("pseudoPending", cx, key)) {
      if (currentMode === "insert") {
        consumed = this.insertMode(cx, key, options);
        this.lastInsert.keys.push(key);
      } else {
        this.commandMode_(currentMode, cx, key);
      }
    }
    this.onNextKeyState = cx.onNextKeyCallback;
    if (this.onNextKeyState?.kind === "pseudoPending") this.pseudoPending.push(key);
    else this.pseudoPending = [];
    if (mode(host) !== "insert") commitHistoryNow(host);
    for (const callback of cx.callbacks) callback();
    this.ui.render?.(host);
    return consumed;
  }

  feedKeys(host: Host, keys: string, options: HandleKeyOptions = {}): void {
    for (const key of parseMacro(keys)) this.handleKey(host, key, options);
  }

  pendingDisplay(): string {
    return [...this.pseudoPending, ...this.keymaps.pending()].map(keySequenceFormat).join("");
  }

  private onNextKey(kind: OnKeyKind, cx: Context, key: string): boolean {
    const state = this.onNextKeyState;
    if (!state) return false;
    this.onNextKeyState = null;
    if (state.kind === kind) {
      state.cb(cx, key);
      return true;
    }
    this.onNextKeyState = state;
    return false;
  }

  private handleKeymapEvent(m: "normal" | "select" | "insert", cx: Context, key: string): KeymapResult | null {
    let lastMode = m;
    this.pseudoPending.push(...this.keymaps.pending());
    const result = this.keymaps.get(m, key);
    this.autoinfo = this.keymaps.sticky;
    const execute = (command: MappableCommand) => {
      executeCommand(cx, command);
      const current = mode(cx.host);
      if (current !== lastMode && current === "insert") {
        this.lastInsert = { command, keys: [] };
      }
      lastMode = current;
    };
    switch (result.kind) {
      case "matched":
        execute(result.command);
        return null;
      case "pending":
        this.autoinfo = result.node;
        return null;
      case "matchedSequence":
        for (const command of result.commands) execute(command);
        return null;
      default:
        return result;
    }
  }

  private insertMode(cx: Context, key: string, options: HandleKeyOptions): boolean {
    if (options.passThrough?.(key) && this.keymaps.pending().length === 0 && !this.onNextKeyState) return false;
    const result = this.handleKeymapEvent("insert", cx, key);
    if (!result) return true;
    if (result.kind === "notFound") {
      if (this.onNextKey("fallback", cx, key)) return true;
      const ch = this.keyChar(key);
      if (ch === null || options.nativeInsert) return false;
      this.insertChar(cx, ch);
      return true;
    }
    if (result.kind === "cancelled") {
      for (const ev of result.keys) {
        const ch = this.keyChar(ev);
        if (ch !== null) {
          this.insertChar(cx, ch);
        } else {
          const again = this.keymaps.get("insert", ev);
          if (again.kind === "matched") executeCommand(cx, again.command);
        }
      }
      return true;
    }
    return true;
  }

  insertChar(cx: Context, ch: string): void {
    executeCommand(cx, { kind: "static", name: "__insert_char" }, ch);
  }

  private commandMode_(m: "normal" | "select", cx: Context, key: string): void {
    const digit = /^[0-9]$/.test(key) ? Number(key) : null;
    if (digit !== null && this.count !== null) {
      const count = this.count * 10 + digit;
      if (count > 100_000_000) return;
      this.count = count;
      return;
    }
    if (digit !== null && digit > 0 && this.count === null && !this.keymaps.containsKey(m, key)) {
      this.count = digit;
      return;
    }
    if (key === "." && this.keymaps.pending().length === 0) {
      const times = this.count ?? 1;
      for (let i = 0; i < times; i++) {
        executeCommand(cx, this.lastInsert.command);
        for (const k of [...this.lastInsert.keys]) {
          if (this.replayKeyHook?.(cx.host, k)) continue;
          this.insertMode(cx, k, {});
        }
      }
      this.count = null;
      return;
    }
    cx.countRaw = this.count;
    cx.register = this.selectedRegister;
    this.selectedRegister = null;
    const result = this.handleKeymapEvent(m, cx, key);
    if (result?.kind === "notFound") this.onNextKey("fallback", cx, key);
    if (this.keymaps.pending().length === 0) this.count = null;
    else {
      this.selectedRegister = cx.register;
      cx.register = null;
    }
  }

  runTypable(cx: Context, input: string): void {
    runTypable(cx, input);
  }

  hasCommand(name: string): boolean {
    return name in STATIC_COMMANDS;
  }
}
