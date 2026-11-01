import type { ClipboardProvider, ClipboardType } from "../registers";

export class SystemClipboard implements ClipboardProvider {
  private cache = "";

  name(): string {
    return "system";
  }

  get(type: ClipboardType): string {
    return type === "selection" ? "" : this.cache;
  }

  set(contents: string, type: ClipboardType): void {
    if (type === "selection") return;
    this.cache = contents;
    void navigator.clipboard.writeText(contents).catch(() => undefined);
  }

  refresh(): void {
    navigator.clipboard
      .readText()
      .then((text) => {
        this.cache = text;
      })
      .catch(() => undefined);
  }
}
