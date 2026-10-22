import { copyFileSync, mkdirSync, watch } from "node:fs";
import { resolve } from "node:path";

const root = import.meta.dir;
const out = resolve(root, "test-vault/.obsidian/plugins/helix-motions");
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

async function build(): Promise<boolean> {
  mkdirSync(out, { recursive: true });
  const result = await Bun.build({
    entrypoints: [resolve(root, "src/main.ts")],
    outdir: out,
    naming: "main.js",
    format: "cjs",
    target: "browser",
    external,
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
