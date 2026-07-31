/* eslint-disable @typescript-eslint/no-require-imports */
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// Keep Gradle's embedded release bundle rooted at apps/android in this pnpm
// workspace instead of resolving the entry from the monorepo root.
config.server.unstable_serverRoot = projectRoot;

config.resolver.sourceExts = [
  ...config.resolver.sourceExts,
  "ts",
  "tsx",
  "mts",
];

module.exports = config;
