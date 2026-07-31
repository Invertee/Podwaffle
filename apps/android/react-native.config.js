/**
 * Expo SDK 52's module autolinker derives `expo.core` from the library
 * manifest when used from this pnpm workspace. The Java package has always
 * been `expo.modules`; keep the generated React Native PackageList accurate.
 */
module.exports = {
  dependencies: {
    expo: {
      platforms: {
        android: {
          packageImportPath: "import expo.modules.ExpoModulesPackage;",
          packageInstance: "new ExpoModulesPackage()",
        },
      },
    },
  },
};
