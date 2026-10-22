import type { Text } from "@codemirror/state";
import { charAt, charBefore } from "./core/text";

const MAX_PLAINTEXT_SCAN = 10000;

export const BRACKETS: [string, string][] = [
  ["(", ")"],
  ["{", "}"],
  ["[", "]"],
  ["<", ">"],
  ["‘", "’"],
  ["“", "”"],
  ["«", "»"],
  ["「", "」"],
  ["（", "）"],
];

export const PAIRS: [string, string][] = [...BRACKETS, ['"', '"'], ["'", "'"], ["`", "`"], ["|", "|"]];

export function getPair(ch: string): [string, string] {
  return PAIRS.find(([o, c]) => o === ch || c === ch) ?? [ch, ch];
}

export function isOpenBracket(ch: string): boolean {
  return BRACKETS.some(([l]) => l === ch);
}

export function isCloseBracket(ch: string): boolean {
  return BRACKETS.some(([, r]) => r === ch);
}

export function isValidBracket(ch: string): boolean {
  return BRACKETS.some(([l, r]) => l === ch || r === ch);
}

export function findMatchingBracketPlaintext(doc: Text, cursorPos: number): number | null {
  const bracket = charAt(doc, cursorPos);
  if (bracket === null) return null;
  const pair = getPair(bracket);
  const matching = pair[0] === bracket ? pair[1] : pair[0];
  if (!isValidBracket(bracket)) return null;
  const isFwd = isOpenBracket(bracket);
  let openCnt = 1;
  let pos = isFwd ? cursorPos + bracket.length : cursorPos;
  for (let i = 0; i < MAX_PLAINTEXT_SCAN; i++) {
    let candidate: string | null;
    let at: number;
    if (isFwd) {
      candidate = charAt(doc, pos);
      if (candidate === null) return null;
      at = pos;
      pos += candidate.length;
    } else {
      candidate = charBefore(doc, pos);
      if (candidate === null) return null;
      pos -= candidate.length;
      at = pos;
    }
    if (candidate === bracket) openCnt++;
    else if (candidate === matching) {
      if (openCnt === 1) return at;
      openCnt--;
    }
  }
  return null;
}
