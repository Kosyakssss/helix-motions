import packedTreeSitter from "../../tree-sitter/tree-sitter.wasm";
import { createLoader, SyntaxSessions } from "../syntax/languages";
import { unpack } from "./wasm";

export async function loadSyntax(): Promise<SyntaxSessions> {
  return new SyntaxSessions(await createLoader(await unpack(packedTreeSitter)), (work) => {
    window.requestIdleCallback(work, { timeout: 2000 });
  });
}
