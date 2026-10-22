import { WIDTH_RANGES } from "./width-table";

const encoder = new TextEncoder();

function byteLen(s: string): number {
  return encoder.encode(s).length;
}

function chWidth(ch: string): number {
  const cp = ch.codePointAt(0)!;
  if (cp < 0x20 || cp === 0x7f) return 0;
  if (cp < 0x7f) return 1;
  let lo = 0;
  let hi = WIDTH_RANGES.length / 3 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < WIDTH_RANGES[mid * 3]!) hi = mid - 1;
    else if (cp > WIDTH_RANGES[mid * 3 + 1]!) lo = mid + 1;
    else return WIDTH_RANGES[mid * 3 + 2]!;
  }
  return 1;
}

export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += chWidth(ch);
  return w;
}

interface Word {
  word: string;
  width: number;
  whitespace: string;
}

function wordFrom(s: string): Word {
  const trimmed = s.replace(/ +$/, "");
  return { word: trimmed, width: displayWidth(trimmed), whitespace: s.slice(trimmed.length) };
}

function findWords(line: string): Word[] {
  const words: Word[] = [];
  let start = 0;
  let inWhitespace = false;
  let idx = 0;
  for (const ch of line) {
    if (inWhitespace && ch !== " ") {
      words.push(wordFrom(line.slice(start, idx)));
      start = idx;
    }
    inWhitespace = ch === " ";
    idx += ch.length;
  }
  if (start < line.length) words.push(wordFrom(line.slice(start)));
  return words;
}

function breakApart(word: Word, lineWidth: number): Word[] {
  const out: Word[] = [];
  let offset = 0;
  let width = 0;
  let idx = 0;
  for (const ch of word.word) {
    const w = chWidth(ch);
    if (width > 0 && width + w > lineWidth) {
      out.push({ word: word.word.slice(offset, idx), width, whitespace: "" });
      offset = idx;
      width = w;
    } else {
      width += w;
    }
    idx += ch.length;
  }
  if (offset < word.word.length) out.push({ word: word.word.slice(offset), width, whitespace: word.whitespace });
  return out;
}

function breakWords(words: Word[], lineWidth: number): Word[] {
  const out: Word[] = [];
  for (const w of words) {
    if (w.width > lineWidth) out.push(...breakApart(w, lineWidth));
    else out.push(w);
  }
  return out;
}

const NLINE = 1000;
const OVERFLOW = 2500;
const SHORT_FRACTION = 4;
const SHORT_PENALTY = 25;

function wrapOptimalFit(fragments: Word[], lineWidths: number[]): Word[][] {
  const defaultWidth = lineWidths[lineWidths.length - 1] ?? 0;
  const widths = [0];
  let width = 0;
  for (const f of fragments) {
    width += f.width + f.whitespace.length;
    widths.push(width);
  }
  const n = fragments.length;
  const minima: [number, number][] = [[0, 0]];
  const lineNumbers = [0];
  const lineNumber = (i: number): number => {
    while (lineNumbers.length < i + 1) {
      const pos = lineNumbers.length;
      lineNumbers.push(1 + lineNumber(minima[pos]![0]));
    }
    return lineNumbers[i]!;
  };
  const cost = (i: number, j: number): number => {
    const ln = lineNumber(i);
    const target = Math.max(lineWidths[ln] ?? defaultWidth, 1);
    const lineWidth = widths[j]! - widths[i]! - fragments[j - 1]!.whitespace.length;
    let c = minima[i]![1] + NLINE;
    if (lineWidth > target) c += (lineWidth - target) * OVERFLOW;
    else if (j < n) c += (target - lineWidth) * (target - lineWidth);
    else if (i + 1 === j && lineWidth < target / SHORT_FRACTION) c += SHORT_PENALTY;
    return c;
  };
  for (let j = 1; j <= n; j++) {
    let best = 0;
    let bestCost = Infinity;
    for (let i = 0; i < j; i++) {
      const c = cost(i, j);
      if (c < bestCost) {
        bestCost = c;
        best = i;
      }
    }
    minima.push([best, bestCost]);
  }
  const lines: Word[][] = [];
  let pos = n;
  for (;;) {
    const prev = minima[pos]![0];
    lines.push(fragments.slice(prev, pos));
    pos = prev;
    if (pos === 0) break;
  }
  return lines.reverse();
}

interface Options {
  width: number;
  initialIndent: string;
  subsequentIndent: string;
  lineEnding: string;
}

function wrapSingleLine(line: string, options: Options, lines: string[]): void {
  const indent = lines.length === 0 ? options.initialIndent : options.subsequentIndent;
  if (byteLen(line) < options.width && indent === "") {
    lines.push(line.replace(/ +$/, ""));
    return;
  }
  const initialWidth = Math.max(0, options.width - displayWidth(options.initialIndent));
  const subsequentWidth = Math.max(0, options.width - displayWidth(options.subsequentIndent));
  const words = breakWords(findWords(line), subsequentWidth);
  if (options.initialIndent !== "") words.unshift({ word: "", width: 0, whitespace: "" });
  const wrapped = wrapOptimalFit(words, [initialWidth, subsequentWidth]);
  let idx = 0;
  for (const ws of wrapped) {
    const last = ws[ws.length - 1];
    if (!last) {
      lines.push("");
      continue;
    }
    const len = ws.reduce((s, w) => s + w.word.length + w.whitespace.length, 0) - last.whitespace.length;
    let result =
      lines.length === 0 && options.initialIndent !== ""
        ? options.initialIndent
        : lines.length > 0 && options.subsequentIndent !== ""
          ? options.subsequentIndent
          : "";
    result += line.slice(idx, idx + len);
    lines.push(result);
    idx += len + last.whitespace.length;
  }
}

function fill(text: string, options: Options): string {
  if (byteLen(text) < options.width && !text.includes("\n") && options.initialIndent === "") {
    return text.replace(/ +$/, "");
  }
  const lines: string[] = [];
  for (const line of text.split(options.lineEnding)) wrapSingleLine(line, options, lines);
  return lines.join(options.lineEnding);
}

function rustLines(text: string): string[] {
  if (text === "") return [];
  const parts = text.split("\n");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts.map((p) => (p.endsWith("\r") ? p.slice(0, -1) : p));
}

function nonEmptyLines(text: string): [string, string | null][] {
  const out: [string, string | null][] = [];
  let rest = text;
  for (;;) {
    const lf = rest.indexOf("\n");
    if (lf < 0) break;
    if (lf === 0 || (lf === 1 && rest[0] === "\r")) {
      rest = rest.slice(lf + 1);
      continue;
    }
    if (rest[lf - 1] === "\r") out.push([rest.slice(0, lf - 1), "\r\n"]);
    else out.push([rest.slice(0, lf), "\n"]);
    rest = rest.slice(lf + 1);
  }
  if (rest !== "") out.push([rest, null]);
  return out;
}

function unfill(text: string): [string, Options] {
  const options: Options = { width: 0, initialIndent: "", subsequentIndent: "", lineEnding: "\n" };
  rustLines(text).forEach((line, idx) => {
    options.width = Math.max(options.width, displayWidth(line));
    const prefix = /^[ \-+*>#/]*/.exec(line)![0];
    if (idx === 0) options.initialIndent = prefix;
    else if (idx === 1) options.subsequentIndent = prefix;
    else {
      for (let k = 0; k < Math.min(prefix.length, options.subsequentIndent.length); k++) {
        if (prefix[k] !== options.subsequentIndent[k]) {
          options.subsequentIndent = prefix.slice(0, k);
          break;
        }
      }
      if (prefix.length < options.subsequentIndent.length) options.subsequentIndent = prefix;
    }
  });
  let unfilled = "";
  let detected: string | null = null;
  nonEmptyLines(text).forEach(([line, ending], idx) => {
    if (idx === 0) unfilled += line.slice(options.initialIndent.length);
    else unfilled += " " + line.slice(options.subsequentIndent.length);
    if (detected === null && ending !== null) detected = ending;
    else if (detected === "\r\n" && ending === "\n") detected = ending;
  });
  if (detected !== null && text.endsWith(detected)) unfilled += detected;
  options.lineEnding = detected ?? "\n";
  return [unfilled, options];
}

export function refill(filled: string, width: number): string {
  const [text, options] = unfill(filled);
  const stripped = text.endsWith(options.lineEnding) ? text.slice(0, -options.lineEnding.length) : null;
  const newOptions: Options = {
    width,
    initialIndent: options.initialIndent,
    subsequentIndent: options.subsequentIndent,
    lineEnding: "\n",
  };
  let refilled = fill(stripped ?? text, newOptions);
  if (stripped !== null) refilled += "\n";
  return refilled;
}
