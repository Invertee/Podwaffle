"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createReadStream } = require("node:fs");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");

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
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.status = {
      ready: false,
      busy: false,
      stage: "pending",
      error: null,
      whisper: null,
      llm: null,
    };
    this.controller = new AbortController();
  }
  prepare() {
    if (this.pending) return this.pending;
    this.status.busy = true;
    this.status.error = null;
    this.pending = this.setup()
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
        this.pending = null;
      });
    return this.pending;
  }
  async setup() {
    const c = this.config,
      signal = this.controller.signal;
    this.status.ready = false;
    const report = (name) => (stage, received, total) => {
      Object.assign(this.status, {
        stage: `${name}: ${stage}`,
        received,
        total,
      });
    };
    this.status.whisper = await ensureModel(
      "ggerganov/whisper.cpp",
      path.basename(c.podcastWhisperModel),
      c.podcastWhisperModel,
      signal,
      report("Whisper"),
    );
    // Whisper readiness is independent of the optional classifier. Failed local
    // setup does not prevent jobs using the documented rules fallback.
    this.status.ready = true;
    if (c.classifier === "local") {
      this.status.llm = await ensureModel(
        "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
        path.basename(c.llmModel),
        c.llmModel,
        "--alias",
        "local",
        signal,
        report("Qwen"),
      );
      if (!this.child) await this.startLlm(signal);
    }
    this.status.stage = "ready";
    this.logger.info("Models ready", { classifier: c.classifier });
  }
  async startLlm(signal) {
    const c = this.config;
    this.status.stage = "loading local classifier";
    const child = spawn(
      c.llmPath,
      [
        "-m",
        c.llmModel,
        "--host",
        "127.0.0.1",
        "--port",
        "8081",
        "-c",
        "8192",
        "-t",
        String(c.llmThreads),
        "-ngl",
        "0",
        "--parallel",
        "1",
        "--log-disable",
      ],
      { windowsHide: true, stdio: "ignore" },
    );
    this.child = child;
    let failure;
    this.childClosed = new Promise((resolve) => child.once("close", resolve));
    child.on("error", (error) => {
      failure = error;
    });
    child.on("exit", () => {
      failure = new Error(
        "Local classifier exited; check available RAM and model, then retry setup",
      );
      if (this.child === child) this.child = null;
      if (!signal.aborted) {
        this.status.error = failure.message;
        this.status.stage = "local classifier unavailable";
      }
    });
    try {
      for (let i = 0; i < 180; i++) {
        signal.throwIfAborted();
        if (failure) throw failure;
        try {
          if (
            (
              await fetch(`${c.llmUrl}/health`, {
                signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]),
              })
            ).ok
          )
            return;
        } catch {
          /* loading */
        }
        await delay(1000, undefined, { signal });
      }
      throw new Error(
        "Local classifier did not become ready within three minutes",
      );
    } catch (error) {
      await this.stopChild();
      throw error;
    }
  }
  async stopChild() {
    const child = this.child;
    if (!child) return;
    child.kill();
    const force = setTimeout(() => child.kill("SIGKILL"), 5000);
    try {
      await this.childClosed;
    } finally {
      clearTimeout(force);
      if (this.child === child) this.child = null;
    }
  }
  async stop() {
    this.controller.abort();
    await this.pending;
    await this.stopChild();
  }
}
module.exports = { ensureModel, Models };
