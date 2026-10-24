import { expect, test } from "bun:test";
import { compare } from "./oracle/diff";
import { handSuite, markdownSuite } from "./oracle/suites";
import { fuzzSuite, markdownFuzzSuite } from "./oracle/fuzz";
import { oracleGraphemes } from "./oracle/oracle";
import { segmentGraphemes } from "../src/graphemes";

const describe = (f: { c: { keys: string; in: string }; expected: { out?: string }; actual: { out: string; error?: string } }) =>
  `${JSON.stringify(f.c.keys)} in ${JSON.stringify(f.c.in)}: want ${JSON.stringify(f.expected.out)} got ${JSON.stringify(f.actual.out)} ${f.actual.error ?? ""}`;

test("hand suite matches Helix", async () => {
  const { failures } = await compare(handSuite());
  expect(failures.map(describe)).toEqual([]);
}, 1_800_000);

for (const seed of [1, 2, 3, 4, 5]) {
  test(`fuzz seed ${seed} matches Helix`, async () => {
    const { failures } = await compare(fuzzSuite(3000, seed));
    expect(failures.map(describe)).toEqual([]);
  }, 1_800_000);
}

test("markdown suite matches Helix with the markdown syntax tree", async () => {
  const { failures } = await compare(markdownSuite());
  expect(failures.map(describe)).toEqual([]);
}, 1_800_000);

for (const seed of [1, 2, 3]) {
  test(`markdown fuzz seed ${seed} matches Helix`, async () => {
    const { failures } = await compare(markdownFuzzSuite(2000, seed));
    expect(failures.map(describe)).toEqual([]);
  }, 1_800_000);
}

test("grapheme clusters match unicode-segmentation", () => {
  const samples = [
    0x41, 0x0d, 0x0a, 0x00, 0x0301, 0x1f600, 0x0915, 0x1100, 0x1161, 0x11a8, 0xac00, 0xac01, 0x0600, 0x1f1ec, 0x0903,
    0x200d, 0x094d, 0x09cd, 0x0e33, 0x0e40, 0x1f3fb, 0x2764, 0xfe0f, 0x0995, 0x0930,
  ];
  const strings: string[] = [];
  for (const a of samples) for (const b of samples) for (const c of samples) strings.push(String.fromCodePoint(a, b, c));
  for (const a of samples) {
    for (const b of samples) {
      for (const c of samples) for (const d of [0x094d, 0x200d, 0x1f1ec, 0x0301]) strings.push(String.fromCodePoint(a, b, d, c));
    }
  }
  const want = oracleGraphemes(strings);
  const failures = strings.filter((s, i) => JSON.stringify(segmentGraphemes(s).map((g) => [...g].length)) !== JSON.stringify(want[i]));
  expect(failures.map((s) => [...s].map((c) => c.codePointAt(0)!.toString(16)).join(" "))).toEqual([]);
}, 600_000);
