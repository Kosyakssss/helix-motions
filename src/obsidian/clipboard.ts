import type { ClipboardProvider, ClipboardType } from "../registers";

interface ElectronClipboardApi {
  readText(): string;
  writeText(text: string): void;
}

function electronClipboard(): ElectronClipboardApi | null {
  try {
    const req = (window as unknown as { require?: (m: string) => { clipboard?: ElectronClipboardApi } }).require;
    return req?.("electron")?.clipboard ?? null;
  } catch {
    return null;
  }
}

export class ElectronClipboard implements ClipboardProvider {
  private api = electronClipboard();
  private fallback = "";
  name(): string {
    return this.api ? "electron" : "memory";
  }
  get(type: ClipboardType): string {
    if (type === "selection") return "";
    if (this.api) return this.api.readText();
    return this.fallback;
  }
  set(contents: string, type: ClipboardType): void {
    if (type === "selection") return;
    if (this.api) this.api.writeText(contents);
    else {
      this.fallback = contents;
      void navigator.clipboard?.writeText(contents);
    }
  }
}
