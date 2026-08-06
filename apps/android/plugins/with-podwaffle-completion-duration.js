const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("expo/config-plugins");

module.exports = function withPodwaffleCompletionDuration(config) {
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
    if (source.includes("Guarantee a positive duration for a genuine end event")) {
      return mod;
    }

    const previous = `        val durationMs = if (observed) {
            lastObservedDurationMs ?: media.durationMs
        } else {
            media.durationMs
        }
        val positionMs = if (durationMs != null) {
            maxOf(durationMs, if (observed) lastObservedPositionMs else 0L)
        } else if (observed) {
            lastObservedPositionMs
        } else {
            0L
        }`;
    const replacement = `        val observedDurationMs = if (observed) {
            lastObservedDurationMs ?: media.durationMs
        } else {
            media.durationMs
        }
        // Guarantee a positive duration for a genuine end event. Some feeds omit
        // duration metadata and Media3 can transition before exposing a final
        // duration; reporting a matched position/duration lets the shared queue
        // remove the completed item instead of returning it as the next episode.
        val durationMs = observedDurationMs
            ?: maxOf(if (observed) lastObservedPositionMs else 0L, 1L)
        val positionMs = maxOf(
            durationMs,
            if (observed) lastObservedPositionMs else 0L,
        )`;

    if (!source.includes(previous)) {
      throw new Error("Could not locate native episode completion duration mapping.");
    }
    source = source.replace(previous, replacement);
    fs.writeFileSync(servicePath, source);
    return mod;
  }]);
};
