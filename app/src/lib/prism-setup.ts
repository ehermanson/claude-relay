// `@lexical/code` ships bundled Prism grammar components (clike, javascript, …)
// that register themselves by reading a *global* `Prism` (e.g. `Prism.languages.clike = …`).
// Prism's core is supposed to install that global itself via `_self.Prism = …`, but
// under our bundler (rolldown-vite) prismjs's CommonJS self-registration does not reach
// `window`/`globalThis`, so the grammar components throw `ReferenceError: Prism is not defined`
// at module-eval time and the editor (and any page that mounts it, e.g. Settings) crashes.
//
// Fix: import Prism's instance explicitly and pin it on the global ourselves. This module
// MUST be imported (for its side effect) before `@lexical/code` so the global exists by the
// time the grammar components evaluate.
import Prism from "prismjs";

const globalScope = globalThis as typeof globalThis & { Prism?: unknown };
if (!globalScope.Prism) {
  globalScope.Prism = Prism;
}
