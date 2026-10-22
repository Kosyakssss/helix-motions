import { Range, Selection } from "../selection";

const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function print(s: string): { text: string; selection: Selection } {
  const gs = [...seg.segment(s)].map((g) => g.segment);
  let primary: number | null = null;
  const ranges: Range[] = [];
  let left = "";
  let i = 0;
  outer: while (i < gs.length) {
    const c = gs[i++]!;
    const start = left.length;
    if (c !== "#") {
      left += c;
      continue;
    }
    const n = gs[i++];
    let isPrimary: boolean;
    let close: string;
    if (n === "[") {
      isPrimary = true;
      close = "]";
    } else if (n === "(") {
      isPrimary = false;
      close = ")";
    } else if (n === undefined) {
      break;
    } else {
      left += "#" + n;
      continue;
    }
    if (isPrimary && primary !== null) throw new Error(`primary already appeared: ${s}`);
    const headAtBeg = gs[i] === "|";
    if (headAtBeg) i++;
    while (i < gs.length) {
      const ch = gs[i++]!;
      const next = gs[i];
      if (!(ch === close && next === "#")) {
        left += ch;
        continue;
      }
      let prev = [...seg.segment(left)].pop()?.segment;
      if (!headAtBeg) {
        if (prev !== "|") {
          left += ch;
          continue;
        }
        left = left.slice(0, -1);
        prev = [...seg.segment(left)].pop()?.segment;
      }
      i++;
      if ((prev === "\n" || prev === "\r\n") && gs[i] === prev) i++;
      if (isPrimary) primary = ranges.length;
      ranges.push(headAtBeg ? new Range(left.length, start) : new Range(start, left.length));
      continue outer;
    }
    throw new Error(`missing end in ${s}`);
  }
  if (primary === null) throw new Error(`missing primary in ${s}`);
  return { text: left, selection: new Selection(ranges, primary) };
}

export function plain(text: string, selection: Selection): string {
  const ins: [number, number, string][] = [];
  selection.ranges.forEach((r, i) => {
    const p = i === selection.primaryIndex;
    if (r.anchor < r.head) {
      ins.push([r.anchor, 0, p ? "#[" : "#("], [r.head, 1, p ? "|]#" : "|)#"]);
    } else {
      ins.push([r.anchor, 0, p ? "]#" : ")#"], [r.head, 1, p ? "#[|" : "#(|"]);
    }
  });
  ins.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  let out = text;
  for (const [pos, , m] of ins) out = out.slice(0, pos) + m + out.slice(pos);
  return out;
}
