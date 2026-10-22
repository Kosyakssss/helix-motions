export type ClipboardType = "clipboard" | "selection";

export interface ClipboardProvider {
  name(): string;
  get(type: ClipboardType): string;
  set(contents: string, type: ClipboardType): void;
}

export class MemoryClipboard implements ClipboardProvider {
  private contents: Record<ClipboardType, string> = { clipboard: "", selection: "" };
  constructor(private readonly hasPrimary: boolean = false) {}
  name(): string {
    return "memory";
  }
  get(type: ClipboardType): string {
    if (type === "selection" && !this.hasPrimary) return "";
    return this.contents[type];
  }
  set(contents: string, type: ClipboardType): void {
    if (type === "selection" && !this.hasPrimary) return;
    this.contents[type] = contents;
  }
}

export interface RegisterEnv {
  selectionCount(): number;
  selectionFragments(): string[];
  documentName(): string;
}

const LINE_ENDING = "\n";

export class Registers {
  private inner = new Map<string, string[]>();
  lastSearchRegister = "/";

  constructor(public clipboard: ClipboardProvider) {}

  read(name: string, env: RegisterEnv): string[] | null {
    switch (name) {
      case "_":
        return [];
      case "#":
        return Array.from({ length: env.selectionCount() }, (_, i) => String(i + 1));
      case ".":
        return env.selectionFragments();
      case "%":
        return [env.documentName()];
      case "*":
      case "+":
        return this.readClipboard(name, name === "+" ? "clipboard" : "selection");
      default: {
        const values = this.inner.get(name);
        return values ? [...values].reverse() : null;
      }
    }
  }

  write(name: string, values: string[]): void {
    switch (name) {
      case "_":
        return;
      case "#":
      case ".":
      case "%":
        throw new Error(`Register ${name} does not support writing`);
      case "*":
      case "+":
        this.clipboard.set(values.join(LINE_ENDING), name === "+" ? "clipboard" : "selection");
        this.inner.set(name, [...values].reverse());
        return;
      default:
        this.inner.set(name, [...values].reverse());
    }
  }

  push(name: string, value: string): void {
    switch (name) {
      case "_":
        return;
      case "#":
      case ".":
      case "%":
        throw new Error(`Register ${name} does not support pushing`);
      case "*":
      case "+": {
        const type: ClipboardType = name === "+" ? "clipboard" : "selection";
        const contents = this.clipboard.get(type);
        const saved = this.inner.get(name) ?? [];
        this.inner.set(name, saved);
        if (!contentsAreSaved(saved, contents)) {
          throw new Error(`Failed to push to register ${name}: clipboard does not match register contents`);
        }
        saved.push(value);
        let next = value;
        if (contents !== "") next += LINE_ENDING;
        next += contents;
        this.clipboard.set(next, type);
        return;
      }
      default: {
        const saved = this.inner.get(name) ?? [];
        saved.push(value);
        this.inner.set(name, saved);
      }
    }
  }

  first(name: string, env: RegisterEnv): string | null {
    return this.read(name, env)?.[0] ?? null;
  }

  last(name: string, env: RegisterEnv): string | null {
    const values = this.read(name, env);
    return values && values.length > 0 ? values[values.length - 1]! : null;
  }

  remove(name: string): boolean {
    if (name === "*" || name === "+") {
      this.clipboard.set("", name === "+" ? "clipboard" : "selection");
      this.inner.delete(name);
      return true;
    }
    if (["_", "#", ".", "%"].includes(name)) return false;
    return this.inner.delete(name);
  }

  clear(): void {
    this.clipboard.set("", "clipboard");
    this.clipboard.set("", "selection");
    this.inner.clear();
  }

  preview(): [string, string][] {
    const out: [string, string][] = [];
    for (const [name, values] of this.inner) {
      if (name === "*" || name === "+") continue;
      out.push([name, values[values.length - 1]?.split("\n")[0] ?? "<empty>"]);
    }
    out.push(
      ["_", "<empty>"],
      ["#", "<selection indices>"],
      [".", "<selection contents>"],
      ["%", "<document path>"],
      ["+", "<system clipboard>"],
      ["*", "<primary clipboard>"],
    );
    return out;
  }

  private readClipboard(name: string, type: ClipboardType): string[] {
    const contents = this.clipboard.get(type);
    const saved = this.inner.get(name);
    if (!saved) return [contents];
    return contentsAreSaved(saved, contents) ? [...saved].reverse() : [contents];
  }
}

function contentsAreSaved(saved: readonly string[], contents: string): boolean {
  const values = [...saved].reverse();
  const first = values.shift();
  if (first === undefined) return contents === "";
  if (!contents.startsWith(first)) return false;
  contents = contents.slice(first.length);
  for (const value of values) {
    if (contents.startsWith(LINE_ENDING) && contents.slice(LINE_ENDING.length).startsWith(value)) {
      contents = contents.slice(LINE_ENDING.length + value.length);
    } else {
      return false;
    }
  }
  return true;
}
