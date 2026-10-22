import { oracleAsync, type Case } from "./oracle";
import { run } from "../harness";
import { handSuite } from "./suites";
import { fuzzSuite } from "./fuzz";

export interface Failure {
  c: Case;
  expected: { out?: string; mode?: string; register?: string[] | null; error?: string };
  actual: ReturnType<typeof run>;
}

export async function compare(cases: Case[]): Promise<{ failures: Failure[]; skipped: number }> {
  const results = await oracleAsync(cases);
  const failures: Failure[] = [];
  let skipped = 0;
  for (const c of cases) {
    const expected = results.get(c.id)!;
    if (expected.error || expected.out === undefined) {
      skipped++;
      continue;
    }
    const actual = run(c.in, c.keys);
    const ok =
      !actual.error &&
      actual.text === expected.text &&
      JSON.stringify(actual.ranges) === JSON.stringify(expected.ranges) &&
      actual.primary === expected.primary &&
      actual.mode === expected.mode &&
      JSON.stringify(actual.register ?? null) === JSON.stringify(expected.register ?? null);
    if (!ok) failures.push({ c, expected, actual });
  }
  return { failures, skipped };
}

if (import.meta.main) {
  const which = process.argv[2] ?? "hand";
  const filter = process.argv[3];
  let cases = which === "fuzz" ? fuzzSuite(Number(process.env.FUZZ_N ?? 2000), Number(process.env.FUZZ_SEED ?? 1)) : handSuite();
  if (filter) cases = cases.filter((c) => c.keys.includes(filter) || c.id.startsWith(filter));
  const { failures, skipped } = await compare(cases);
  const byKeys = new Map<string, Failure[]>();
  for (const f of failures) {
    const list = byKeys.get(f.c.keys) ?? [];
    list.push(f);
    byKeys.set(f.c.keys, list);
  }
  const limit = Number(process.env.SHOW ?? 40);
  let shown = 0;
  for (const [k, list] of [...byKeys].sort((a, b) => b[1].length - a[1].length)) {
    if (shown++ >= limit) break;
    const f = list[0]!;
    console.log(`--- keys ${JSON.stringify(k)} (${list.length} fails) in ${JSON.stringify(f.c.in)}`);
    console.log(`  want ${JSON.stringify(f.expected.out)} ${f.expected.mode} reg=${JSON.stringify(f.expected.register)}`);
    console.log(`  got  ${JSON.stringify(f.actual.out)} ${f.actual.mode} reg=${JSON.stringify(f.actual.register)}${f.actual.error ? " ERR " + f.actual.error.split("\n").slice(0, 4).join(" | ") : ""}`);
  }
  console.log(`\n${cases.length} cases, ${failures.length} failures, ${byKeys.size} distinct key sequences, ${skipped} skipped (oracle error)`);
}
