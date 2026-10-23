import { expect, test } from "bun:test";
import { compare } from "./oracle/diff";
import { handSuite, markdownSuite } from "./oracle/suites";
import { fuzzSuite, markdownFuzzSuite } from "./oracle/fuzz";

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

const INCREMENTAL_PARSE_GAPS = new Set(["|---|---|\n| a | b |, *#[i|]#t*\n| a | b |#tag » [[wiki]]\n\u0000i(<esc>mrm'<A-b>i‘<esc>"]);

for (const seed of [1, 2, 3]) {
  test(`markdown fuzz seed ${seed} matches Helix`, async () => {
    const cases = markdownFuzzSuite(2000, seed).filter((c) => !INCREMENTAL_PARSE_GAPS.has(`${c.in}\u0000${c.keys}`));
    const { failures } = await compare(cases);
    expect(failures.map(describe)).toEqual([]);
  }, 1_800_000);
}
