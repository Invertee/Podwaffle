# Installation and migration

## Home Assistant

1. Refresh the existing Podwaffle add-on repository. Install **Podwaffle Ad
   Detection**, separately from **Podwaffle**. Supports amd64 and aarch64.
2. Start it and open its web interface. On first start it downloads the current
   upstream `tiny.en` Whisper weights (~78 MB), verifies SHA-256 and saves them in
   persistent `/data/models`. Jobs wait while setup is in progress. A failed
   download is visible and can be retried from the UI. Installation builds the
   native tools; the model download happens on first startup, when `/data` exists.
3. Set Podwaffle's `analysis_server_url` to `http://<sidecar-hostname>:5000`, using
   the hostname shown on the sidecar's Home Assistant Info page. Do not use an
   ingress URL. Alternatively map its optional network port to an unused host
   port and use that LAN address. The port is unmapped by default.
4. Restart Podwaffle. Enable analysis per podcast or test an existing episode
   through **Details & chapters → Analysis diagnostics & testing tools**.

No authentication is implemented. Keep the API private to Home Assistant / your
trusted LAN. It can fetch submitted audio URLs and perform resource-intensive
work, so it must not be internet-accessible. Ingress provides access to the UI via
Home Assistant; direct API access has no credentials.

## Models and resource use

| Option                   | Behaviour                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `whisper_model: tiny.en` | Default, quickest/smallest English Whisper option                                                                |
| `whisper_model: base.en` | Larger English model for quality comparisons                                                                     |
| `classifier: rules`      | Default; literal sponsor/phrase hints, no LLM download                                                           |
| `classifier: local`      | Automatically downloads Qwen2.5 1.5B Instruct Q4_K_M (~1.12 GB), runs it using bundled llama.cpp on CPU          |
| `classifier: gemini`     | Requires `gemini_api_key`; sends sampled transcripts, phrase hints and bounded episode/podcast context to Gemini |

Qwen is optional because its weights, runtime memory and processing time are
significant on smaller Home Assistant hosts. Allow several GB of free RAM plus
audio cache/model storage and measure on your hardware; model file size is not a
RAM estimate. Native tools build with two compilation workers. Whisper and LLM
threads are configurable. The LLM listens only on container loopback; no LLM port
is exposed. This is a constrained classifier, not a general-purpose agent.

The small model is an initial candidate, **not** a validated advert detector.
Off-topic speech alone is not an advert, and descriptions may contain sponsor
links. Prompts require evidence of commercial intent. Descriptions and transcripts
are treated as untrusted data; generated ranges cannot bridge transcript gaps.

First installation resolves the current upstream model revision and records its
checksum. Verified cached models survive upgrades and can start offline; routine
restarts do not silently replace weights. Changing Whisper size downloads the
selected model. To refresh an existing model to current upstream weights, stop the
add-on and move that model and its adjacent `.json` manifest out of `/data/models`
using your administrator tools, then restart. Preserve those files for rollback.
The UI's verify button does not force an upgrade or discard a good model.

Upstream references: [Whisper models](https://github.com/ggml-org/whisper.cpp/tree/master/models),
[Qwen model card and licence](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF),
[llama.cpp server](https://github.com/ggml-org/llama.cpp/tree/master/tools/server).

## Moving away from the Radarr/Sonarr transcoder

1. Prefer to let the old analyser finish outstanding jobs before upgrading the
   transcoder. Existing Podwaffle results remain in Podwaffle's database.
2. Install/start the sidecar, wait for model readiness, then change Podwaffle's
   analyser URL. Existing submitted jobs retain the old URL: changing the setting
   does not move those jobs automatically. If the old service has already gone,
   let their bounded transport retries reach failure and reanalyse from Podwaffle.
3. Upgrade the transcoder with the podcast removal changes. It no longer registers
   podcast endpoints, starts the worker or renders the podcast tab. Existing video
   jobs and statistics are unaffected. Its old `PODCAST_*` variables are ignored.
4. The sidecar starts with a fresh SQLite database. Old analyser jobs are not
   imported automatically; reanalyse episodes if needed. Do not point it at the
   video database. The transcoder leaves its unused podcast tables intact unless
   its optional `scripts/remove-podcast-tables.js` cleanup is explicitly run with
   the transcoder stopped. That command backs up the database before dropping only
   the two podcast tables. Keep the backup if the old job details matter.

Retry in the sidecar is for its local queue. If Podwaffle has already recorded a
terminal failure, use **Reanalyse** in Podwaffle to create a fresh tracked request.

## Diagnostics and limits

The web UI shows model setup, job status/stage/progress, full request/result
inspection, per-job logs and a dedicated rotating service log. Defaults: one job
at a time, 900 seconds initially sampled plus up to 240 seconds around phrase hits,
512 MiB audio download, eight-hour episode maximum, one-hour job deadline.
Transcripts expire after seven days; markers and input metadata remain.

No automatic skipping, multilingual processing or Android changes are included.
The Podwaffle client still needs a future playback-fingerprint comparison before
timings can be trusted for automatic actions.
