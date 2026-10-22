import { normalizeKeyString } from "../keys";

export type RawTrie = string | string[] | KeyNode;

export interface KeyNode {
  name: string;
  sticky?: boolean;
  map: Record<string, RawTrie>;
}

export type MappableCommand =
  | { kind: "static"; name: string }
  | { kind: "typable"; name: string; args: string; raw: string }
  | { kind: "macro"; keys: string };

export type Trie =
  | { kind: "command"; command: MappableCommand }
  | { kind: "sequence"; commands: MappableCommand[] }
  | TrieNode;

export interface TrieNode {
  kind: "node";
  name: string;
  sticky: boolean;
  map: Map<string, Trie>;
}

export function parseCommand(input: string): MappableCommand {
  if (input.startsWith(":")) {
    const raw = input.slice(1).trim();
    const space = raw.search(/\s/);
    const name = space < 0 ? raw : raw.slice(0, space);
    const args = space < 0 ? "" : raw.slice(space + 1).trim();
    return { kind: "typable", name, args, raw };
  }
  if (input.startsWith("@")) return { kind: "macro", keys: input.slice(1) };
  return { kind: "static", name: input };
}

export function commandName(command: MappableCommand): string {
  if (command.kind === "static") return command.name;
  if (command.kind === "typable") return `:${command.raw}`;
  return `@${command.keys}`;
}

export function buildTrie(raw: RawTrie): Trie {
  if (typeof raw === "string") return { kind: "command", command: parseCommand(raw) };
  if (Array.isArray(raw)) {
    const commands = raw.map(parseCommand);
    if (commands.some((c) => c.kind === "macro")) {
      throw new Error("macro keybindings may not be used in command sequences");
    }
    return { kind: "sequence", commands };
  }
  const map = new Map<string, Trie>();
  for (const [key, value] of Object.entries(raw.map)) {
    map.set(normalizeKeyString(key), buildTrie(value));
  }
  return { kind: "node", name: raw.name, sticky: raw.sticky ?? false, map };
}

export function cloneTrie(trie: Trie): Trie {
  if (trie.kind !== "node") return trie;
  return { ...trie, map: new Map([...trie.map].map(([k, v]) => [k, cloneTrie(v)])) };
}

export function mergeNodes(dst: TrieNode, other: TrieNode): void {
  for (const [key, trie] of other.map) {
    const existing = dst.map.get(key);
    if (existing && existing.kind === "node" && trie.kind === "node") {
      mergeNodes(existing, trie);
      continue;
    }
    dst.map.delete(key);
    dst.map.set(key, trie);
  }
}

export function search(trie: Trie, keys: readonly string[]): Trie | undefined {
  let current: Trie | undefined = trie;
  for (const key of keys) {
    if (!current || current.kind !== "node") return undefined;
    current = current.map.get(key);
  }
  return current;
}

export type KeymapResult =
  | { kind: "pending"; node: TrieNode }
  | { kind: "matched"; command: MappableCommand }
  | { kind: "matchedSequence"; commands: MappableCommand[] }
  | { kind: "notFound" }
  | { kind: "cancelled"; keys: string[] };

export class Keymaps {
  private state: string[] = [];
  sticky: TrieNode | null = null;

  constructor(public map: Record<"normal" | "select" | "insert", TrieNode>) {}

  pending(): readonly string[] {
    return this.state;
  }

  reset(): void {
    this.state = [];
    this.sticky = null;
  }

  containsKey(mode: "normal" | "select" | "insert", key: string): boolean {
    const node = search(this.map[mode], this.state);
    return !!node && node.kind === "node" && node.map.has(key);
  }

  get(mode: "normal" | "select" | "insert", key: string): KeymapResult {
    const keymap = this.map[mode];
    if (key === "esc") {
      if (this.state.length > 0) {
        const keys = this.state;
        this.state = [];
        return { kind: "cancelled", keys };
      }
      this.sticky = null;
    }
    const first = this.state[0] ?? key;
    const root: Trie = this.sticky ?? keymap;
    const trie = search(root, [first]);
    if (!trie) return { kind: "notFound" };
    if (trie.kind === "command") return { kind: "matched", command: trie.command };
    if (trie.kind === "sequence") return { kind: "matchedSequence", commands: trie.commands };
    this.state.push(key);
    const found = search(trie, this.state.slice(1));
    if (!found) {
      const keys = this.state;
      this.state = [];
      return { kind: "cancelled", keys };
    }
    if (found.kind === "node") {
      if (found.sticky) {
        this.state = [];
        this.sticky = found;
      }
      return { kind: "pending", node: found };
    }
    this.state = [];
    if (found.kind === "command") return { kind: "matched", command: found.command };
    return { kind: "matchedSequence", commands: found.commands };
  }
}
