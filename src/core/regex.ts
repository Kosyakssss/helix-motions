import type { Text } from "@codemirror/state";
import { textString } from "./text";

const WORD = "\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\p{Join_Control}";
const SYNTAX = new Set([..."^$\\.*+?()[]{}|/"]);
const POSIX: Record<string, string> = {
  alnum: "0-9A-Za-z",
  alpha: "A-Za-z",
  ascii: "\\x00-\\x7F",
  blank: "\\t ",
  cntrl: "\\x00-\\x1F\\x7F",
  digit: "0-9",
  graph: "!-~",
  lower: "a-z",
  print: " -~",
  punct: "!-\\/:-@\\[-`{-~",
  space: "\\t\\n\\v\\f\\r ",
  upper: "A-Z",
  word: "0-9A-Za-z_",
  xdigit: "0-9A-Fa-f",
};

export interface CompiledRegex {
  source: string;
  regex: RegExp;
}

export function escapeRegex(s: string): string {
  return s.replace(/[\\.+*?()|[\]{}^$#&\-~]/g, (c) => "\\" + c);
}

export function translate(pattern: string): { source: string; flags: string } {
  let flags = "";
  let i = 0;
  const lead = /^\(\?([imsxU]+)\)/.exec(pattern);
  if (lead) {
    for (const f of lead[1]!) {
      if (f === "i" && !flags.includes("i")) flags += "i";
      if (f === "s" && !flags.includes("s")) flags += "s";
    }
    i = lead[0].length;
  }
  let out = "";
  let inClass = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === "\\") {
      const n = pattern[i + 1];
      if (n === undefined) {
        out += "\\\\";
        i++;
        continue;
      }
      i += 2;
      switch (n) {
        case "w":
          out += inClass ? WORD : `[${WORD}]`;
          continue;
        case "W":
          out += inClass ? `\\P{Alphabetic}` : `[^${WORD}]`;
          continue;
        case "d":
          out += inClass ? "\\p{Nd}" : "\\p{Nd}";
          continue;
        case "D":
          out += "\\P{Nd}";
          continue;
        case "s":
          out += "\\p{White_Space}";
          continue;
        case "S":
          out += "\\P{White_Space}";
          continue;
        case "b":
          out += inClass ? "\\x08" : `(?:(?<=[${WORD}])(?![${WORD}])|(?<![${WORD}])(?=[${WORD}]))`;
          continue;
        case "B":
          out += `(?:(?<=[${WORD}])(?=[${WORD}])|(?<![${WORD}])(?![${WORD}]))`;
          continue;
        case "A":
          out += "(?<![\\s\\S])";
          continue;
        case "z":
          out += "(?![\\s\\S])";
          continue;
        case "x": {
          if (pattern[i] === "{") {
            const end = pattern.indexOf("}", i);
            out += `\\u{${pattern.slice(i + 1, end)}}`;
            i = end + 1;
          } else {
            out += "\\x" + pattern.slice(i, i + 2);
            i += 2;
          }
          continue;
        }
        case "p":
        case "P": {
          if (pattern[i] === "{") {
            const end = pattern.indexOf("}", i);
            out += `\\${n}{${pattern.slice(i + 1, end)}}`;
            i = end + 1;
          } else {
            out += `\\${n}{${pattern[i]}}`;
            i++;
          }
          continue;
        }
        default:
          if (/[0-9a-zA-Z]/.test(n)) out += "\\" + n;
          else if (SYNTAX.has(n) || (inClass && n === "-")) out += "\\" + n;
          else out += n;
          continue;
      }
    }
    if (c === "[") {
      const posix = /^\[:(\^?)([a-z]+):\]/.exec(pattern.slice(i));
      if (inClass && posix && POSIX[posix[2]!]) {
        out += POSIX[posix[2]!];
        i += posix[0].length;
        continue;
      }
      inClass++;
      out += c;
      i++;
      if (pattern[i] === "^") {
        out += "^";
        i++;
      }
      if (pattern[i] === "]") {
        out += "\\]";
        i++;
      }
      continue;
    }
    if (c === "]" && inClass) {
      inClass--;
      out += c;
      i++;
      continue;
    }
    if (c === "(" && pattern.startsWith("(?P<", i)) {
      out += "(?<";
      i += 4;
      continue;
    }
    if (c === "/" && !inClass) {
      out += "\\/";
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return { source: out, flags };
}

export function compileRegex(pattern: string, caseInsensitive: boolean): RegExp {
  const { source, flags } = translate(pattern);
  let f = "gmu" + flags.replace("i", "");
  if (caseInsensitive || flags.includes("i")) f += "i";
  return new RegExp(source, f);
}

export function smartCaseInsensitive(pattern: string, smartCase: boolean): boolean {
  if (!smartCase) return false;
  for (const ch of pattern) if (ch !== ch.toLowerCase() && ch === ch.toUpperCase()) return false;
  return true;
}

export function docString(doc: Text): string {
  return textString(doc);
}

function nextIndex(s: string, i: number): number {
  const c = s.codePointAt(i);
  return c !== undefined && c > 0xffff ? i + 2 : i + 1;
}

export function findAt(re: RegExp, haystack: string, from: number, to: number): [number, number] | null {
  let pos = from;
  while (pos <= to) {
    re.lastIndex = pos;
    const m = re.exec(haystack);
    if (!m || m.index > to) return null;
    const end = m.index + m[0].length;
    if (end <= to) return [m.index, end];
    const truncated = haystack.slice(0, to);
    re.lastIndex = m.index;
    const t = re.exec(truncated);
    if (t && t.index === m.index) return [t.index, t.index + t[0].length];
    pos = nextIndex(haystack, m.index);
  }
  return null;
}

export function* findIter(re: RegExp, haystack: string, from: number, to: number): Generator<[number, number]> {
  let pos = from;
  let lastEnd = -1;
  while (pos <= to) {
    const m = findAt(re, haystack, pos, to);
    if (!m) return;
    const [start, end] = m;
    if (start === end && start === lastEnd) {
      if (start >= to) return;
      pos = nextIndex(haystack, start);
      continue;
    }
    yield m;
    lastEnd = end;
    pos = end === start ? nextIndex(haystack, end) : end;
    if (end === start && end >= to) return;
  }
}

export function isMatch(re: RegExp, haystack: string, from: number, to: number): boolean {
  return findAt(re, haystack, from, to) !== null;
}
