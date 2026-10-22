import { readFileSync } from "node:fs";
import { compare } from "./diff";
const pairs: [string, string][] = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const { failures } = await compare(pairs.map(([i, k], n) => ({ id: `one${n}`, in: i, keys: k })));
for (const f of failures) {
  console.log(`--- ${JSON.stringify(f.c.keys)} in ${JSON.stringify(f.c.in)}\n  want ${JSON.stringify(f.expected.out)} ${f.expected.mode}\n  got  ${JSON.stringify(f.actual.out)} ${f.actual.mode} ${f.actual.error ?? ""}`);
}
console.log(`${pairs.length - failures.length}/${pairs.length} pass`);
