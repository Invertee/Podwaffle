# Experimental podcast analysis

English-only analysis runs in the separate Radarr/Sonarr transcoder. Podwaffle's
web client displays chapter/advert suggestions and diagnostics. All seeking is
manual. Android is unchanged.

## Connect the services

1. Update the transcoder and run its usual `npm install --omit=dev --no-package-lock`.
   Its SQLite database gains separate podcast job and log tables on startup.
2. Install [whisper.cpp](https://github.com/ggml-org/whisper.cpp) on that machine
   and download `ggml-tiny.en.bin` (or `ggml-base.en.bin` for comparison) using
   its [model instructions](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md).
   FFmpeg and ffprobe are also required. The service account needs read/execute
   access to the model and executable.
3. Configure the transcoder environment and restart its service:

   ```dotenv
   PODCAST_WHISPER_PATH=/usr/local/bin/whisper-cli
   PODCAST_WHISPER_MODEL=/var/lib/transcode-manager/models/ggml-tiny.en.bin
   PODCAST_WHISPER_THREADS=2
   PODCAST_SAMPLE_SECONDS=900
   # Optional semantic classification; otherwise uses local phrase detection.
   PODCAST_GEMINI_API_KEY=
   PODCAST_GEMINI_MODEL=gemini-2.5-flash
   ```

   Choose a Gemini model available to your account. Speech recognition stays on
   the analyser; transcript excerpts and phrase hints go to Gemini only when
   its key is configured. No OpenAI API account is required.
4. Set `analysis_server_url` in Podwaffle's add-on options or server options JSON
   to the analyser's LAN base URL, e.g. `http://192.168.1.50:5000`, and restart
   Podwaffle. Use a direct URL reachable from the Podwaffle server, not a Home
   Assistant ingress URL. No service-to-service credentials are used.
5. Open a podcast in the web client, expand **Chapters & advert analysis**, enable
   new-episode analysis and optionally save sponsor/phrase hints, one per line.
   Settings belong to the current profile's subscription.

## Test an existing episode

Open **Details & chapters**, expand **Analysis diagnostics & testing tools** and
choose **Analyse this episode**. This works independently of the new-episode
toggle. Reanalysis uses saved phrases; queued jobs retain their captured settings.
An existing active job is reused instead of creating duplicates.

The modal polls progress and displays markers. Start playback with the normal
Play button, then use **Go to start/end** to review timings. No client fingerprint
comparison is performed yet: the SHA-256 shown identifies only the analyser's
downloaded file. Dynamic ad insertion can produce a different listening copy
at the same URL. A changed enclosure URL is flagged as stale.

Diagnostics include job IDs, retry state, model/classifier, sampled intervals,
silence boundaries, warnings, transcript excerpts and job logs. Empty results
mean no markers were detected in sampled portions, not that the episode is ad-free.

In the transcoder, open **Podcast analysis** for the separate job table, per-job
request/result/log inspection and dedicated rotating `LOG_DIR/podcast-analysis.log`
(plus its `.1` rotated file).

## Detection behaviour

- Downloads once, hashing the bytes. Source media is never rewritten.
- Imports linked `podcast:chapters` JSON or embedded chapters during analysis;
  publisher chapters take precedence. Timings may differ with dynamic ads.
- Scans silence boundaries with FFmpeg. Tonal/speaker-change models are outside
  this first detector.
- Samples 30-second windows near boundaries and at regular intervals, including
  episode ends. Default initial budget: 900 seconds spread across the episode.
  Up to eight additional 30-second context windows follow phrase hits. Short
  episodes may be transcribed in full.
- Runs Whisper with English explicitly selected. Local phrase detection marks
  matching speech, not an entire advert break.
- Optionally requests structured Gemini classifications and explicit topic
  transitions. Ranges are validated and cannot span large transcript gaps.
  Gemini failure falls back to phrase detection with a warning.
- Confidence is an uncalibrated suggestion, not measured probability. Generated
  boundaries are approximate, and sparse sampling can miss adverts and topics.

## Reliability and retention

Feed upsert and outbox creation share a transaction. Scheduled and manual refresh
queue only newly discovered episodes for enabled profiles. Enabling does not
backfill. Disabling cancels work not yet submitted; submitted jobs can finish.
Profiles have independent results/phrase settings in this version; cross-profile
inference deduplication is a future optimisation.

Podwaffle submits/polls every five seconds in bounded batches. Stable idempotency
keys survive lost responses and restarts. Connection failures back off up to five
minutes; ten consecutive failures mark a job failed. Reanalyse after fixing a
persistent problem. Submitted jobs retain their original analyser base URL even
if the configured URL changes.

One podcast job runs at a time, independently of the video worker. Both can run
concurrently; `PODCAST_WHISPER_THREADS` limits CPU contention. Default download
cap: 512 MiB; maximum duration: eight hours; job deadline: one hour. Override the
size/deadline with `PODCAST_MAX_BYTES` and `PODCAST_JOB_TIMEOUT_MS`.

Temporary audio, PCM samples and Whisper output are deleted on normal completion
or error. Transcript fragments expire after seven days on both services; markers,
fingerprints and compact job records remain. Sync events and command responses
never contain transcripts. Backups have their own retention policy. Job logs
record stages/errors without transcript text.

## APIs

Client endpoints use Podwaffle's existing profile authentication:

| Method | Path | Purpose |
| --- | --- | --- |
| GET / PUT | `/api/v1/subscriptions/:podcastId/analysis` | Get/save `{settings: {enabled, phrases}}`; writes also require `commandId` |
| GET | `/api/v1/episodes/:episodeId/analysis` | Latest status, result and diagnostics |
| POST | `/api/v1/episodes/:episodeId/analysis` | Analyse/reanalyse with `{commandId}` |

The analyser's local endpoints are unauthenticated:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/podcasts/status` | Configuration summary and latest 200 jobs |
| POST | `/api/podcasts/jobs` | Enqueue `{requestKey, episodeId, title, enclosureUrl, chaptersUrl?, phrases?}` |
| GET | `/api/podcasts/jobs/:id` | Job, result and latest 300 job log entries |
| GET | `/api/podcasts/logs` | Latest dedicated log lines |

## Validation

Run `pnpm typecheck`, `pnpm build` and the server analysis integration tests in
Podwaffle; run `npm test` and `node scripts/check-syntax.js` in the transcoder.
The pipeline test uses controlled FFmpeg/Whisper responses to exercise download,
hashing, timestamps and cleanup without installing a model. Real detection
quality and inference speed still need measurement on the deployment machine
with real podcast audio before considering automatic skipping.
