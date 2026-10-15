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

// Contracts use Node ESM .js specifiers for their emitted output. Metro consumes
// their TypeScript source, so resolve those relative imports without the suffix.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const source = context.originModulePath.replace(/\\/g, "/");
  const target =
    source.includes("/packages/contracts/src/") &&
    moduleName.startsWith(".") &&
    moduleName.endsWith(".js")
      ? moduleName.slice(0, -3)
      : moduleName;
  return context.resolveRequest(context, target, platform);
};

module.exports = config;
