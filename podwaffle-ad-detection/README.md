# Podwaffle Ad Detection

Independent Node.js / SQLite sidecar for English podcast chapter and advert
suggestions. Install separately from Podwaffle using the same Home Assistant
add-on repository. No Sonarr, Radarr, video worker or authentication dependencies.

See [DOCS.md](DOCS.md) for installation, model choices and migration from the
former transcoder-hosted service. Automatic advert skipping is **not** enabled.

The entire Docker build context is this folder. Unlike the main Podwaffle add-on,
this Dockerfile does not fetch application code from another branch during build.
Native Whisper and llama.cpp releases are pinned in the Dockerfile. Models are
downloaded on first start into persistent `/data/models`, not baked into the image.

```sh
npm ci
npm test
# Requires Node >=24.15, FFmpeg, ffprobe and whisper-cli on PATH:
npm start
# Or build with the bundled native tools:
docker build -t podwaffle-ad-detection .
docker run --rm -p 5000:5000 -v podwaffle-analysis:/data podwaffle-ad-detection
```

Standalone defaults need no environment file. Data goes to `./data` unless
`DATA_DIR` is set. `PORT=5000`, `HOST=0.0.0.0`, `CLASSIFIER=rules`,
`WHISPER_MODEL=tiny.en`, `PODCAST_WHISPER_THREADS=2`,
`PODCAST_SAMPLE_SECONDS=900`, `MAX_AUDIO_MB=512`, `JOB_TIMEOUT_MINUTES=60`.
Optional local classification: `CLASSIFIER=local`, `LLM_THREADS=2`; requires
`llama-server` on PATH (included in Docker). Binary paths can be overridden with
`FFMPEG_PATH`, `FFPROBE_PATH`, `PODCAST_WHISPER_PATH`, `LLAMA_SERVER_PATH`.
For cloud use, explicitly select `CLASSIFIER=gemini` and provide
`PODCAST_GEMINI_API_KEY`; `PODCAST_GEMINI_MODEL` defaults to `gemini-2.5-flash`.
Home Assistant options are read from `/data/options.json`; standalone can use
`PODWAFFLE_ANALYSIS_OPTIONS` to choose a different JSON file. Environment takes
precedence over options. No environment variables are required in Home Assistant.

Original local API retained:

| Method | Path                           | Purpose                                      |
| ------ | ------------------------------ | -------------------------------------------- |
| GET    | `/api/podcasts/status`         | Latest 200 jobs and selected classifier      |
| POST   | `/api/podcasts/jobs`           | Submit a job, same request key deduplicates  |
| GET    | `/api/podcasts/jobs/:id`       | Full result, request and job logs            |
| GET    | `/api/podcasts/logs`           | Dedicated rotating service log               |
| GET    | `/api/podcasts/models`         | Setup state, download progress and checksums |
| POST   | `/api/podcasts/models/prepare` | Retry setup / verify cached models           |
| POST   | `/api/podcasts/jobs/:id/retry` | Retry a failed job locally                   |
| GET    | `/health`                      | HTTP service health, including model state   |

Model preparation accepts optional JSON `{"target":"configured"}` (the default),
`{"target":"whisper"}` or `{"target":"qwen"}`. Explicit targets download/verify
independently of classifier selection. Qwen starts only when local mode is selected.
Concurrent requests for a different target return 409; unknown targets return 400.

Job body: `{requestKey, episodeId, title, enclosureUrl, chaptersUrl?, phrases?,
llmPrompt?, sensitivity?, edgeFocusMinutes?, podcastTitle?, podcastDescription?,
episodeDescription?}`. Context and detection settings are optional; legacy callers
work unchanged. Descriptions are limited to 8,000 characters each, podcast title
to 500, and local-LLM guidance to 2,000. Metadata and detection settings are
snapshotted on submission. Local prompts use shorter context and bounded batches
to fit the small model. Model output is validated, with unsupported time ranges
discarded. No tools or autonomous agent actions are given to the classifier.
Local results retain a concise verdict, confidence and evidence-based rationale
for each transcript excerpt so empty detections can be diagnosed. These summaries
are not chain-of-thought and expire with transcript excerpts after seven days.
Excerpts are classified independently; a timeout or invalid response affects only
that excerpt. `llm_timeout_seconds` controls the per-excerpt limit (60 seconds by
default, 10–300 seconds). If every excerpt fails, phrase rules remain the fallback.

The server imports publisher/embedded chapters, scans silence and samples audio
for Whisper. It does not yet perform tonal/speaker-change detection. Phrase-only
results identify matching speech, not complete ad breaks. Classifier failure falls
back to rules and reports a warning. A local failure never switches to a cloud
provider. No remote model inference occurs unless Gemini is selected.

Queue and logs use `podwaffle-analysis.sqlite`; rotating log files live in
`logs/podcast-analysis.log`. Transcript excerpts and database log entries expire
after seven days; compact jobs, markers and input metadata remain. Audio and PCM
samples are removed on normal success/error. Abruptly killed containers can leave
temporary cache files, which should only be removed with the add-on stopped.

Tests use synthetic model/tool responses, not a claim of detection accuracy.
Measure real audio quality, memory usage and speed on the target hardware before
considering automatic skipping. Dynamic ad insertion can change bytes at the same
URL; the recorded SHA-256 is not yet checked against client playback.
