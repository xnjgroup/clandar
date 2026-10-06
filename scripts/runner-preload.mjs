/**
 * Preloaded by `npm run runner`: outside Next.js, `server-only` (a marker that throws unless React's
 * server build is in use) is mapped to its empty module — the runner is server code by definition.
 * Only that one package is affected; React and everything else load normally.
 */
import { registerHooks } from "node:module";

const empty = new URL("../node_modules/server-only/empty.js", import.meta.url).href;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: empty, shortCircuit: true };
    return next(specifier, context);
  },
});
