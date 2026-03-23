import type { KnipConfig } from "knip";

const config: KnipConfig = {
  workspaces: {
    ".": {
      entry: ["scripts/*.ts"],
      project: ["src/**/*.ts"],
    },
    ui: {
      entry: ["src/routes/**/*.tsx"],
      project: ["src/**/*.{ts,tsx}"],
      ignoreDependencies: [
        // used via @tailwindcss/postcss
        "tailwindcss",
        // used via root lint-staged config
        "oxfmt",
      ],
    },
  },
};

export default config;
