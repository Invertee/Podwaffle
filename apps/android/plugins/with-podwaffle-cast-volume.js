const { withMainActivity } = require("expo/config-plugins");

function addImport(source, statement) {
  if (source.includes(statement)) return source;

  const imports = [...source.matchAll(/^import .+$/gm)];
  if (imports.length > 0) {
    const last = imports[imports.length - 1];
    const insertAt = last.index + last[0].length;
    return `${source.slice(0, insertAt)}\n${statement}${source.slice(insertAt)}`;
  }

  const packageMatch = source.match(/^package .+$/m);
  if (!packageMatch || packageMatch.index === undefined) {
    throw new Error("Could not locate the MainActivity package declaration.");
  }
  const insertAt = packageMatch.index + packageMatch[0].length;
  return `${source.slice(0, insertAt)}\n\n${statement}${source.slice(insertAt)}`;
}

module.exports = function withPodwaffleCastVolume(config) {
  return withMainActivity(config, (mod) => {
    if (mod.modResults.language !== "kt") {
      throw new Error("Podwaffle expects a Kotlin MainActivity.");
    }

    let source = mod.modResults.contents;
    source = addImport(source, "import android.view.KeyEvent");
    source = addImport(
      source,
      "import com.podwaffle.media.PodwaffleMediaService",
    );

    if (!source.includes("override fun dispatchKeyEvent(event: KeyEvent)")) {
      const marker = '  override fun getMainComponentName(): String = "main"';
      if (!source.includes(marker)) {
        throw new Error(
          "Could not locate getMainComponentName() in MainActivity.kt.",
        );
      }

      const method = `  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (
      event.action == KeyEvent.ACTION_DOWN &&
      PodwaffleMediaService.handleVolumeKey(event.keyCode)
    ) {
      return true
    }
    return super.dispatchKeyEvent(event)
  }

`;
      source = source.replace(marker, `${method}${marker}`);
    }

    mod.modResults.contents = source;
    return mod;
  });
};
