// Resolve hook so plain `node --experimental-strip-types` can import the
// real Next.js route handlers: maps bare `next/*` specifiers to their
// on-disk `.js` and the project's `@/` tsconfig alias to ./src.
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = pathResolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") {
    return nextResolve("next/server.js", context);
  }
  if (specifier.startsWith("@/")) {
    const base = pathResolve(ROOT, "src", specifier.slice(2));
    for (const ext of [".ts", ".tsx", "/index.ts", ".js"]) {
      const p = base + ext;
      if (existsSync(p)) return { url: pathToFileURL(p).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
