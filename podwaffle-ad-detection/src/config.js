"use strict";
const fs = require("node:fs");
const path = require("node:path");

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
  const classifier = value("classifier", "CLASSIFIER", "rules");
  if (!["rules", "local", "gemini"].includes(classifier))
    throw new Error("Invalid classifier");
  const geminiKey = value("gemini_api_key", "PODCAST_GEMINI_API_KEY", "");
  if (classifier === "gemini" && !geminiKey)
    throw new Error("Gemini classifier requires gemini_api_key");
  return {
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
    podcastGeminiKey: geminiKey,
    podcastGeminiModel: value(
      "gemini_model",
      "PODCAST_GEMINI_MODEL",
      "gemini-2.5-flash",
    ),
    llmPath: env.LLAMA_SERVER_PATH || "llama-server",
    llmUrl: "http://127.0.0.1:8081",
    llmModel: path.join(modelDir, "qwen2.5-1.5b-instruct-q4_k_m.gguf"),
    llmThreads: number("llm_threads", "LLM_THREADS", 2, 1, 64),
  };
}
module.exports = { loadConfig };
