# Installation and migration

## DigitalOcean Jev setup

1. In DigitalOcean's **Serverless Inference** tab, create a **model access key**.
   This is an inference key, not the personal access token used for infrastructure.
2. Check access to **typesafe-jev-1.13.0** in the model catalog. Third-party model
   access requires a qualifying account tier; HTTP 403 can indicate a key/access
   problem. The catalog may list a newer model ID; set `jev_model` accordingly.
3. In the Home Assistant add-on Configuration tab set:

   ```yaml
   classifier: jev
   jev_api_key: YOUR_DIGITALOCEAN_MODEL_ACCESS_KEY
   jev_model: typesafe-jev-1.13.0
   jev_timeout_seconds: 30
   ```

4. Restart the sidecar and open its dashboard. **Test Jev with a transcript**
   verifies access and classification without downloading audio or running Whisper.
   The status message shows configuration, not a successful connection check.
5. Use **Test an episode** with a podcast audio URL for the complete pipeline.
   Inspect its job for sampled intervals, transcript excerpts and Jev decisions.

Standalone equivalents: `CLASSIFIER=jev`, `PODCAST_JEV_API_KEY`,
`PODCAST_JEV_MODEL` and `JEV_TIMEOUT_SECONDS`. For Docker, provide a private
`--env-file` alongside the volume/port arguments in the README. Do not commit keys.
No GPU Droplet or inference server deployment is needed: Jev is hosted and billed
through DigitalOcean Serverless Inference.

The sidecar posts to `https://inference.do-ai.run/v1/systemone` using Bearer
authentication with a `state` string and a named `choice` question. It does not
use chat completions. Jev accepts text, not audio: the local sequence is
**silence boundaries → sample audio → Whisper speech-to-text → Jev classification**.
Only transcript excerpts, phrase hints, operator guidance and bounded episode /
podcast context go to DigitalOcean. The key stays in server configuration and is
never returned by status, dashboard or job endpoints. See [DigitalOcean's System
One API guide](https://docs.digitalocean.com/products/inference/how-to/use-system-one-api/)
for the protocol, access tiers and model limits.

## Home Assistant

1. Refresh the existing Podwaffle add-on repository. Install **Podwaffle Ad
   Detection** separately from **Podwaffle**, on amd64 or aarch64.
2. Start the add-on. It downloads and SHA-256 verifies the English `tiny.en`
   Whisper weights (~78 MB) into persistent `/data/models`. Audio jobs wait for
   Whisper setup; the dashboard and transcript tests remain available.
3. Set Podwaffle's `analysis_server_url` to `http://<sidecar-hostname>:5000`
   using the hostname on the add-on Info page, or its mapped LAN address. Use a
   URL reachable from the Podwaffle server rather than an ingress URL. Port 5000
   is mapped by default; check Configuration → Network on older installations.
4. Restart Podwaffle. Enable analysis per podcast, or test an existing episode in
   **Details & chapters → Analysis diagnostics & testing tools**.

The dashboard uses relative API paths and works behind Home Assistant ingress.
The direct API has no authentication: keep it on a trusted LAN / private network,
not a public DigitalOcean port. If hosting the sidecar on a Droplet, use private
connectivity or an authenticated reverse proxy; this repository supplies the
inference integration, not a public hosting/authentication layer.

## Migrating from local Qwen or Gemini

Version 0.2 removes Qwen, llama.cpp and Gemini inference. Select `rules` for
fully local phrase detection, or configure `jev` explicitly to enable DigitalOcean.
Legacy `local` / `gemini` selections are treated as `rules` with a visible
migration warning; a supplied Jev key does not implicitly enable cloud processing.
Update saved Home Assistant options to `rules` or `jev` when upgrading.
Old LLM thread/timeout and Gemini key options are ignored.

On model preparation the sidecar removes only its known obsolete
`qwen2.5-1.5b-instruct-q4_k_m.gguf` weight file, adjacent manifest and partial
download files from `/data/models`. This frees the old classifier's disk space.
Other models, Whisper weights, jobs and logs are retained. Removal failures are
reported in model status. The rebuilt image contains no llama runtime; Qwen is
never downloaded or started. Existing completed results remain readable, including
historical local/Gemini results in Podwaffle. The `llmPrompt` API/storage name is
retained for compatibility and now supplies Jev detection guidance.

Existing submitted jobs retain their captured input and analyser URL. Retry in the
sidecar affects its queue; if Podwaffle already recorded a terminal failure, use
**Reanalyse** there to create a fresh tracked request. Switching services does not
import another analyser's database or change completed results.

## Models and resource use

| Option                    | Behaviour                                               |
| ------------------------- | ------------------------------------------------------- |
| `whisper_model: tiny.en`  | Default, smallest/quickest English Whisper option       |
| `whisper_model: base.en`  | Larger English model for quality comparisons            |
| `whisper_threads: 2`      | Local transcription CPU workers, 1–64                   |
| `classifier: rules`       | Default; literal sponsor phrases, no remote inference   |
| `classifier: jev`         | Sends sampled transcripts to DigitalOcean; requires key |
| `jev_timeout_seconds: 30` | Per-excerpt deadline including retry, 5–300 seconds     |

Whisper and FFmpeg still use local CPU and audio cache space. The migration removes
classifier memory/CPU and its ~1.12 GB weights; it does not eliminate transcription
cost. Whisper weights are cached and verified across restarts. The verify button
checks cached weights rather than silently upgrading to a different revision.

One job runs at a time. Defaults: 900 seconds of initial samples plus up to 240
seconds around phrase hits, 512 MiB audio limit, eight-hour maximum duration and a
one-hour job deadline. Native Whisper builds with two compilation workers.

## Decisions, failures and testing

Jev receives one timestamped excerpt per request and selects **advertisement**,
**promotion**, **not_ad** or **uncertain**, with classification confidence and label
probabilities. Low / balanced / high sensitivity accepts advert/promotion markers
at 0.75 / 0.55 / 0.35 confidence, and also adjusts existing silence detection.
Descriptions and transcripts are data, not operator instructions. Off-topic speech
alone is insufficient advertising evidence. Operator guidance is bounded to 2,000
characters. Topic chapters still come from publisher/embedded metadata.

Markers use exact transcript excerpt endpoints, marked approximate, never generated
ranges or bridges across unsampled gaps. This can mark only part of an ad and can
include editorial speech in mixed excerpts. Confidence/probabilities are model
outputs, not an accuracy measurement on your podcasts. Jev produces no explanatory
text; displayed notes are application summaries of selected labels and boundaries.

Each failed excerpt is uncertain and uses phrase rules while successful Jev
results are retained. If every excerpt fails, the job reports rules as its provider
and preserves the configured Jev model plus failure diagnostics. HTTP 429 / 5xx is
retried once with bounded backoff inside the deadline. Credential/access failures
stop additional requests for that classification run. No alternate provider is used.

The dashboard offers:

- **Test an episode:** submit an audio URL, sponsor phrases, guidance, sensitivity
  and edge focus; inspect the queued job's full request, result and logs.
- **Test Jev with a transcript:** paste text, times, optional episode context and
  guidance; see labels, probabilities, threshold, latency, API request count and
  returned token usage. Nothing is saved by the sidecar. Provider retention is
  governed by your DigitalOcean/TypeSafe terms.

`POST /api/podcasts/classify` accepts
`{fragments: [{startMs, endMs, text}], title?, phrases?, llmPrompt?, sensitivity?,
podcastTitle?, podcastDescription?, episodeDescription?}`. Limits: 1–50 excerpts,
4,000 characters each, 20,000 total and valid original timestamps within eight
hours. One dashboard transcript test runs at a time; it can run alongside an audio
job. It never accepts a client-supplied API key or endpoint. All failed requests
return HTTP 502, disabled Jev returns 503, invalid input 400, concurrent tests 409.
Missing token usage stays unknown. Usage reports only counts returned by successful
HTTP responses; billable timed-out requests may not be included.

## Retention and validation

Transcript excerpts and classification assessments expire after seven days. Compact
jobs, input metadata, fingerprints and markers remain. Temporary audio/PCM files
are removed after normal success/error; abrupt termination can leave cache files.
Clear those only while stopped. Logs record stages/errors rather than transcript
text. No automatic skipping or playback-fingerprint verification is enabled.

Run `npm test` in this folder. Tests use synthetic audio-tool and Jev responses
for protocol, timestamps, fallback, validation, key handling, retention and HTTP
behavior. Test representative podcasts through the dashboard to assess detection
quality, boundary accuracy, real latency and resource use before automatic skipping.
