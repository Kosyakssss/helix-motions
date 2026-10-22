import { expect, test } from "bun:test";
import { compare } from "./oracle/diff";
import { handSuite } from "./oracle/suites";
import { fuzzSuite } from "./oracle/fuzz";

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
