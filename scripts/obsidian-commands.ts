import { resolve } from "node:path";
import { evalJs } from "../test/e2e/obsidian";

interface Command {
  id: string;
  name: string;
  keys: string;
}

const list = evalJs<Command[] | string>(`(async()=>{
  const internal = app.internalPlugins.plugins;
  const off = Object.values(internal).filter((p) => !p.enabled);
  for (const p of off) await p.enable(false);
  const out = Object.values(app.commands.commands)
    .filter((c) => !c.id.startsWith("helix-motions:"))
    .map((c) => ({ id: c.id, name: c.name, keys: (c.hotkeys ?? []).map((h) => [...(h.modifiers ?? []), h.key].join("+")).join(", ") }));
  for (const p of off) await p.disable(false);
  return JSON.stringify(out);
})()`);
const commands: Command[] = typeof list === "string" ? (JSON.parse(list) as Command[]) : list;

const groups = new Map<string, Command[]>();
for (const command of commands.sort((a, b) => a.id.localeCompare(b.id))) {
  const prefix = command.id.slice(0, command.id.indexOf(":"));
  groups.set(prefix, [...(groups.get(prefix) ?? []), command]);
}

let out = (await Bun.file(resolve(import.meta.dir, "obsidian-commands-intro.md")).text()).trimEnd() + "\n";
for (const [prefix, entries] of groups) {
  out += `\n## ${prefix}\n\n| Command | What it does | Obsidian's default key |\n|---|---|---|\n`;
  for (const c of entries) out += `| \`${c.id}\` | ${c.name.replace(/\|/g, "\\|")} | ${c.keys ? `\`${c.keys}\`` : ""} |\n`;
}
await Bun.write(resolve(import.meta.dir, "../docs/obsidian-commands.md"), out);
process.stdout.write(`${commands.length} commands\n`);
