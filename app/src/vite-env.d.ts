/// <reference types="vite/client" />

// Minimal ambient declaration for prismjs (no @types/prismjs dependency).
// We only need the default-exported Prism instance to pin it on the global.
declare module "prismjs" {
  const Prism: { languages: Record<string, unknown>; [key: string]: unknown };
  export default Prism;
}
