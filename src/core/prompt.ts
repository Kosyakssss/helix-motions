import { keyChar } from "../keys";
import type { HelixEditor, PromptRequest } from "./editor";
import type { Host } from "./host";

function graphemes(s: string): string[] {
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)].map((g) => g.segment);
}

function isWordChar(g: string): boolean {
  return /^[\p{Alphabetic}\p{Nd}_]/u.test(g);
}

export interface Completion {
  start: number;
  text: string;
  label: string;
}

export class Prompt {
  line: string;
  cursor: number;
  completions: Completion[] = [];
  selection: number | null = null;
  historyPos: number | null = null;
  private nextCharHandler: ((ch: string) => void) | null = null;
  private original: string | null = null;

  constructor(
    readonly editor: HelixEditor,
    readonly host: Host,
    readonly request: PromptRequest,
  ) {
    this.line = request.initial ?? "";
    this.cursor = this.line.length;
    this.recalculateCompletion();
  }

  get label(): string {
    return this.request.label;
  }

  recalculateCompletion(): void {
    this.completions = this.request.complete ? this.request.complete(this.line) : [];
    this.selection = null;
  }

  private update(): void {
    this.recalculateCompletion();
    this.request.onChange?.(this.line);
  }

  insertStr(s: string): void {
    this.line = this.line.slice(0, this.cursor) + s + this.line.slice(this.cursor);
    this.cursor += s.length;
  }

  private prevBoundary(pos: number): number {
    const gs = graphemes(this.line.slice(0, pos));
    return pos - (gs[gs.length - 1]?.length ?? 0);
  }

  private nextBoundary(pos: number): number {
    const gs = graphemes(this.line.slice(pos));
    return pos + (gs[0]?.length ?? 0);
  }

  private wordBackward(pos: number): number {
    const gs = graphemes(this.line.slice(0, pos));
    let i = gs.length;
    while (i > 0 && !isWordChar(gs[i - 1]!)) i--;
    while (i > 0 && isWordChar(gs[i - 1]!)) i--;
    return gs.slice(0, i).join("").length;
  }

  private wordForward(pos: number): number {
    const gs = graphemes(this.line.slice(pos));
    let i = 0;
    while (i < gs.length && !isWordChar(gs[i]!)) i++;
    while (i < gs.length && isWordChar(gs[i]!)) i++;
    return pos + gs.slice(0, i).join("").length;
  }

  private changeHistory(backward: boolean): void {
    const register = this.request.history;
    if (!register) return;
    const values = this.editor.registers.read(register, this.editor.registerEnv(this.host)) ?? [];
    if (values.length === 0) return;
    if (this.original === null) this.original = this.line;
    let pos = this.historyPos;
    if (backward) pos = pos === null ? 0 : Math.min(values.length - 1, pos + 1);
    else pos = pos === null ? null : pos - 1 < 0 ? null : pos - 1;
    this.historyPos = pos;
    this.line = pos === null ? (this.original ?? "") : values[pos]!;
    this.cursor = this.line.length;
    this.update();
  }

  private changeCompletion(backward: boolean): void {
    if (this.completions.length === 0) return;
    const n = this.completions.length;
    if (this.selection === null) this.selection = backward ? n - 1 : 0;
    else this.selection = backward ? (this.selection + n - 1) % n : (this.selection + 1) % n;
    const item = this.completions[this.selection]!;
    this.line = this.line.slice(0, item.start) + item.text;
    this.cursor = this.line.length;
    this.request.onChange?.(this.line);
  }

  handleKey(key: string): "consumed" | "closed" {
    if (this.nextCharHandler) {
      const handler = this.nextCharHandler;
      this.nextCharHandler = null;
      const ch = keyChar(key);
      if (ch !== null) handler(ch);
      this.update();
      return "consumed";
    }
    switch (key) {
      case "C-c":
      case "esc":
        this.request.onCancel?.();
        return "closed";
      case "A-b":
      case "C-left":
        this.cursor = this.wordBackward(this.cursor);
        return "consumed";
      case "A-f":
      case "C-right":
        this.cursor = this.wordForward(this.cursor);
        return "consumed";
      case "C-b":
      case "left":
        this.cursor = this.prevBoundary(this.cursor);
        return "consumed";
      case "C-f":
      case "right":
        this.cursor = this.nextBoundary(this.cursor);
        return "consumed";
      case "C-e":
      case "end":
        this.cursor = this.line.length;
        return "consumed";
      case "C-a":
      case "home":
        this.cursor = 0;
        return "consumed";
      case "C-w":
      case "A-backspace":
      case "C-backspace": {
        const start = this.wordBackward(this.cursor);
        this.line = this.line.slice(0, start) + this.line.slice(this.cursor);
        this.cursor = start;
        this.update();
        return "consumed";
      }
      case "A-d":
      case "A-del":
      case "C-del": {
        const end = this.wordForward(this.cursor);
        this.line = this.line.slice(0, this.cursor) + this.line.slice(end);
        this.update();
        return "consumed";
      }
      case "C-k":
        this.line = this.line.slice(0, this.cursor);
        this.update();
        return "consumed";
      case "C-u":
        this.line = this.line.slice(this.cursor);
        this.cursor = 0;
        this.update();
        return "consumed";
      case "C-h":
      case "backspace":
      case "S-backspace": {
        const start = this.prevBoundary(this.cursor);
        this.line = this.line.slice(0, start) + this.line.slice(this.cursor);
        this.cursor = start;
        this.update();
        return "consumed";
      }
      case "C-d":
      case "del": {
        const end = this.nextBoundary(this.cursor);
        this.line = this.line.slice(0, this.cursor) + this.line.slice(end);
        this.update();
        return "consumed";
      }
      case "C-s": {
        const word = this.request.wordUnderCursor?.() ?? "";
        if (word !== "") {
          this.insertStr(word);
          this.update();
        }
        return "consumed";
      }
      case "ret": {
        const register = this.request.history;
        const lastItem = register ? (this.editor.registers.first(register, this.editor.registerEnv(this.host)) ?? "") : "";
        let input: string;
        if (this.line === "") {
          input = lastItem;
        } else {
          if (lastItem !== this.line && register) {
            try {
              this.editor.registers.push(register, this.line);
            } catch (err) {
              this.editor.setError((err as Error).message);
            }
          }
          input = this.line;
        }
        this.request.onAccept(input);
        return "closed";
      }
      case "C-p":
      case "up":
        this.changeHistory(true);
        return "consumed";
      case "C-n":
      case "down":
        this.changeHistory(false);
        return "consumed";
      case "tab":
        this.changeCompletion(false);
        return "consumed";
      case "S-tab":
        this.changeCompletion(true);
        return "consumed";
      case "C-q":
        this.selection = null;
        return "consumed";
      case "C-r":
        this.nextCharHandler = (ch) => {
          this.insertStr(this.editor.registers.first(ch, this.editor.registerEnv(this.host)) ?? "");
        };
        return "consumed";
    }
    const ch = keyChar(key);
    if (ch !== null) {
      this.insertStr(ch);
      this.update();
    }
    return "consumed";
  }
}
