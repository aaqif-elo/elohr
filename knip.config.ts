import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: [
    "src/entry-client.tsx",
    "src/entry-server.tsx",
    "src/app.tsx",
    "src/routes/**/*.{ts,tsx}",
    "src/server/middleware/index.ts",
    "app.config.ts",
    "scripts/**/*.ts",
  ],
  project: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
  ignoreDependencies: [
    "sodium-native", // native dependency loaded by discord.js voice
  ],
  ignoreBinaries: [
    "tsc", // used via typescript package in typecheck script
    "scripts\\\\build.bat", // Windows build script referenced in package.json
  ],
};

export default config;
