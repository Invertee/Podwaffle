"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { validateSchedule } = require("./schedule");

function loadConfig(env = process.env, options) {
  if (!options) {
    const filename = env.PODWAFFLE_ANALYSIS_OPTIONS || "/data/options.json";
    options = fs.existsSync(filename)
      ? JSON.parse(fs.readFileSync(filename, "utf8"))
      : {};
  }
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw new Error("Options must be a JSON object");
  const value = (key, name, fallback) =>
    env[name] !== undefined && env[name] !== ""
      ? env[name]
      : (options[key] ?? fallback);
  const number = (key, name, fallback, min, max) => {
    const n = Number(value(key, name, fallback));
    if (!Number.isSafeInteger(n) || n < min || n > max)
      throw new Error(`Invalid ${key}: expected ${min}..${max}`);
    return n;
  };
  const dataDir = path.resolve(env.DATA_DIR || "./data");
  const modelDir = path.join(dataDir, "models");
  const model = value("whisper_model", "WHISPER_MODEL", "tiny.en");
  if (!["tiny.en", "base.en"].includes(model))
    throw new Error("whisper_model must be tiny.en or base.en");
  const selectedClassifier = value("classifier", "CLASSIFIER", "rules");
  if (!["rules", "jev", "local", "gemini"].includes(selectedClassifier))
    throw new Error("Invalid classifier");
  // Never enable a remote provider implicitly when upgrading a local install.
  const removedClassifier = ["local", "gemini"].includes(selectedClassifier);
  const classifier = removedClassifier ? "rules" : selectedClassifier;
  const jevKey = value("jev_api_key", "PODCAST_JEV_API_KEY", "");
  if (typeof jevKey !== "string" || /[\r\n]/.test(jevKey))
    throw new Error("Invalid jev_api_key");
  if (classifier === "jev" && !jevKey.trim())
    throw new Error(
      "Jev classifier requires jev_api_key (DigitalOcean model access key)",
    );
  const jevModel = value(
    "jev_model",
    "PODCAST_JEV_MODEL",
    "typesafe-jev-1.13.0",
  );
  if (typeof jevModel !== "string" || !jevModel.trim() || jevModel.length > 200)
    throw new Error("Invalid jev_model");
  const scheduleEnabled = value("schedule_enabled", "SCHEDULE_ENABLED", true);
  if (![true, false, "true", "false"].includes(scheduleEnabled))
    throw new Error("schedule_enabled must be true or false");
  const schedule = validateSchedule({
    enabled: scheduleEnabled === true || scheduleEnabled === "true",
    start: value("schedule_start", "SCHEDULE_START", "23:00"),
    end: value("schedule_end", "SCHEDULE_END", "07:00"),
    timeZone: value("schedule_timezone", "SCHEDULE_TIMEZONE", "Europe/London"),
  });
  return {
    schedule,
    dataDir,
    modelDir,
    host: env.HOST || "0.0.0.0",
    port: number("port", "PORT", 5000, 1, 65535),
    databasePath: path.join(dataDir, "podwaffle-analysis.sqlite"),
    logPath: path.join(dataDir, "logs", "podcast-analysis.log"),
    logMaxBytes: 5 * 1024 * 1024,
    podcastCacheDir: path.join(dataDir, "cache"),
    ffmpegPath: env.FFMPEG_PATH || "ffmpeg",
    ffprobePath: env.FFPROBE_PATH || "ffprobe",
    podcastWhisperPath: env.PODCAST_WHISPER_PATH || "whisper-cli",
    podcastWhisperModel: path.join(modelDir, `ggml-${model}.bin`),
    whisperModelName: model,
    podcastWhisperThreads: number(
      "whisper_threads",
      "PODCAST_WHISPER_THREADS",
      2,
      1,
      64,
    ),
    podcastSampleSeconds: number(
      "sample_seconds",
      "PODCAST_SAMPLE_SECONDS",
      900,
      30,
      3600,
    ),
    podcastMaxBytes:
      number("max_audio_mb", "MAX_AUDIO_MB", 512, 1, 2048) * 1024 * 1024,
    podcastJobTimeoutMs:
      number("job_timeout_minutes", "JOB_TIMEOUT_MINUTES", 60, 1, 1440) * 60000,
    classifier,
    classifierWarning: removedClassifier
      ? `${selectedClassifier} classification has been removed. Using phrase rules; select jev and configure jev_api_key to use DigitalOcean.`
      : null,
    podcastJevKey: jevKey.trim(),
    podcastJevModel: jevModel.trim(),
    podcastJevUrl: "https://inference.do-ai.run/v1/systemone",
    jevRequestTimeoutMs:
      number("jev_timeout_seconds", "JEV_TIMEOUT_SECONDS", 30, 5, 300) * 1000,
  };
}
module.exports = { loadConfig };
