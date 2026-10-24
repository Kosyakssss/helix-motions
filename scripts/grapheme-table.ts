import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const version = "1.13.3";
const registry = join(process.env.CARGO_HOME ?? join(homedir(), ".cargo"), "registry/src");
const crate = readdirSync(registry)
  .map((index) => join(registry, index, `unicode-segmentation-${version}`))
  .find((dir) => {
    try {
      return readdirSync(dir).length > 0;
    } catch {
      return false;
    }
  });
if (!crate) throw new Error(`unicode-segmentation ${version} not found in ${registry}; build Helix once first`);

const src = readFileSync(join(crate, "src/tables.rs"), "utf8");
const block = (start: string) => {
  const i = src.indexOf(start);
  return src.slice(i, src.indexOf("];", i));
};
const hex = (s: string) => parseInt(s, 16);
const cats = [
  "Any", "CR", "Control", "Extend", "Extended_Pictographic", "InCB_Consonant", "L", "LF",
  "LV", "LVT", "Prepend", "Regional_Indicator", "SpacingMark", "T", "V", "ZWJ",
];
const categories = [...block("const grapheme_cat_table").matchAll(/\('\\u\{([0-9a-f]+)\}',\s*'\\u\{([0-9a-f]+)\}',\s*GC_(\w+)\)/gi)].map(
  (m) => [hex(m[1]!), hex(m[2]!), cats.indexOf(m[3]!)],
);
if (categories.some((c) => c[2]! < 0)) throw new Error("unknown grapheme category");
const extend = [...block("const InCB_Extend_table").matchAll(/\('\\u\{([0-9a-f]+)\}',\s*'\\u\{([0-9a-f]+)\}'\)/gi)].map((m) => [
  hex(m[1]!),
  hex(m[2]!),
]);
const linkerStart = src.indexOf("pub fn is_incb_linker");
const linkers = [...src.slice(linkerStart, src.indexOf("\n}", linkerStart)).matchAll(/\\u\{([0-9a-f]+)\}/gi)].map((m) => hex(m[1]!));

writeFileSync(
  resolve(import.meta.dir, "../src/core/grapheme-table.ts"),
  `export const GRAPHEME_CATEGORIES = ${JSON.stringify(categories.flat())};\nexport const INCB_EXTEND = ${JSON.stringify(extend.flat())};\nexport const INCB_LINKERS = ${JSON.stringify(linkers)};\n`,
);
