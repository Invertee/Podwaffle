# Experimental podcast analysis

English-only analysis runs in the separate **Podwaffle Ad Detection** sidecar. Podwaffle's
web client displays chapter/advert suggestions and diagnostics. All seeking is
manual. Android is unchanged.

## Connect the services

1. Install and start **Podwaffle Ad Detection** from the same Home Assistant
   repository. It is independent of the main Podwaffle add-on and the video
   transcoder, with its own Node.js service, SQLite database and management UI.
2. Open its UI and wait for first-start Whisper model setup. No environment
   variables or manual model installation are required for the add-on.
3. Leave `classifier: rules` for phrase detection, or choose `jev` and set
   `jev_api_key` to a DigitalOcean Serverless Inference model access key.
   Whisper remains local; no local LLM is downloaded or run.
   See the [sidecar installation and migration guide](../podwaffle-ad-detection/DOCS.md)
   for DigitalOcean setup, resource requirements and migration.
4. Set `analysis_server_url` in Podwaffle's add-on options or server options JSON
   to `http://<sidecar-hostname>:5000` (hostname from its HA Info page), or its
   mapped LAN URL. Restart Podwaffle. Use a URL reachable from the Podwaffle server,
   not an ingress URL. No service-to-service credentials are used.
5. Open a podcast in the web client, expand **Chapters & advert analysis**, enable
   new-episode analysis and optionally save sponsor/phrase hints, Jev
   guidance, detection sensitivity and first/last-minute focus. Settings belong
   to the current profile's subscription.

## Test an existing episode

Open **Details & chapters**, expand **Analysis diagnostics & testing tools** and
choose **Analyse this episode**. This works independently of the new-episode
toggle. Reanalysis uses the saved detection settings; queued jobs retain their
captured settings.
An existing active job is reused instead of creating duplicates.

The modal polls progress and displays markers. Start playback with the normal
Play button, then use **Go to start/end** to review timings. No client fingerprint
comparison is performed yet: the SHA-256 shown identifies only the analyser's
downloaded file. Dynamic ad insertion can produce a different listening copy
at the same URL. A changed enclosure URL is flagged as stale.

Diagnostics include job IDs, retry state, model/classifier, sampled intervals,
silence boundaries, warnings, transcript excerpts and job logs. Empty results
mean no markers were detected in sampled portions, not that the episode is ad-free.
Jev jobs show a verdict, classification confidence and label probabilities beside
each retained excerpt, including candidates below the sensitivity threshold.
Displayed notes are application summaries, since Jev does not generate explanations.
Assessments expire with transcripts after seven days. Historical local/Gemini
results remain readable.

The sidecar dashboard also offers full episode tests from audio URLs and direct
transcript tests for Jev, including latency and token usage. It shows Whisper setup,
job inspection and its dedicated rotating `/data/logs/podcast-analysis.log` (plus `.1`).

## Detection behaviour

- Downloads once, hashing the bytes. Source media is never rewritten.
- Imports linked `podcast:chapters` JSON or embedded chapters during analysis;
  publisher chapters take precedence. Timings may differ with dynamic ads.
- Scans silence boundaries with FFmpeg. Low/Balanced/High sensitivity adjusts
  silence-boundary detection and the confidence accepted from classifiers.
  Tonal/speaker-change models are outside this detector.
- Samples 30-second windows near boundaries and at regular intervals, including
  episode ends. The configurable edge focus reserves more of that budget for the
  first and last 0–15 minutes (five by default). Default initial budget: 900
  seconds, with the remainder spread across the episode.
  Up to eight additional 30-second context windows follow phrase hits. Short
  episodes may be transcribed in full.
- Runs Whisper with English explicitly selected. Local phrase detection marks
  matching speech, not an entire advert break.
- Optionally sends each timestamped transcript excerpt to Jev through DigitalOcean
  for a fixed advert/promotion/editorial/uncertain classification. Bounded episode
  and podcast context accompanies excerpts as data. Off-topic discussion alone
  is not an advert. Markers use excerpt boundaries and cannot bridge gaps.
- Per-podcast Jev guidance uses the existing `llmPrompt` field, bounded to 2,000
  characters. It can describe show-specific advert patterns.
- Failed excerpts are uncertain and use phrase rules; successful Jev decisions
  remain. If every request fails the provider is rules, with Jev failure warnings.
  A failure never switches to another cloud provider.
- Jev does not generate chapter titles or explanatory prose; chapters still come
  from publisher/embedded metadata. Scores are model outputs, not a measured
  detection accuracy. Boundaries are approximate and sparse sampling misses ads.

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

One job runs at a time in the sidecar. `whisper_threads` controls local
transcription CPU use. `jev_timeout_seconds` bounds each remote excerpt request
(30 seconds by default, including at most one retry on HTTP 429 / 5xx). Default download cap: 512 MiB;
maximum duration: eight hours; job deadline: one hour. Change `max_audio_mb` and
`job_timeout_minutes` in the sidecar options.

Temporary audio, PCM samples and Whisper output are deleted on normal completion
or error. Transcript fragments expire after seven days on both services; markers,
fingerprints and compact job records remain. Sync events and command responses
never contain transcripts. Backups have their own retention policy. Job logs
record stages/errors without transcript text.

## APIs

Client endpoints use Podwaffle's existing profile authentication:

| Method    | Path                                        | Purpose                                                                                                              |
| --------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| GET / PUT | `/api/v1/subscriptions/:podcastId/analysis` | Get/save `{settings: {enabled, phrases, llmPrompt, sensitivity, edgeFocusMinutes}}`; writes also require `commandId` |
| GET       | `/api/v1/episodes/:episodeId/analysis`      | Latest status, result and diagnostics                                                                                |
| POST      | `/api/v1/episodes/:episodeId/analysis`      | Analyse/reanalyse with `{commandId}`                                                                                 |

The analyser's local endpoints are unauthenticated:

| Method | Path                     | Purpose                                                                                                                                                                              |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/podcasts/status`   | Configuration summary and latest 200 jobs                                                                                                                                            |
| POST   | `/api/podcasts/jobs`     | Enqueue `{requestKey, episodeId, title, enclosureUrl, chaptersUrl?, phrases?, llmPrompt?, sensitivity?, edgeFocusMinutes?, podcastTitle?, podcastDescription?, episodeDescription?}` |
| GET    | `/api/podcasts/jobs/:id` | Job, result and latest 300 job log entries                                                                                                                                           |
| POST   | `/api/podcasts/classify` | Test timestamped transcripts with Jev, without audio or persisted results |
| GET    | `/api/podcasts/logs`     | Latest dedicated log lines                                                                                                                                                           |

## Validation

Run `pnpm typecheck`, `pnpm build` and the server analysis integration tests in
Podwaffle; run `npm ci` and `npm test` in `podwaffle-ad-detection`.
The pipeline test uses controlled FFmpeg/Whisper responses to exercise download,
hashing, timestamps and cleanup without installing a model. Real detection
quality and inference speed still need measurement on the deployment machine
with real podcast audio before considering automatic skipping.
