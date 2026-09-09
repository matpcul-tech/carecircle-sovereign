// Registers the resolve hook in the main thread so route imports of
// `next/server` and the `@/` alias resolve during tests.
import { register } from "node:module";
import { pathToFileURL } from "node:url";
register("./loader.mjs", pathToFileURL(import.meta.dirname + "/"));
