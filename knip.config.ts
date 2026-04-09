import type { KnipConfig } from "knip";

const config: KnipConfig = {
  ignoreExportsUsedInFile: true,
  exclude: ["duplicates"],
  workspaces: {
    ".": {
      entry: ["cli/bin.ts", "server/index.ts"],
      project: ["server/**/*.ts", "cli/**/*.ts"],
    },
    app: {
      entry: ["src/routes/**/*.tsx"],
      project: ["src/**/*.{ts,tsx}"],
      ignore: ["src/components/ui/**"],
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
