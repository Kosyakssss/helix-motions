import type { Context } from "../core/editor";
import type { MappableCommand } from "../keymap/trie";
import { motionCommands, type CommandFn } from "./motion";
import { selectCommands } from "./select";
import { editCommands } from "./edit";
import { insertCommands } from "./insert";
import { miscCommands, UNSUPPORTED } from "./misc";
import { executeCommandLine } from "./typed";

export const STATIC_COMMANDS: Record<string, CommandFn> = {
  ...motionCommands,
  ...selectCommands,
  ...editCommands,
  ...insertCommands,
  ...miscCommands,
};

export function isKnownCommand(name: string): boolean {
  return name in STATIC_COMMANDS || UNSUPPORTED.includes(name);
}

export function executeCommand(cx: Context, command: MappableCommand, arg?: string): void {
  switch (command.kind) {
    case "static": {
      const fn = STATIC_COMMANDS[command.name];
      if (fn) fn(cx, arg);
      else if (UNSUPPORTED.includes(command.name)) cx.editor.setStatus(`${command.name} is not available in Obsidian`);
      else cx.editor.setError(`no such command: '${command.name}'`);
      return;
    }
    case "typable":
      runTypable(cx, command.raw);
      return;
    case "macro": {
      if (cx.editor.macroReplaying.includes("@")) {
        cx.editor.setError("Cannot execute macro because the [@] register is already playing a macro");
        return;
      }
      let keys: string[];
      try {
        keys = cx.editor.parseMacro(command.keys);
      } catch (err) {
        cx.editor.setError(`Invalid macro: ${(err as Error).message}`);
        return;
      }
      cx.editor.macroReplaying.push("@");
      cx.callbacks.push(() => {
        for (const key of keys) cx.editor.handleKey(cx.host, key);
        cx.editor.macroReplaying.pop();
      });
    }
  }
}

export function runTypable(cx: Context, input: string): void {
  executeCommandLine(cx, input, "validate");
}
