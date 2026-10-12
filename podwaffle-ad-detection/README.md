# Podwaffle Ad Detection

Independent Node.js / SQLite sidecar for English podcast chapter and advert
suggestions. Boundary detection and Whisper speech-to-text run locally; optional
advert classification uses **Jev through DigitalOcean Serverless Inference**.
No local LLM, Qwen weights, llama.cpp runtime or generative classifier is included.
Automatic advert skipping is not enabled.

See [DOCS.md](DOCS.md) for DigitalOcean setup, Home Assistant installation,
resource use and migration. The Docker build context is this folder.

```sh
npm ci
npm test
# Requires Node >=24.15, FFmpeg, ffprobe and whisper-cli on PATH:
npm start
# Or build the sidecar with its bundled native transcription tools:
docker build -t podwaffle-ad-detection .
docker run --rm -p 5000:5000 -v podwaffle-analysis:/data podwaffle-ad-detection
```

Defaults: `CLASSIFIER=rules`, `WHISPER_MODEL=tiny.en`,
`PODCAST_WHISPER_THREADS=2`, `PODCAST_SAMPLE_SECONDS=900`,
`MAX_AUDIO_MB=512`, `JOB_TIMEOUT_MINUTES=60`, `PORT=5000`.
Standalone data goes to `./data` unless `DATA_DIR` is set.

For Jev select `CLASSIFIER=jev` and provide `PODCAST_JEV_API_KEY`,
a DigitalOcean **model access key**. `PODCAST_JEV_MODEL` defaults to
`typesafe-jev-1.13.0`; `JEV_TIMEOUT_SECONDS=30` sets the per-excerpt deadline.
The endpoint is `https://inference.do-ai.run/v1/systemone`.
No DigitalOcean GPU server or local classifier model is required.

Home Assistant reads options from `/data/options.json`; standalone can override
that location with `PODWAFFLE_ANALYSIS_OPTIONS`. Environment takes precedence.
Binary paths: `FFMPEG_PATH`, `FFPROBE_PATH`, `PODCAST_WHISPER_PATH`.

The dashboard at `/` supports full episode tests by audio URL and direct
transcript tests with label probabilities, confidence, elapsed time and token usage.
Transcript tests work before Whisper downloads and are not stored by the sidecar.
Keep the unauthenticated dashboard/API on a trusted network.

| Method | Path                           | Purpose                                               |
| ------ | ------------------------------ | ----------------------------------------------------- |
| GET    | `/api/podcasts/status`         | Latest 200 jobs and classifier configuration (no key) |
| POST   | `/api/podcasts/jobs`           | Queue audio analysis; request key deduplicates        |
| GET    | `/api/podcasts/jobs/:id`       | Result, request and job logs                          |
| POST   | `/api/podcasts/classify`       | Ad hoc Jev test from timestamped transcript excerpts  |
| POST   | `/api/podcasts/jobs/:id/retry` | Retry a failed job                                    |
| GET    | `/api/podcasts/logs`           | Rotating service log                                  |
| GET    | `/api/podcasts/models`         | Whisper setup, progress and checksums                 |
| POST   | `/api/podcasts/models/prepare` | Prepare configured Whisper; optional target `whisper` |
| GET    | `/health`                      | Service health and model state                        |

Job body: `{requestKey, episodeId, title, enclosureUrl, chaptersUrl?, phrases?,
llmPrompt?, sensitivity?, edgeFocusMinutes?, podcastTitle?, podcastDescription?,
episodeDescription?}`. The legacy `llmPrompt` field now contains Jev detection
guidance. Existing callers and saved settings remain compatible.

Jev selects advertisement, promotion, not_ad or uncertain for each excerpt.
Application code owns timestamps: markers use only that excerpt's boundaries.
Publisher/embedded chapters and silence sampling are retained; Jev does not
generate chapter titles or explanations. Failed excerpts use phrase rules with a
warning; successful Jev decisions are retained. A failed cloud request never
switches to a different provider. Sparse sampling can miss adverts.

Queue/logs use `podwaffle-analysis.sqlite`. Transcript excerpts and assessments
expire after seven days; markers and compact input metadata remain. Temporary
audio/PCM files are removed on normal success/error. Abrupt termination can leave
cache files; remove those only with the add-on stopped.

Tests use controlled inference and audio-tool responses, not a claim of detection
accuracy. Evaluate real audio, timings and hardware use before automatic skipping.
Dynamic ad insertion can change bytes at a stable URL; the recorded SHA-256 is not
yet compared against client playback.
