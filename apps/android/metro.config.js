/* eslint-disable @typescript-eslint/no-require-imports */
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// Expo SDK 52 detects the pnpm workspace automatically. Explicitly adding the
// repository root as a watch folder makes embedded release bundling resolve
// the app entry relative to the wrong directory.
// Keep Metro's HTTP/server root at the app, too. Expo's workspace default is
// useful for web URLs but makes Gradle's `export:embed` look for index.js at
// the repository root instead of apps/android.
config.server.unstable_serverRoot = projectRoot;

// Allow importing .ts files from shared packages
config.resolver.sourceExts = [
  ...config.resolver.sourceExts,
  "ts",
  "tsx",
  "mts",
];

module.exports = config;
