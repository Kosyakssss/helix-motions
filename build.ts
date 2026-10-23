import { copyFileSync, mkdirSync, readFileSync, watch } from "node:fs";
import { resolve } from "node:path";

const root = import.meta.dir;
const outArg = process.argv.indexOf("--out");
const out = outArg > 0 ? resolve(process.argv[outArg + 1]!) : resolve(root, "test-vault/.obsidian/plugins/helix-motions");
const external = [
  "obsidian",
  "electron",
  "@codemirror/autocomplete",
  "@codemirror/collab",
  "@codemirror/commands",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
];

const treeSitter: import("bun").BunPlugin = {
  name: "tree-sitter",
  setup(builder) {
    builder.onLoad({ filter: /\.wasm$/ }, async (args) => {
      const bytes = await Bun.file(args.path).bytes();
      const packed = Buffer.from(Bun.deflateSync(bytes, { level: 9 })).toString("base64");
      return { contents: `export default ${JSON.stringify(packed)};`, loader: "js" };
    });
  },
};

async function build(): Promise<boolean> {
  mkdirSync(out, { recursive: true });
  const result = await Bun.build({
    entrypoints: [resolve(root, "src/main.ts")],
    outdir: out,
    naming: "main.js",
    format: "cjs",
    target: "browser",
    external,
    plugins: [treeSitter],
    footer: `/*\n${readFileSync(resolve(root, "tree-sitter/NOTICE"), "utf8").trimEnd()}\n*/`,
    sourcemap: process.argv.includes("--watch") ? "inline" : "none",
    minify: false,
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    return false;
  }
  copyFileSync(resolve(root, "manifest.json"), resolve(out, "manifest.json"));
  copyFileSync(resolve(root, "styles.css"), resolve(out, "styles.css"));
  console.log(`built ${new Date().toLocaleTimeString()}`);
  return true;
}

const ok = await build();
if (process.argv.includes("--watch")) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const rebuild = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      if (await build()) Bun.spawn(["obsidian", "vault=test-vault", "plugin:reload", "id=helix-motions"]);
    }, 100);
  };
  watch(resolve(root, "src"), { recursive: true }, rebuild);
  watch(resolve(root, "styles.css"), rebuild);
} else if (!ok) {
  process.exit(1);
}
