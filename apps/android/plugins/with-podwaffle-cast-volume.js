const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod, withMainActivity } = require("expo/config-plugins");

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

function withCastVolumeKeys(config) {
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
}

function withBluetoothSkipKeys(config) {
  return withDangerousMod(config, ["android", async (mod) => {
    const servicePath = path.join(
      mod.modRequest.projectRoot,
      "modules",
      "podwaffle-media",
      "android",
      "src",
      "main",
      "java",
      "com",
      "podwaffle",
      "media",
      "PodwaffleMediaService.kt",
    );
    let source = fs.readFileSync(servicePath, "utf8");
    if (source.includes("override fun onMediaButtonEvent(")) return mod;

    const marker = `        }
    }

    private fun createPlayerListener`;
    if (!source.includes(marker)) {
      throw new Error("Could not locate the Podwaffle MediaSession callback.");
    }

    const method = `        }

        override fun onMediaButtonEvent(
            session: MediaSession,
            controllerInfo: MediaSession.ControllerInfo,
            intent: Intent,
        ): Boolean {
            @Suppress("DEPRECATION")
            val event = intent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
                ?: return false
            val offsetMs = when (event.keyCode) {
                KeyEvent.KEYCODE_MEDIA_PREVIOUS,
                KeyEvent.KEYCODE_MEDIA_REWIND -> -(
                    NativeConfigurationStore.current?.skipBackwardMs
                        ?: DEFAULT_SKIP_BACK_MS
                )
                KeyEvent.KEYCODE_MEDIA_NEXT,
                KeyEvent.KEYCODE_MEDIA_FAST_FORWARD ->
                    NativeConfigurationStore.current?.skipForwardMs
                        ?: DEFAULT_SKIP_FORWARD_MS
                else -> return false
            }
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
                skipBy(offsetMs)
            }
            // Consume both key-down and key-up so Media3 cannot also navigate
            // to the previous or next episode in the queue.
            return true
        }
    }

    private fun createPlayerListener`;

    source = source.replace(marker, method);
    fs.writeFileSync(servicePath, source);
    return mod;
  }]);
}

function withAutomaticQueueDownloads(config) {
  return withDangerousMod(config, ["android", async (mod) => {
    const modulePath = path.join(
      mod.modRequest.projectRoot,
      "modules",
      "podwaffle-media",
      "android",
      "src",
      "main",
      "java",
      "com",
      "podwaffle",
      "media",
      "PodwaffleMediaModule.kt",
    );
    let source = fs.readFileSync(modulePath, "utf8");
    if (source.includes("Automatically cache every queued episode")) return mod;

    const marker = `                val store = service.getDownloadStore()
                val enriched = snapshot.items.map { media ->`;
    if (!source.includes(marker)) {
      throw new Error("Could not locate the native setQueue download store.");
    }

    const replacement = `                val store = service.getDownloadStore()
                // Automatically cache every queued episode. DownloadManager.add()
                // is idempotent for queued, active and completed items, while a
                // storage or network failure must never block the queue update.
                snapshot.items.forEach { media ->
                    if (
                        media.enclosureUrl.isNotBlank() &&
                        store.completedPath(media.episodeId) == null
                    ) {
                        runCatching { store.add(media.toMap(), "automatic") }
                    }
                }
                val enriched = snapshot.items.map { media ->`;

    source = source.replace(marker, replacement);
    fs.writeFileSync(modulePath, source);
    return mod;
  }]);
}

module.exports = function withPodwaffleMediaControls(config) {
  return withAutomaticQueueDownloads(
    withBluetoothSkipKeys(withCastVolumeKeys(config)),
  );
};
