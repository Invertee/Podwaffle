"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createReadStream } = require("node:fs");

async function digest(filename) {
  const hash = createHash("sha256");
  for await (const data of createReadStream(filename)) hash.update(data);
  return hash.digest("hex");
}

// Resolve the upstream revision once, verify LFS SHA-256, then atomically install.
// Cached verified models work offline; restarts never silently change models.
async function ensureModel(
  repo,
  filename,
  destination,
  signal,
  report,
  fetcher = fetch,
) {
  const manifestPath = `${destination}.json`;
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    if (
      manifest.repo === repo &&
      manifest.filename === filename &&
      (await fs.stat(destination)).size === manifest.size &&
      (await digest(destination)) === manifest.sha256
    ) {
      report("cached", manifest.size, manifest.size);
      return manifest;
    }
  } catch (error) {
    if (signal.aborted) throw error;
  }
  const response = await fetcher(
    `https://huggingface.co/api/models/${repo}/revision/main?blobs=true`,
    { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) },
  );
  if (!response.ok)
    throw new Error(`Model metadata returned HTTP ${response.status}`);
  const metadata = await response.json();
  const entry = metadata.siblings?.find((item) => item.rfilename === filename);
  const sha256 = entry?.lfs?.sha256;
  const size = entry?.lfs?.size;
  if (
    !/^[a-f0-9]{64}$/.test(sha256 ?? "") ||
    !/^[a-f0-9]{40}$/.test(metadata.sha ?? "") ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > 2 * 1024 ** 3
  )
    throw new Error("Invalid upstream model metadata");
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const partial = `${destination}.part`;
  const hash = createHash("sha256");
  let received = 0;
  report("downloading", 0, size);
  try {
    const download = await fetcher(
      `https://huggingface.co/${repo}/resolve/${metadata.sha}/${filename}`,
      { signal: AbortSignal.any([signal, AbortSignal.timeout(30 * 60000)]) },
    );
    if (!download.ok || !download.body)
      throw new Error(`Model download returned HTTP ${download.status}`);
    const handle = await fs.open(partial, "w");
    try {
      for await (const chunk of download.body) {
        received += chunk.length;
        if (received > size) throw new Error("Model exceeds expected size");
        hash.update(chunk);
        await handle.writeFile(chunk);
        report("downloading", received, size);
      }
    } finally {
      await handle.close();
    }
    if (received !== size || hash.digest("hex") !== sha256)
      throw new Error("Model checksum mismatch");
    await fs.rename(partial, destination);
    const manifest = {
      repo,
      filename,
      revision: metadata.sha,
      sha256,
      size,
      installedAt: new Date().toISOString(),
    };
    await fs.writeFile(`${manifestPath}.part`, JSON.stringify(manifest));
    await fs.rename(`${manifestPath}.part`, manifestPath);
    report("ready", size, size);
    return manifest;
  } finally {
    await fs.rm(partial, { force: true });
    await fs.rm(`${manifestPath}.part`, { force: true });
  }
}

class Models {
  constructor(config, logger, { fetcher = fetch } = {}) {
    this.config = config;
    this.logger = logger;
    this.fetcher = fetcher;
    this.status = {
      ready: false,
      busy: false,
      stage: "pending",
      error: null,
      whisper: null,
      operation: null,
    };
    this.controller = new AbortController();
  }
  prepare(target = "configured") {
    if (!["configured", "whisper"].includes(target))
      throw Object.assign(new Error("Unknown model target"), {
        statusCode: 400,
      });
    if (this.pending) {
      if (this.status.operation !== target)
        throw Object.assign(
          new Error("Another model operation is in progress"),
          { statusCode: 409 },
        );
      return this.pending;
    }
    this.controller.signal.throwIfAborted();
    this.status.busy = true;
    this.status.operation = target;
    this.status.error = null;
    this.status.received = 0;
    this.status.total = 0;
    this.pending = this.setup(target)
      .catch((error) => {
        this.status.error = error.message;
        this.status.stage = "error";
        this.logger.error(
          "Model setup failed; use Retry model setup after fixing the problem",
          { error: error.message },
        );
      })
      .finally(() => {
        this.status.busy = false;
        this.status.operation = null;
        this.pending = null;
      });
    return this.pending;
  }
  async setup(target) {
    const c = this.config,
      signal = this.controller.signal;
    delete this.status.legacyCleanupWarning;
    // Only remove the obsolete files this add-on itself previously downloaded.
    // Whisper files, databases, logs and unrelated models are untouched.
    const legacyName = "qwen2.5-1.5b-instruct-q4_k_m.gguf";
    for (const suffix of ["", ".json", ".part", ".json.part"]) {
      const filename = path.join(c.modelDir, legacyName + suffix);
      try {
        await fs.unlink(filename);
        this.logger.info("Removed obsolete local classifier cache", {
          filename: legacyName + suffix,
        });
      } catch (error) {
        if (error.code !== "ENOENT") {
          this.status.legacyCleanupWarning =
            "Could not remove the obsolete Qwen cache; check storage permissions.";
          this.logger.error(this.status.legacyCleanupWarning);
        }
      }
    }
    const report = (name) => (stage, received, total) => {
      Object.assign(this.status, {
        stage: `${name}: ${stage}`,
        received,
        total,
      });
    };
    if (target === "configured" || target === "whisper") {
      this.status.ready = false;
      this.status.whisper = await ensureModel(
        "ggerganov/whisper.cpp",
        path.basename(c.podcastWhisperModel),
        c.podcastWhisperModel,
        signal,
        report("Whisper"),
        this.fetcher,
      );
      this.status.ready = true;
    }
    this.status.stage = "ready";
    this.logger.info("Models ready", { classifier: c.classifier });
  }
  async stop() {
    this.controller.abort();
    await this.pending;
  }
}
module.exports = { ensureModel, Models };
