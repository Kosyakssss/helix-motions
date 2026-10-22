import { defaultInsert, defaultNormal, selectOverrides } from "./default";
import { buildTrie, cloneTrie, Keymaps, mergeNodes, type KeyNode, type TrieNode } from "./trie";

export type ModeName = "normal" | "select" | "insert";

export function defaultKeymaps(): Record<ModeName, TrieNode> {
  const normal = buildTrie(defaultNormal) as TrieNode;
  const select = cloneTrie(normal) as TrieNode;
  mergeNodes(select, buildTrie(selectOverrides) as TrieNode);
  select.name = "Select mode";
  const insert = buildTrie(defaultInsert) as TrieNode;
  return { normal, select, insert };
}

export function buildKeymaps(user: Partial<Record<ModeName, KeyNode>> = {}): Keymaps {
  const maps = defaultKeymaps();
  for (const mode of ["normal", "select", "insert"] as const) {
    const delta = user[mode];
    if (delta) mergeNodes(maps[mode], buildTrie(delta) as TrieNode);
  }
  return new Keymaps(maps);
}
