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

Use **Inspect** beside any episode in **Analysis jobs** for its interactive timeline.
The dashboard has **Episodes**, **Models & detection**, **Testing** and **Service
log** tabs; episode inspection stays in Episodes, while setup and test forms live
in their own tabs.
The three lanes show sampled audio, excerpt decisions and saved advert/promotion
markers. Select a range to read the matching transcript and Jev response, or search
and filter excerpts. Zoom to one or five minutes around the selection for short
ranges in long episodes. Dashed candidates fall below the saved-marker confidence
threshold or other saved Jev filters; failed requests and phrase-rule fallback remain visible. Unsampled gaps
have no classification. Selection and filters survive automatic refreshes; the URL
links directly to the selected job.

New jobs retain validated Jev classification, returned model and token usage per
excerpt, plus latency, request counts and bounded provider errors. Other provider
fields are omitted. Older jobs show their saved decisions without inventing response
data. Transcripts and these response details expire after seven days; saved markers
and sampled coverage remain available.

In **Models & detection**, save audio and Jev sensitivity independently. Both
default to following the episode's Low / Balanced / High sensitivity. Audio can
instead use its own preset or custom silence threshold (-80 to -10 dB) and minimum
pause (0.1 to 5 seconds). The initial sample budget is 30–3,600 seconds, plus up to
240 seconds of adjacent phrase-hit samples. More sampling can increase processing
time and cloud usage. Audio sensitivity controls sample boundaries, not Whisper's
recognition settings.

Jev supports presets or separate custom advert/promotion confidence thresholds
(0–100%), an additional minimum selected-label probability (0 disables it), and a
promotion-marker toggle. These filter saved Jev markers without changing returned
model decisions or phrase-rule fallback. Excluded candidates remain inspectable
with their exclusion reason. Settings save immediately to SQLite and survive
restarts. They apply to new jobs and transcript tests, including jobs from
Podwaffle; queued jobs, retries and completed results keep their captured settings.
Use a new analysis request to apply new settings to an existing episode.

Saved sample budgets override the startup `sample_seconds` / `PODCAST_SAMPLE_SECONDS`
value. **Restore defaults** loads the startup defaults into the form; save to apply
them. Refreshing or switching tabs preserves unsaved form edits.

| Method | Path                           | Purpose                                               |
| ------ | ------------------------------ | ----------------------------------------------------- |
| GET    | `/api/podcasts/status`         | Latest 200 jobs and classifier configuration (no key) |
| POST   | `/api/podcasts/jobs`           | Queue audio analysis; request key deduplicates        |
| GET    | `/api/podcasts/jobs/:id`       | Result, request and job logs                          |
| POST   | `/api/podcasts/classify`       | Ad hoc Jev test from timestamped transcript excerpts  |
| GET    | `/api/podcasts/settings`       | Saved detection settings and startup defaults         |
| PUT    | `/api/podcasts/settings`       | Validate and save `{settings: {...}}` for future work |
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
