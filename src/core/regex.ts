import type { Text } from "@codemirror/state";
import type { RustRegexEngine } from "./rx";

export function escapeRegex(s: string): string {
  return s.replace(/[\\.+*?()|[\]{}^$#&\-~]/g, (c) => "\\" + c);
}

export interface Pattern {
  find(doc: Text, from: number, to: number): [number, number] | null;
  findLast(doc: Text, from: number, to: number): [number, number] | null;
  findAll(doc: Text, from: number, to: number): [number, number][];
  isMatch(doc: Text, from: number, to: number): boolean;
}

let engine: RustRegexEngine | null = null;
const dropped = new FinalizationRegistry<number>((regex) => engine?.drop(regex));

export function setRegexEngine(next: RustRegexEngine | null): void {
  engine = next;
}

export function compilePattern(pattern: string, caseInsensitive: boolean): Pattern {
  const rust = engine;
  if (!rust) throw new Error("the regex engine is still loading");
  const regex = rust.compile(pattern, caseInsensitive);
  const compiled: Pattern = {
    find: (doc, from, to) => rust.find(regex, doc, from, to),
    findLast: (doc, from, to) => rust.findLast(regex, doc, from, to),
    findAll: (doc, from, to) => rust.findAll(regex, doc, from, to),
    isMatch: (doc, from, to) => rust.isMatch(regex, doc, from, to),
  };
  dropped.register(compiled, regex);
  return compiled;
}
