"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const { instructions, context, classifyLocal } = require("./classifier");

function validateRequest(body) {
  const fail = (message) => {
    const e = new Error(message);
    e.statusCode = 400;
    throw e;
  };
  if (!body || typeof body !== "object") fail("JSON request required");
  for (const name of ["requestKey", "episodeId", "title", "enclosureUrl"]) {
    if (
      typeof body[name] !== "string" ||
      !body[name].trim() ||
      body[name].length > 4096
    )
      fail(`Invalid ${name}`);
  }
  for (const name of ["enclosureUrl", "chaptersUrl"]) {
    if (!body[name]) continue;
    let url;
    try {
      url = new URL(body[name]);
    } catch {
      fail(`Invalid ${name}`);
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      fail(`${name} must use HTTP(S) without credentials`);
  }
  const phrases = body.phrases ?? [];
  const llmPrompt = body.llmPrompt ?? "";
  const sensitivity = body.sensitivity ?? "balanced";
  const edgeFocusMinutes = body.edgeFocusMinutes ?? 5;
  const metadata = {};
  for (const [name, limit] of Object.entries({
    podcastTitle: 500,
    podcastDescription: 8000,
    episodeDescription: 8000,
  })) {
    if (body[name] === undefined) continue;
    if (typeof body[name] !== "string" || body[name].length > limit)
      fail(`Invalid ${name} (maximum ${limit} characters)`);
    metadata[name] = body[name]
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (
    !Array.isArray(phrases) ||
    phrases.length > 50 ||
    phrases.some((p) => typeof p !== "string" || !p.trim() || p.length > 160)
  )
    fail(
      "phrases must contain at most 50 nonempty phrases of up to 160 characters",
    );
  if (typeof llmPrompt !== "string" || llmPrompt.length > 2000)
    fail("llmPrompt must contain at most 2000 characters");
  if (!["low", "balanced", "high"].includes(sensitivity))
    fail("sensitivity must be low, balanced or high");
  if (
    !Number.isSafeInteger(edgeFocusMinutes) ||
    edgeFocusMinutes < 0 ||
    edgeFocusMinutes > 15
  )
    fail("edgeFocusMinutes must be an integer from 0 to 15");
  return {
    requestKey: body.requestKey,
    episodeId: body.episodeId,
    title: body.title,
    enclosureUrl: body.enclosureUrl,
    chaptersUrl: body.chaptersUrl || null,
    phrases: [...new Set(phrases.map((p) => p.trim()))],
    llmPrompt: llmPrompt.trim(),
    sensitivity,
    edgeFocusMinutes,
    ...metadata,
  };
}

function run(binary, args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      windowsHide: true,
      signal,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data;
      if (stdout.length > 8 * 1024 * 1024) child.kill();
    });
    child.stderr.on("data", (data) => {
      stderr = (stderr + data).slice(-2 * 1024 * 1024);
    });
    child.on("error", reject);
    // Avoid retaining transcript text or URLs from arbitrary tool output in logs.
    child.on("close", (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(
            new Error(
              `${path.basename(binary)} exited with code ${code}; check executable, model and input format`,
            ),
          ),
    );
  });
}

async function download(url, file, maxBytes, signal) {
  const response = await fetch(url, {
    signal,
    headers: { "user-agent": "Podwaffle-Analysis/1.0" },
  });
  if (!response.ok || !response.body)
    throw new Error(`Audio download returned HTTP ${response.status}`);
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body.cancel();
    throw new Error("Audio exceeds download size limit");
  }
  const handle = await fs.open(file, "w");
  let size = 0;
  const hash = createHash("sha256");
  try {
    for await (const data of response.body) {
      size += data.length;
      if (size > maxBytes) throw new Error("Audio exceeds download size limit");
      hash.update(data);
      await handle.writeFile(data);
    }
  } finally {
    await handle.close();
  }
  return {
    sha256: hash.digest("hex"),
    sizeBytes: size,
    etag: response.headers.get("etag"),
  };
}

function sampleWindows(
  durationMs,
  boundaries,
  budgetSeconds,
  edgeFocusMinutes = 5,
) {
  const windows = new Map();
  const add = (start) => {
    start = Math.max(
      0,
      Math.min(
        Math.floor(start / 1000) * 1000,
        Math.max(0, durationMs - 30000),
      ),
    );
    const end = Math.min(durationMs, start + 30000);
    if (
      end > start &&
      ![...windows.values()].some((w) => Math.abs(w.startMs - start) < 15000)
    )
      windows.set(start, { startMs: start, endMs: end });
  };
  const focusMs = edgeFocusMinutes * 60000;
  const edgeSpanMs = focusMs || 60000;
  for (let start = 0; start < Math.min(durationMs, edgeSpanMs); start += 30000)
    add(start);
  for (
    let start = Math.max(0, durationMs - edgeSpanMs);
    start < durationMs;
    start += 30000
  )
    add(start);
  for (const boundary of boundaries) add(boundary - 15000);
  for (let start = 60000; start < durationMs; start += 120000) add(start);
  const sorted = [...windows.values()].sort((a, b) => a.startMs - b.startMs);
  const limit = Math.max(1, Math.floor(budgetSeconds / 30));
  if (sorted.length <= limit) return sorted;
  const edge = sorted.filter(
    (window) =>
      window.startMs < edgeSpanMs || window.endMs > durationMs - edgeSpanMs,
  );
  const spread = (items, count) =>
    count >= items.length
      ? items
      : Array.from(
          { length: count },
          (_, index) =>
            items[
              Math.round((index * (items.length - 1)) / Math.max(1, count - 1))
            ],
        );
  // With edge focus enabled, reserve about two thirds of the fixed budget for
  // the beginning/end and distribute the remainder over the full episode.
  const edgeLimit = Math.min(
    edge.length,
    limit,
    edgeFocusMinutes > 0 ? Math.max(2, Math.ceil((limit * 2) / 3)) : 2,
  );
  const selected = spread(edge, edgeLimit);
  const selectedStarts = new Set(selected.map((window) => window.startMs));
  selected.push(
    ...spread(
      sorted.filter((window) => !selectedStarts.has(window.startMs)),
      limit - selected.length,
    ),
  );
  return selected.sort((a, b) => a.startMs - b.startMs);
}

function sensitivityThreshold(sensitivity) {
  return { low: 0.75, balanced: 0.55, high: 0.35 }[sensitivity] ?? 0.55;
}

function applySensitivity(segments, sensitivity) {
  const threshold = sensitivityThreshold(sensitivity);
  return segments.filter(
    (segment) =>
      !["advertisement", "promotion"].includes(segment.kind) ||
      segment.confidence >= threshold,
  );
}

function parseWhisper(json, window) {
  if (!Array.isArray(json.transcription))
    throw new Error("Unrecognised whisper.cpp JSON output");
  return json.transcription.flatMap((item) => {
    const from = Number(item.offsets?.from),
      to = Number(item.offsets?.to);
    const text = String(item.text ?? "").trim();
    if (!text || !Number.isFinite(from) || !Number.isFinite(to) || to <= from)
      return [];
    const startMs = Math.max(window.startMs, window.startMs + from);
    const endMs = Math.min(window.endMs, window.startMs + to);
    return endMs > startMs
      ? [{ startMs, endMs, text: text.slice(0, 4000) }]
      : [];
  });
}

function classifyRules(fragments, phrases) {
  const indicators = [
    "sponsored by",
    "our sponsor",
    "promo code",
    "discount code",
    "use code",
    "brought to you by",
    "this episode is sponsored",
    ...phrases,
  ];
  return fragments.flatMap((fragment) => {
    const matched = indicators.filter((p) =>
      fragment.text.toLowerCase().includes(p.toLowerCase()),
    );
    if (!matched.length) return [];
    return [
      {
        startMs: fragment.startMs,
        endMs: fragment.endMs,
        kind: "advertisement",
        title: "Possible advert",
        confidence: 0.6,
        source: "rules",
        evidence: matched.map((p) => `Phrase: ${p}`).join("; "),
        boundaryStatus: "approximate",
      },
    ];
  });
}

function validateSegments(segments, durationMs) {
  if (!Array.isArray(segments) || segments.length > 2000)
    throw new Error("Invalid classifier segments");
  return segments.map((s) => {
    if (
      !Number.isFinite(s.startMs) ||
      !Number.isFinite(s.endMs) ||
      s.startMs < 0 ||
      s.endMs <= s.startMs ||
      s.endMs > durationMs ||
      ![
        "advertisement",
        "promotion",
        "chapter",
        "intro",
        "outro",
        "unknown",
      ].includes(s.kind) ||
      typeof s.title !== "string" ||
      !Number.isFinite(s.confidence) ||
      s.confidence < 0 ||
      s.confidence > 1
    )
      throw new Error("Invalid classifier segment bounds or type");
    return {
      startMs: Math.round(s.startMs),
      endMs: Math.round(s.endMs),
      kind: s.kind,
      title: s.title.slice(0, 200),
      confidence: s.confidence,
      source: s.source ?? "gemini",
      evidence: String(s.evidence ?? "").slice(0, 500),
      boundaryStatus: "approximate",
    };
  });
}

async function classifyGemini(fragments, request, durationMs, config, signal) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.podcastGeminiModel)}:generateContent`,
    {
      method: "POST",
      signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": config.podcastGeminiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  instructions +
                  "\n" +
                  JSON.stringify({
                    durationMs,
                    context: context(request),
                    phrases: request.phrases,
                    fragments,
                  }),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              segments: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    startMs: { type: "INTEGER" },
                    endMs: { type: "INTEGER" },
                    kind: {
                      type: "STRING",
                      enum: [
                        "advertisement",
                        "promotion",
                        "chapter",
                        "intro",
                        "outro",
                        "unknown",
                      ],
                    },
                    title: { type: "STRING" },
                    confidence: { type: "NUMBER" },
                    evidence: { type: "STRING" },
                  },
                  required: [
                    "startMs",
                    "endMs",
                    "kind",
                    "title",
                    "confidence",
                    "evidence",
                  ],
                },
              },
            },
            required: ["segments"],
          },
        },
      }),
    },
  );
  if (!response.ok) throw new Error(`Gemini returned HTTP ${response.status}`);
  const body = await response.json();
  const text = body.candidates?.[0]?.content?.parts
    ?.map((p) => p.text || "")
    .join("");
  const result = validateSegments(JSON.parse(text).segments, durationMs).map(
    (segment) => ({ ...segment, source: "gemini" }),
  );
  // Require every range to be supported by neighbouring transcript spans. Small
  // speech pauses are allowed, but no range may cross an unsampled gap.
  return result.filter((s) => {
    let coveredUntil = s.startMs;
    for (const f of fragments) {
      if (f.endMs <= coveredUntil) continue;
      if (f.startMs > coveredUntil + 2000) break;
      coveredUntil = Math.max(coveredUntil, f.endMs);
      if (coveredUntil >= s.endMs) return true;
    }
    return false;
  });
}

async function analyse(request, config, signal, progress, execute = run) {
  if (!config.podcastWhisperModel)
    throw new Error(
      "Set PODCAST_WHISPER_MODEL to the English tiny.en or base.en model file",
    );
  await fs.access(config.podcastWhisperModel);
  await fs.mkdir(config.podcastCacheDir, { recursive: true });
  const directory = await fs.mkdtemp(
    path.join(config.podcastCacheDir, "podcast-"),
  );
  try {
    progress("downloading", 5);
    const input = path.join(directory, "audio");
    const fingerprint = await download(
      request.enclosureUrl,
      input,
      config.podcastMaxBytes,
      signal,
    );
    progress("probing", 15);
    const probe = JSON.parse(
      (
        await execute(
          config.ffprobePath,
          [
            "-v",
            "error",
            "-show_format",
            "-show_chapters",
            "-of",
            "json",
            input,
          ],
          signal,
        )
      ).stdout,
    );
    const durationMs = Math.round(Number(probe.format?.duration) * 1000);
    if (
      !Number.isFinite(durationMs) ||
      durationMs <= 0 ||
      durationMs > 8 * 3600000
    )
      throw new Error("Unsupported audio duration (maximum 8 hours)");
    progress("acoustic scan", 20);
    const acoustic = {
      low: { noise: "-40dB", duration: "0.8" },
      balanced: { noise: "-35dB", duration: "0.6" },
      high: { noise: "-30dB", duration: "0.35" },
    }[request.sensitivity];
    const scan = await execute(
      config.ffmpegPath,
      [
        "-nostdin",
        "-hide_banner",
        "-i",
        input,
        "-vn",
        "-af",
        `silencedetect=n=${acoustic.noise}:d=${acoustic.duration}`,
        "-f",
        "null",
        "-",
      ],
      signal,
    );
    const boundaries = [...scan.stderr.matchAll(/silence_end: ([\d.]+)/g)].map(
      (m) => Math.round(Number(m[1]) * 1000),
    );
    const warnings = [
      "Experimental suggestions; unsampled audio may contain adverts. Media identity has not been verified against client playback.",
    ];
    let segments = (probe.chapters ?? []).map((c) => ({
      startMs: Math.round(Number(c.start_time) * 1000),
      endMs: Math.min(durationMs, Math.round(Number(c.end_time) * 1000)),
      kind: "chapter",
      title: c.tags?.title || "Chapter",
      confidence: 1,
      source: "embedded",
      evidence: "Embedded media chapter",
    }));
    if (request.chaptersUrl) {
      try {
        const response = await fetch(request.chaptersUrl, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
        });
        if (!response.ok) throw new Error("Chapter HTTP error");
        const reader = response.body.getReader();
        let text = "";
        const decoder = new TextDecoder();
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            text += decoder.decode(part.value, { stream: true });
            if (text.length > 1024 * 1024)
              throw new Error("Chapter file too large");
          }
        } finally {
          await reader.cancel();
        }
        const chapters = JSON.parse(text + decoder.decode()).chapters;
        if (!Array.isArray(chapters) || chapters.length > 1000)
          throw new Error("Invalid chapter file");
        const sorted = chapters
          .filter(
            (c) =>
              Number.isFinite(c.startTime) &&
              c.startTime >= 0 &&
              c.startTime * 1000 < durationMs,
          )
          .sort((a, b) => a.startTime - b.startTime);
        segments = sorted.map((c, i) => ({
          startMs: Math.round(c.startTime * 1000),
          endMs: Math.round(sorted[i + 1]?.startTime * 1000 || durationMs),
          kind: "chapter",
          title: String(c.title || "Chapter"),
          confidence: 1,
          source: "publisher",
          evidence:
            "Publisher chapter; timing may differ for dynamically inserted ads",
        }));
      } catch (error) {
        if (signal.aborted) throw error;
        warnings.push(
          "Publisher chapters could not be imported; using embedded chapters if available.",
        );
      }
    }
    segments = validateSegments(
      segments.filter((s) => s.endMs > s.startMs),
      durationMs,
    );
    const windows = sampleWindows(
      durationMs,
      boundaries,
      config.podcastSampleSeconds,
      request.edgeFocusMinutes,
    );
    const fragments = [];
    const transcribe = async (window, index, total) => {
      progress(
        `transcribing sample ${index + 1}/${total}`,
        Math.round(25 + (55 * index) / total),
      );
      const wav = path.join(directory, "sample.wav"),
        output = path.join(directory, "transcript");
      await execute(
        config.ffmpegPath,
        [
          "-nostdin",
          "-v",
          "error",
          "-y",
          "-ss",
          String(window.startMs / 1000),
          "-i",
          input,
          "-t",
          String((window.endMs - window.startMs) / 1000),
          "-vn",
          "-ar",
          "16000",
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          wav,
        ],
        signal,
      );
      await execute(
        config.podcastWhisperPath,
        [
          "-m",
          config.podcastWhisperModel,
          "-f",
          wav,
          "-l",
          "en",
          "-t",
          String(config.podcastWhisperThreads ?? 2),
          "-oj",
          "-of",
          output,
          "-nt",
        ],
        signal,
      );
      return parseWhisper(
        JSON.parse(await fs.readFile(`${output}.json`, "utf8")),
        window,
      );
    };
    for (let i = 0; i < windows.length; i++)
      fragments.push(...(await transcribe(windows[i], i, windows.length)));
    // Additional adjacent samples provide context around phrase hits; bounded to 8 windows.
    const hits = classifyRules(fragments, request.phrases);
    const extra = [];
    for (const hit of hits)
      for (const startMs of [Math.max(0, hit.startMs - 30000), hit.endMs]) {
        const window = {
          startMs,
          endMs: Math.min(durationMs, startMs + 30000),
        };
        if (
          extra.length < 8 &&
          window.endMs > startMs &&
          ![...windows, ...extra].some(
            (w) => Math.abs(w.startMs - startMs) < 15000,
          )
        )
          extra.push(window);
      }
    for (let i = 0; i < extra.length; i++)
      fragments.push(...(await transcribe(extra[i], i, extra.length)));
    windows.push(...extra);
    fragments.sort((a, b) => a.startMs - b.startMs);
    progress("classifying", 85);
    let provider = "rules",
      classifierAssessments = [];
    if (config.classifier === "local") {
      try {
        const local = await classifyLocal(
          fragments,
          request,
          durationMs,
          config,
          signal,
          validateSegments,
          fetch,
          (complete, total) =>
            progress(
              `classifying excerpt ${complete}/${total}`,
              Math.round(85 + (13 * complete) / Math.max(1, total)),
            ),
        );
        classifierAssessments = local.assessments;
        const failureSummary = local.failureReasons.slice(0, 3).join(" ");
        if (local.successfulCount > 0 || fragments.length === 0) {
          segments.push(
            ...applySensitivity(local.segments, request.sensitivity),
          );
          if (local.failedFragments.length) {
            segments.push(
              ...classifyRules(local.failedFragments, request.phrases),
            );
            warnings.push(
              `Local classification failed for ${local.failedFragments.length} of ${fragments.length} excerpts (${failureSummary}); phrase detection was used for those excerpts.`,
            );
          }
          provider = "local";
        } else {
          warnings.push(
            `Local classification failed for every excerpt (${failureSummary}); phrase detector used instead.`,
          );
        }
      } catch (error) {
        if (signal.aborted) throw error;
        warnings.push(
          `${error instanceof Error ? error.message : "Local classifier unavailable"}; phrase detector used instead. Check model status and available memory.`,
        );
      }
    } else if (config.classifier === "gemini" && config.podcastGeminiKey) {
      try {
        segments.push(
          ...applySensitivity(
            await classifyGemini(
              fragments,
              request,
              durationMs,
              config,
              signal,
            ),
            request.sensitivity,
          ),
        );
        provider = "gemini";
      } catch (error) {
        if (signal.aborted) throw error;
        warnings.push(
          `${error instanceof SyntaxError ? "Invalid Gemini JSON" : error.message}; phrase detector used instead.`,
        );
      }
    }
    if (provider === "rules") {
      segments.push(...classifyRules(fragments, request.phrases));
      warnings.push(
        "Phrase-only detection: ranges mark matched speech, not complete advert breaks. Topic chapters require publisher metadata or an enabled classifier.",
      );
    }
    return {
      version: 1,
      language: "en",
      episodeId: request.episodeId,
      durationMs,
      fingerprint,
      model: path.basename(config.podcastWhisperModel),
      provider,
      generatedAt: new Date().toISOString(),
      ...(provider === "local"
        ? { classifierModel: path.basename(config.llmModel) }
        : provider === "gemini"
          ? { classifierModel: config.podcastGeminiModel }
          : {}),
      segments: segments.sort((a, b) => a.startMs - b.startMs),
      fragments,
      diagnostics: {
        sampleWindows: windows,
        acousticBoundariesMs: boundaries.slice(0, 2000),
        warnings,
        sensitivity: request.sensitivity,
        minimumAdvertConfidence: sensitivityThreshold(request.sensitivity),
        classifierAssessments,
      },
      transcriptExpired: false,
    };
  } finally {
    // directory is an owned mkdtemp child of the configured podcast cache only.
    await fs.rm(directory, { recursive: true, force: true });
  }
}

class PodcastWorker {
  constructor(store, config, logger, processor = analyse) {
    Object.assign(this, { store, config, logger, processor });
    this.running = false;
  }
  start() {
    this.timer = setInterval(
      () =>
        this.tick().catch((e) =>
          this.logger.error("Podcast queue error", { error: e.message }),
        ),
      3000,
    );
    this.timer.unref();
  }
  async tick() {
    if (this.running) return;
    this.store.prune();
    const job = this.store.claim();
    if (!job) return;
    this.running = true;
    this.controller = new AbortController();
    const signal = AbortSignal.any([
      this.controller.signal,
      AbortSignal.timeout(this.config.podcastJobTimeoutMs),
    ]);
    this.current = (async () => {
      const log = (level, message) => {
        this.store.log(job.id, level, message);
        this.logger[level](message, { jobId: job.id });
      };
      try {
        log("info", "Podcast analysis started");
        const result = await this.processor(
          job.request,
          this.config,
          signal,
          (stage, value) => {
            this.store.progress(job.id, stage, value);
            log("info", stage);
          },
        );
        this.store.finish(job.id, result);
        log(
          "info",
          `Completed: ${result.segments.length} markers, ${result.fragments.length} transcript fragments`,
        );
      } catch (error) {
        if (this.controller.signal.aborted) {
          this.store.requeue(job.id);
          log("warn", "Requeued during service shutdown");
        } else {
          const message = signal.aborted
            ? "Analysis exceeded job time limit"
            : error.message;
          this.store.fail(job.id, message);
          log("error", message);
        }
      } finally {
        this.running = false;
      }
    })();
    await this.current;
  }
  async stop() {
    clearInterval(this.timer);
    this.controller?.abort();
    await this.current;
  }
}

module.exports = {
  validateRequest,
  sampleWindows,
  parseWhisper,
  classifyRules,
  applySensitivity,
  sensitivityThreshold,
  validateSegments,
  analyse,
  PodcastWorker,
};
